import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import main as server_main  # noqa: E402
from server.api import ApiError, Service, access, transport  # noqa: E402

KEYS = [SimpleNamespace(type="ssh-ed25519", fingerprint="SHA256:abc")]


class ServiceTests(unittest.TestCase):
    def test_demo_lists_apps_and_logs_without_connecting_anywhere(self):
        service = Service(demo=True)
        state = service.state()
        self.assertTrue(state["connected"] and state["demo"])
        self.assertEqual(state["host"], "192.168.1.104")
        self.assertEqual(state["version"], "2.0.0")
        result = service.apps()
        self.assertEqual([app["id"] for app in result["apps"]][:2], ["dockge", "immich"])
        self.assertRegex(result["refreshedAt"], r"^\d\d:\d\d:\d\d$")
        self.assertIn("immich", service.logs("immich")["text"])

    def test_demo_logs_reject_unknown_and_invalid_ids(self):
        service = Service(demo=True)
        with self.assertRaises(ApiError) as missing:
            service.logs("not-installed")
        self.assertEqual(missing.exception.status, 404)
        with self.assertRaises(ApiError) as invalid:
            service.logs("../etc/passwd")
        self.assertEqual(invalid.exception.status, 400)

    def test_demo_start_stop_and_restart_change_what_the_list_shows(self):
        service = Service(demo=True)
        state = lambda: next(app["state"] for app in service.apps()["apps"] if app["id"] == "immich")
        self.assertEqual(state(), "ready")
        self.assertEqual(service.lifecycle("immich", "stop"), {"appId": "immich", "action": "stop", "state": "stopped"})
        self.assertEqual(state(), "stopped")
        self.assertEqual(service.lifecycle("immich", "start")["state"], "ready")
        self.assertEqual(service.lifecycle("immich", "restart")["state"], "ready")
        self.assertEqual(Service(demo=True).apps()["apps"][1]["state"], "ready")  # one session's changes don't leak into another

    def test_lifecycle_refuses_actions_that_do_not_fit_the_state(self):
        service = Service(demo=True)
        for app_id, action in (("immich", "start"), ("paperless", "stop"), ("paperless", "restart")):
            with self.assertRaises(ApiError) as error:
                service.lifecycle(app_id, action)
            self.assertEqual((error.exception.status, error.exception.code), (409, "state"))
        with self.assertRaises(ApiError) as unknown_action:
            service.lifecycle("immich", "uninstall")
        self.assertEqual(unknown_action.exception.status, 404)
        with self.assertRaises(ApiError) as missing:
            service.lifecycle("nope", "stop")
        self.assertEqual(missing.exception.status, 404)

    def test_real_lifecycle_goes_through_the_core_and_maps_refusals(self):
        service = Service()
        service.connection = transport.SSHConnection("umbrel.test")
        with patch.object(transport.SSHConnection, "request", return_value={"appId": "immich", "action": "stop", "state": "stopped"}) as request:
            self.assertEqual(service.lifecycle("immich", "stop")["state"], "stopped")
        request.assert_called_once_with("stop", appId="immich")
        with patch.object(transport.SSHConnection, "request", side_effect=transport.ConnectionError("Cannot stop immich while it is stopped.")):
            with self.assertRaises(ApiError) as refused:
                service.lifecycle("immich", "stop")
        self.assertEqual((refused.exception.status, refused.exception.code), (409, "state"))
        with patch.object(transport.SSHConnection, "request", side_effect=transport.ConnectionError("SSH operation timed out.")):
            with self.assertRaises(ApiError) as failed:
                service.lifecycle("immich", "stop")
        self.assertEqual((failed.exception.status, failed.exception.code), (502, "ssh"))

    def test_demo_memory_follows_state_and_totals_are_bytes(self):
        service = Service(demo=True)
        usage = service.usage()
        self.assertEqual(usage["size"], 16 * 1024**3)
        self.assertGreater(usage["apps"]["immich"], 2_000_000_000)
        self.assertLess(usage["apps"]["immich"], 2_400_000_000)
        self.assertEqual(usage["apps"]["paperless"], 0)  # stopped apps hold no memory
        self.assertGreater(usage["used"], sum(usage["apps"].values()))
        service.lifecycle("immich", "stop")
        self.assertEqual(service.usage()["apps"]["immich"], 0)  # the stop cleared the cached reading
        service.lifecycle("paperless", "start")
        self.assertGreater(service.usage()["apps"]["paperless"], 0)

    def test_demo_storage_reports_each_app_against_the_disk(self):
        storage = Service(demo=True).storage()
        self.assertEqual(storage["size"], 1_800_000_000_000)
        self.assertEqual(storage["apps"]["immich"], 412_000_000_000)
        self.assertEqual(storage["available"], storage["size"] - storage["used"])
        self.assertRegex(storage["measuredAt"], r"^\d\d:\d\d:\d\d$")

    def test_real_usage_is_cached_so_polling_does_not_open_ssh_every_time(self):
        service = Service()
        service.connection = transport.SSHConnection("umbrel.test")
        reading = {"size": 100, "used": 40, "apps": {"immich": 10}}
        with patch.object(transport.SSHConnection, "request", return_value=reading) as request:
            first, second = service.usage(), service.usage()
            self.assertEqual(request.call_count, 1)
            self.assertEqual(first["apps"], {"immich": 10})
            self.assertEqual(second, first)
            service.cache["memory"] = (service.cache["memory"][0] - 60, service.cache["memory"][1])  # past its 5 seconds
            service.usage()
            self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args.args, ("usage",))

    def test_storage_is_kept_for_minutes_and_refresh_forces_a_new_measurement(self):
        service = Service()
        service.connection = transport.SSHConnection("umbrel.test")
        with patch.object(transport.SSHConnection, "request", return_value={"size": 100, "used": 40, "available": 60, "apps": {}}) as request:
            service.storage()
            service.storage()
            self.assertEqual(request.call_count, 1)
            service.storage(refresh=True)
            self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args.args, ("storage",))

    def test_usage_failures_become_a_502_with_the_reason_and_need_a_connection(self):
        service = Service()
        with self.assertRaises(ApiError) as unconnected:
            service.usage()
        self.assertEqual(unconnected.exception.status, 409)
        service.connection = transport.SSHConnection("umbrel.test")
        with patch.object(transport.SSHConnection, "request", side_effect=transport.ConnectionError("Unexpected memory usage response.")):
            with self.assertRaises(ApiError) as failed:
                service.usage()
        self.assertEqual((failed.exception.status, failed.exception.message), (502, "Unexpected memory usage response."))

    def test_listing_needs_a_connection(self):
        with self.assertRaises(ApiError) as error:
            Service().apps()
        self.assertEqual((error.exception.status, error.exception.code), (409, "not_connected"))

    def test_invalid_host_is_a_400_with_the_cores_wording(self):
        with self.assertRaises(ApiError) as error:
            Service().connect("http://umbrel.local")
        self.assertEqual(error.exception.status, 400)
        self.assertIn("hostname or IP", error.exception.message)

    def test_first_contact_asks_for_trust_and_trusts_only_the_keys_it_showed(self):
        service = Service()
        trusted = []
        with patch.object(access, "known_host", return_value=False), \
             patch.object(access, "scan_host", return_value=KEYS) as scan, \
             patch.object(access, "trust_host", side_effect=trusted.append), \
             patch.object(access, "ensure_key", return_value="/keys/k"), \
             patch.object(access, "key_login", return_value=True), \
             patch.object(transport.SSHConnection, "request", return_value={"version": {"version": "2.0.0"}}):
            first = service.connect("umbrel.test")
            self.assertEqual(first["status"], "trust")
            self.assertEqual(first["keys"], [{"type": "ssh-ed25519", "fingerprint": "SHA256:abc"}])
            self.assertFalse(service.state()["connected"])
            second = service.connect("umbrel.test", trust=True)
            scan.assert_called_once()
        self.assertEqual(trusted, [KEYS])
        self.assertEqual(second["status"], "connected")
        self.assertEqual(service.state()["version"], "2.0.0")

    def test_trust_without_a_prior_prompt_scans_instead_of_trusting(self):
        service = Service()
        with patch.object(access, "known_host", return_value=False), \
             patch.object(access, "scan_host", return_value=KEYS), \
             patch.object(access, "trust_host") as trust:
            result = service.connect("umbrel.test", trust=True)
        self.assertEqual(result["status"], "trust")
        trust.assert_not_called()

    def test_unauthorized_key_needs_the_password_once_then_authorizes(self):
        service = Service()
        calls = []
        with patch.object(access, "known_host", return_value=True), \
             patch.object(access, "ensure_key", return_value="/keys/k"), \
             patch.object(access, "key_login", side_effect=[False, False, True]), \
             patch.object(access, "authorize", side_effect=lambda *args: calls.append(args)), \
             patch.object(transport.SSHConnection, "request", return_value={"version": {"version": "2.0.0"}}):
            with self.assertRaises(ApiError) as needed:
                service.connect("umbrel.test")
            self.assertEqual((needed.exception.status, needed.exception.code), (401, "password_required"))
            self.assertEqual(calls, [])
            result = service.connect("umbrel.test", password="secret")
        self.assertEqual(calls[0][:4], ("umbrel.test", "umbrel", 22, "/keys/k"))
        self.assertEqual(result["status"], "connected")
        self.assertEqual(service.connection.identity, "/keys/k")

    def test_disconnect_releases_the_sudo_password(self):
        service = Service()
        service.connection = transport.SSHConnection("umbrel.test", sudo_password="secret")
        service.disconnect()
        self.assertIsNone(service.connection)
        self.assertFalse(service.state()["connected"])

    def test_sudo_failures_are_turned_into_instructions(self):
        service = Service()
        with patch.object(access, "known_host", return_value=True), \
             patch.object(access, "ensure_key", return_value="/keys/k"), \
             patch.object(access, "key_login", return_value=True), \
             patch.object(transport.SSHConnection, "request", side_effect=transport.ConnectionError("sudo: a password is required")):
            with self.assertRaises(ApiError) as error:
                service.connect("umbrel.test")
        self.assertEqual(error.exception.message, "Umbrel needs your password for sudo. Enter it and connect again.")


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server_main.make_server(0, demo=True, token="test-token")
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def call(self, path, method="GET", body=None, headers=None, token="test-token"):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method,
                                         data=json.dumps(body).encode() if body is not None else None)
        if token:
            request.add_header(server_main.TOKEN_HEADER, token)
        if body is not None:
            request.add_header("Content-Type", "application/json")
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_api_requires_the_session_token(self):
        self.assertEqual(self.call("/api/state", token=None)[0], 401)
        self.assertEqual(self.call("/api/state", token="wrong")[0], 401)
        status, body = self.call("/api/state")
        self.assertEqual(status, 200)
        self.assertTrue(body["connected"])

    def test_foreign_host_and_cross_site_origin_are_refused(self):
        self.assertEqual(self.call("/api/state", headers={"Host": "evil.example"})[0], 403)
        status, body = self.call("/api/state", headers={"Origin": "http://evil.example"})
        self.assertEqual((status, body["code"]), (403, "origin"))
        self.assertEqual(self.call("/api/state", headers={"Origin": f"http://127.0.0.1:{self.port}"})[0], 200)

    def test_apps_and_logs_round_trip(self):
        status, body = self.call("/api/apps")
        self.assertEqual(status, 200)
        self.assertEqual(len(body["apps"]), 6)
        status, body = self.call("/api/apps/immich/logs")
        self.assertEqual(status, 200)
        self.assertIn("immich", body["text"])
        self.assertEqual(self.call("/api/apps/nope/logs")[0], 404)
        self.assertEqual(self.call("/api/nothing")[0], 404)

    def test_lifecycle_endpoint_posts_changes_state_and_needs_the_token(self):
        self.assertEqual(self.call("/api/apps/dockge/stop", method="POST", token=None)[0], 401)
        status, body = self.call("/api/apps/dockge/stop", method="POST", body={})
        self.assertEqual((status, body["state"]), (200, "stopped"))
        self.assertEqual(self.call("/api/apps/dockge/stop", method="POST", body={})[0], 409)
        self.assertEqual(self.call("/api/apps/dockge/start", method="POST", body={})[1]["state"], "ready")
        self.assertEqual(self.call("/api/apps/dockge/uninstall", method="POST", body={})[0], 404)
        self.assertEqual(self.call("/api/apps/dockge/stop")[0], 404)  # GET is not an action

    def test_usage_and_storage_endpoints_need_the_token_and_return_bytes(self):
        self.assertEqual(self.call("/api/usage", token=None)[0], 401)
        status, body = self.call("/api/usage")
        self.assertEqual(status, 200)
        self.assertIn("immich", body["apps"])
        status, body = self.call("/api/storage?refresh=1")
        self.assertEqual((status, body["apps"]["immich"]), (200, 412_000_000_000))
        self.assertEqual(self.call("/api/storage")[0], 200)

    def test_bad_json_and_oversized_bodies_are_rejected(self):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}/api/connect", method="POST", data=b"{not json")
        request.add_header(server_main.TOKEN_HEADER, "test-token")
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=10)
        self.assertEqual(error.exception.code, 400)

    def test_unbuilt_ui_says_how_to_build_it(self):
        with patch.object(server_main, "DIST", Path("does-not-exist")):
            status, body = self.call("/", token=None)
        self.assertEqual((status, body["code"]), (404, "no_build"))


class ProxyModeTests(unittest.TestCase):
    """Running as an Umbrel app: Umbrel's login proxy is the only way in, so the page is handed its token."""

    def start(self, **options):
        httpd = server_main.make_server(0, demo=True, token="t0ken", **options)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close()))
        return httpd

    def fetch(self, httpd, path, headers=None):
        request = urllib.request.Request(f"http://127.0.0.1:{httpd.server_address[1]}{path}")
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, response.read().decode()
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode()

    def page(self):
        folder = Path(self.enterContext(__import__("tempfile").TemporaryDirectory()))
        (folder / "index.html").write_text("<html><head><title>x</title></head><body></body></html>")
        return patch.object(server_main, "DIST", folder)

    def test_a_normal_launch_never_puts_the_token_in_the_page_and_stays_on_loopback(self):
        httpd = self.start()
        self.assertEqual(httpd.server_address[0], "127.0.0.1")
        with self.page():
            status, text = self.fetch(httpd, "/")
        self.assertEqual(status, 200)
        self.assertNotIn("t0ken", text)
        self.assertNotIn("umbrel-push-token", text)

    def test_proxy_mode_hands_the_page_its_token_and_a_default_host(self):
        httpd = self.start(behind_proxy=True, default_host='192.168.1.2"><script>')
        self.assertEqual(httpd.server_address[0], "0.0.0.0")
        with self.page():
            status, text = self.fetch(httpd, "/", {"Host": "umbrel.local"})
        self.assertEqual(status, 200)
        self.assertIn('<meta name="umbrel-push-token" content="t0ken">', text)
        self.assertIn('content="192.168.1.2&quot;&gt;&lt;script&gt;"', text)  # escaped, so it cannot break out of the tag
        self.assertNotIn("<script>", text)

    def test_proxy_mode_accepts_the_proxys_host_but_still_needs_the_token_and_same_origin(self):
        httpd = self.start(behind_proxy=True)
        host = {"Host": "umbrel.local"}
        self.assertEqual(self.fetch(httpd, "/api/state", host)[0], 401)
        self.assertEqual(self.fetch(httpd, "/api/state", {**host, TOKEN: "t0ken"})[0], 200)
        self.assertEqual(self.fetch(httpd, "/api/state", {**host, TOKEN: "t0ken", "Origin": "http://umbrel.local"})[0], 200)
        self.assertEqual(self.fetch(httpd, "/api/state", {**host, TOKEN: "t0ken", "Origin": "http://evil.example"})[0], 403)


TOKEN = server_main.TOKEN_HEADER


if __name__ == "__main__":
    unittest.main()
