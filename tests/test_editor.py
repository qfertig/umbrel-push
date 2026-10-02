import base64
import copy
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import editor, main as server_main  # noqa: E402
from server.api import ApiError, Service, package, transport  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def sample_files():
    return package.generate("gladys-test", "gladysassistant/gladys:v4.48.0", "Gladys Test", 80, 19001, "/config")


class EditorTests(unittest.TestCase):
    def test_settings_round_trip_changes_only_the_image_tag(self):
        files = sample_files()
        settings = editor.read_settings(files)["settings"]
        self.assertEqual(settings["image"], "gladysassistant/gladys:v4.48.0")
        self.assertEqual((settings["dashboardPort"], settings["webPort"]), (19001, 80))
        settings["image"] = "gladysassistant/gladys:v4.55.0"
        changed = editor.write_settings(files, settings)["files"]
        self.assertIn("v4.55.0", changed["docker-compose.yml"]["content"])
        self.assertEqual(changed["umbrel-app.yml"]["content"], files["umbrel-app.yml"]["content"])
        self.assertEqual(editor.read_settings(changed)["settings"]["image"], "gladysassistant/gladys:v4.55.0")

    def test_every_field_survives_a_round_trip(self):
        files = sample_files()
        settings = editor.read_settings(files)["settings"]
        settings.update(name="Renamed", version="2.0.0", path="/ui", containerName="gladys", network="host", restart="always",
                        memoryMb=512, cpuShares=1024, command="serve --port 80", privileged=True, capAdd=["NET_ADMIN"],
                        devices=["/dev/ttyUSB0:/dev/ttyUSB0"], environment=[["TZ", "America/New_York"]],
                        ports=[{"host": 19002, "container": 8080, "protocol": "udp", "ip": None}],
                        volumes=[{"host": "${APP_DATA_DIR}/db", "container": "/var/lib/db", "mode": "ro"}])
        again = editor.read_settings(editor.write_settings(files, settings)["files"])["settings"]
        for key in ("name", "version", "path", "containerName", "network", "restart", "memoryMb", "cpuShares", "command", "privileged",
                    "capAdd", "devices", "environment", "ports", "volumes"):
            self.assertEqual(again[key], settings[key], key)

    def test_bad_settings_are_refused_with_the_sentence_the_qt_form_uses(self):
        files = sample_files()
        good = editor.read_settings(files)["settings"]
        cases = (
            ({"ports": [{"host": "80", "container": 80}]}, "must use numbers"),
            ({"ports": [{"host": 0, "container": 80}]}, "published host port must be a whole number"),
            ({"ports": [{"host": 80, "container": 80, "protocol": "sctp"}]}, "tcp or udp"),
            ({"volumes": [{"host": "/data", "container": "relative"}]}, "absolute container path"),
            ({"volumes": [{"host": "", "container": "/data"}]}, "needs a host path"),
            ({"network": "overlay"}, "bridge or host"),
            ({"icon": "javascript:alert(1)"}, "an embedded PNG, JPEG, or WebP image"),
            ({"dashboardPort": 70000}, "dashboard port must be a whole number"),
            ({"memoryMb": -5}, "memory limit"),
            ({"environment": [["ONLY_A_NAME"]]}, "name and a value"),
        )
        for change, message in cases:
            with self.assertRaisesRegex(editor.PackageError, message):
                editor.write_settings(files, {**good, **change})
        with self.assertRaisesRegex(editor.PackageError, "title"):
            editor.write_settings(files, {**good, "name": "  "})
        with self.assertRaisesRegex(editor.PackageError, "image cannot be empty"):
            editor.write_settings(files, {**good, "image": ""})

    def test_files_from_the_browser_are_checked_for_shape(self):
        for bad in (None, {}, {"a.yml": "text"}, {"umbrel-app.yml": {"content": 5}}, {"umbrel-app.yml": {"content": "x", "mode": 99999}}):
            with self.assertRaises(editor.PackageError):
                editor.clean_files(bad)
        with self.assertRaisesRegex(editor.PackageError, "Not an editable package source file"):
            editor.validate({**sample_files(), "data/db.sqlite": {"content": "x", "mode": 0o644}})

    def test_a_package_without_a_settings_view_still_opens(self):
        files = sample_files()
        files["docker-compose.yml"]["content"] = "services: {}\n"
        result = editor.read_settings(files)
        self.assertIsNone(result["settings"])
        self.assertIn("settings view is unavailable", result["error"])

    def test_diff_against_nothing_marks_every_line_added_and_a_real_change_shows_both_versions(self):
        files = sample_files()
        self.assertIn("+services:", editor.diff({}, files)["diff"])
        changed = copy.deepcopy(files)
        changed["docker-compose.yml"]["content"] = changed["docker-compose.yml"]["content"].replace("v4.48.0", "v4.55.0")
        text = editor.diff(files, changed)["diff"]
        self.assertIn("-    image: gladysassistant/gladys:v4.48.0", text)
        self.assertIn("+    image: gladysassistant/gladys:v4.55.0", text)

    def test_replace_port_moves_the_dashboard_port(self):
        moved = editor.replace_port(sample_files(), 19001, 19005)["files"]
        self.assertEqual(editor.read_settings(moved)["settings"]["dashboardPort"], 19005)
        with self.assertRaises(editor.PackageError):
            editor.replace_port(sample_files(), "19001", 19005)

    def test_generate_builds_a_valid_package_and_refuses_bad_input(self):
        files = editor.generate({"id": "my-app", "name": "My app", "image": "nginx:1.27", "containerPort": 80, "port": 18990, "dataPath": "/config"})["files"]
        self.assertEqual(editor.validate(files)["manifest"]["id"], "my-app")
        for bad in ({"id": "My App"}, {"id": "my-app", "name": "", "image": "nginx", "containerPort": 80, "port": 1},
                    {"id": "my-app", "name": "A", "image": "bad image", "containerPort": 80, "port": 1},
                    {"id": "my-app", "name": "A", "image": "nginx", "containerPort": 0, "port": 1}):
            with self.assertRaises(editor.PackageError):
                editor.generate(bad)

    def test_tags_come_from_docker_hub_only_for_docker_hub_images(self):
        with patch.object(editor.catalog, "image_tags", return_value=["v4.55.0", "v4.54.0"]) as lookup:
            result = editor.image_tags("gladysassistant/gladys:v4.48.0")
        lookup.assert_called_once()
        self.assertEqual(result, {"image": "gladysassistant/gladys:v4.48.0", "tags": ["v4.55.0", "v4.54.0"], "registry": "docker-hub"})
        with patch.object(editor.catalog, "image_tags") as lookup:
            other = editor.image_tags("ghcr.io/immich-app/immich-server:v2.4.1")
        lookup.assert_not_called()
        self.assertEqual((other["tags"], other["registry"]), ([], "other"))
        with patch.object(editor.catalog, "image_tags", side_effect=OSError("timed out")):
            with self.assertRaises(ApiError) as failed:
                editor.image_tags("nginx")
        self.assertEqual((failed.exception.status, failed.exception.code), (502, "lookup"))
        self.assertIn("Docker Hub could not be reached", failed.exception.message)

    def test_an_uploaded_icon_is_checked_and_embedded(self):
        result = editor.embed_icon(base64.b64encode(PNG).decode())
        self.assertTrue(result["icon"].startswith("data:image/png;base64,"))
        with self.assertRaisesRegex(editor.PackageError, "PNG, JPEG, or WebP"):
            editor.embed_icon(base64.b64encode(b"GIF89a....").decode())
        with self.assertRaisesRegex(editor.PackageError, "could not be read"):
            editor.embed_icon("not base64 !!!")


class GladysDemoTests(unittest.TestCase):
    """The user's own case: Gladys is behind, change its tag, review, apply."""

    def setUp(self):
        self.service = Service(demo=True)

    def test_retrieve_returns_the_files_baseline_images_and_the_structured_settings(self):
        view = self.service.retrieve("community-gladys")
        self.assertEqual(view["appId"], "community-gladys")
        self.assertEqual(view["settings"]["image"], "gladysassistant/gladys:v4.48.0")
        self.assertEqual(view["images"][0]["configuredImage"], "gladysassistant/gladys:v4.48.0")
        self.assertEqual(view["origin"]["kind"], "community")
        self.assertEqual(len(view["baseline"]), 64)
        self.assertIn("docker-compose.yml", view["files"])

    def test_change_the_tag_review_it_and_apply_it(self):
        view = self.service.retrieve("community-gladys")
        settings = {**view["settings"], "image": "gladysassistant/gladys:v4.55.0"}
        edited = editor.write_settings(view["files"], settings)["files"]
        review = self.service.review("community-gladys", edited, view["baseline"])
        self.assertIn("+    image: gladysassistant/gladys:v4.55.0", review["diff"])
        self.assertIn("-    image: gladysassistant/gladys:v4.48.0", review["diff"])
        self.assertEqual(self.service.review("community-gladys", view["files"], view["baseline"])["diff"], "No YAML changes.")

        applied = self.service.push("community-gladys", edited, view["baseline"], pull=True)
        self.assertEqual(applied["settings"]["image"], "gladysassistant/gladys:v4.55.0")
        self.assertEqual(applied["images"][0]["configuredImage"], "gladysassistant/gladys:v4.55.0")
        self.assertNotEqual(applied["baseline"], view["baseline"])
        self.assertTrue(applied["backup"])
        self.assertEqual(self.service.retrieve("community-gladys")["settings"]["image"], "gladysassistant/gladys:v4.55.0")

    def test_a_stale_edit_is_refused_and_changes_nothing(self):
        view = self.service.retrieve("community-gladys")
        edited = editor.write_settings(view["files"], {**view["settings"], "image": "gladysassistant/gladys:v4.52.0"})["files"]
        self.service.push("community-gladys", edited, view["baseline"])
        again = editor.write_settings(view["files"], {**view["settings"], "image": "gladysassistant/gladys:v4.50.0"})["files"]
        for action in (lambda: self.service.review("community-gladys", again, view["baseline"]),
                       lambda: self.service.push("community-gladys", again, view["baseline"])):
            with self.assertRaises(ApiError) as stale:
                action()
            self.assertEqual((stale.exception.status, stale.exception.code), (409, "stale"))
        self.assertEqual(self.service.retrieve("community-gladys")["settings"]["image"], "gladysassistant/gladys:v4.52.0")

    def test_a_retrieved_app_cannot_be_renamed_into_another_app(self):
        view = self.service.retrieve("community-gladys")
        settings = {**view["settings"], "appId": "other-app"}
        renamed = copy.deepcopy(view["files"])
        renamed["umbrel-app.yml"]["content"] = renamed["umbrel-app.yml"]["content"].replace("id: community-gladys", "id: other-app")
        with self.assertRaises(ApiError) as error:
            self.service.push("community-gladys", renamed, view["baseline"])
        self.assertEqual((error.exception.status, error.exception.code), (400, "id"))
        self.assertEqual(settings["appId"], "other-app")

    def test_ports_already_used_are_reported_with_free_alternatives(self):
        view = self.service.retrieve("community-gladys")
        own = self.service.ports("community-gladys", view["files"])
        self.assertEqual(own["conflicts"], [])  # its own dashboard port is not a conflict
        moved = editor.replace_port(view["files"], 9212, 5001)["files"]  # Dockge's dashboard port
        result = self.service.ports("community-gladys", moved)
        self.assertEqual([(c["port"], c["kind"]) for c in result["conflicts"]], [(5001, "dashboard")])
        self.assertIn("Dockge", result["conflicts"][0]["owner"])
        self.assertTrue(result["conflicts"][0]["suggestions"])
        self.assertNotIn(5001, result["conflicts"][0]["suggestions"])
        self.assertIn("5001", result["used"])

    def test_a_new_app_is_reviewed_against_nothing_and_then_installed(self):
        files = editor.generate({"id": "my-app", "name": "My App", "image": "nginx:1.27", "containerPort": 80, "port": 18990})["files"]
        self.assertIn("+services:", self.service.review("my-app", files, None)["diff"])
        installed = self.service.push("my-app", files, None)
        self.assertIsNone(installed["backup"])
        self.assertEqual(installed["origin"]["kind"], "custom")
        self.assertIn("my-app", [app["id"] for app in self.service.apps()["apps"]])
        with self.assertRaises(ApiError):  # a retrieved app that vanished is never recreated silently
            self.service.push("ghost-app", files, "a" * 64)

    def test_tags_and_search_work_in_the_demo(self):
        tags = self.service.image_tags("gladysassistant/gladys:v4.48.0")
        self.assertEqual(tags["registry"], "docker-hub")
        self.assertIn("v4.55.0", tags["tags"])
        self.assertEqual(self.service.image_tags("ghcr.io/org/app:1")["tags"], [])
        self.assertEqual([hit["name"] for hit in self.service.search_images("glad")["results"]], ["gladysassistant/gladys"])


class RealConnectionTests(unittest.TestCase):
    def setUp(self):
        self.service = Service()
        self.service.connection = transport.SSHConnection("umbrel.test")
        self.files = sample_files()
        self.retrieved = {"appId": "gladys-test", "files": self.files, "baseline": package.digest(self.files),
                          "origin": {"kind": "community"}, "images": [], "manifest": {}}

    def test_retrieve_goes_through_the_core_and_adds_the_settings(self):
        with patch.object(transport.SSHConnection, "request", return_value=self.retrieved) as request:
            view = self.service.retrieve("gladys-test")
        request.assert_called_once_with("retrieve", appId="gladys-test")
        self.assertEqual(view["settings"]["image"], "gladysassistant/gladys:v4.48.0")

    def test_push_sends_the_baseline_and_the_pull_choice_and_returns_the_installed_copy(self):
        reply = {**self.retrieved, "backup": "20261001T120000Z-abc"}
        with patch.object(transport.SSHConnection, "request", return_value=reply) as request:
            result = self.service.push("gladys-test", self.files, self.retrieved["baseline"], pull=True)
        name, kwargs = request.call_args.args[0], request.call_args.kwargs
        self.assertEqual((name, kwargs["appId"], kwargs["baseline"], kwargs["pull"]), ("push", "gladys-test", self.retrieved["baseline"], True))
        self.assertEqual(result["backup"], "20261001T120000Z-abc")
        with patch.object(transport.SSHConnection, "request", return_value=reply) as request:
            self.service.push("gladys-test", self.files, None)
        self.assertIsNone(request.call_args.kwargs["baseline"])
        self.assertFalse(request.call_args.kwargs["pull"])

    def test_the_umbrels_refusals_keep_their_wording_and_get_the_right_status(self):
        cases = (
            ("Installed files changed since retrieval. Retrieve again and merge your changes.", 409, "stale"),
            ("Cannot stop gladys-test while it is stopped.", 409, "state"),
            ("Apply failed; previous configuration restored. Backup abc.", 502, "ssh"),
        )
        for message, status, code in cases:
            with patch.object(transport.SSHConnection, "request", side_effect=transport.ConnectionError(message)):
                with self.assertRaises(ApiError) as error:
                    self.service.push("gladys-test", self.files, self.retrieved["baseline"])
            self.assertEqual((error.exception.status, error.exception.code, error.exception.message), (status, code, message))

    def test_ports_are_read_from_the_umbrel_and_the_apps_own_ports_are_not_conflicts(self):
        reply = {"used": {"19001": "Gladys Test (dashboard)", "3000": "Grafana (dashboard)", "22": "a service on the Umbrel"}, "own": [19001]}
        files = editor.replace_port(self.files, 19001, 3000)["files"]
        with patch.object(transport.SSHConnection, "request", return_value=reply):
            result = self.service.ports("gladys-test", files)
        self.assertEqual([(c["port"], c["owner"]) for c in result["conflicts"]], [(3000, "Grafana (dashboard)")])

    def test_everything_needs_a_connection_and_a_valid_app_id(self):
        with self.assertRaises(ApiError) as unconnected:
            Service().retrieve("gladys-test")
        self.assertEqual(unconnected.exception.status, 409)
        with self.assertRaises(ApiError) as invalid:
            self.service.retrieve("../etc")
        self.assertEqual(invalid.exception.status, 400)


class EditorHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server_main.make_server(0, demo=True, token="test-token")
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def call(self, path, method="GET", body=None, token="test-token"):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method, data=json.dumps(body).encode() if body is not None else None)
        if token:
            request.add_header(server_main.TOKEN_HEADER, token)
        if body is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_the_editor_endpoints_need_the_token(self):
        for method, path in (("POST", "/api/apps/community-gladys/retrieve"), ("POST", "/api/package/validate"), ("GET", "/api/images/tags?image=nginx")):
            self.assertEqual(self.call(path, method, {} if method == "POST" else None, token=None)[0], 401, path)

    def test_a_full_edit_cycle_over_http(self):
        status, view = self.call("/api/apps/community-gladys/retrieve", "POST", {})
        self.assertEqual((status, view["settings"]["image"]), (200, "gladysassistant/gladys:v4.48.0"))
        status, written = self.call("/api/package/settings/write", "POST", {"files": view["files"], "settings": {**view["settings"], "image": "gladysassistant/gladys:v4.54.1"}})
        self.assertEqual(status, 200)
        status, reviewed = self.call("/api/apps/community-gladys/review", "POST", {"files": written["files"], "baseline": view["baseline"]})
        self.assertEqual(status, 200)
        self.assertIn("v4.54.1", reviewed["diff"])
        status, applied = self.call("/api/apps/community-gladys/push", "POST", {"files": written["files"], "baseline": view["baseline"], "pull": True})
        self.assertEqual((status, applied["settings"]["image"]), (200, "gladysassistant/gladys:v4.54.1"))
        status, stale = self.call("/api/apps/community-gladys/push", "POST", {"files": written["files"], "baseline": view["baseline"]})
        self.assertEqual((status, stale["code"]), (409, "stale"))

    def test_bad_input_is_a_400_with_the_cores_sentence_and_lookups_work(self):
        status, body = self.call("/api/package/validate", "POST", {"files": {"umbrel-app.yml": {"content": "id: x"}}})
        self.assertEqual((status, body["code"]), (400, "invalid"))
        self.assertEqual(self.call("/api/package/diff", "POST", {"before": {}, "after": "nope"})[0], 400)
        status, body = self.call("/api/images/tags?image=gladysassistant/gladys")
        self.assertEqual((status, body["registry"]), (200, "docker-hub"))
        self.assertEqual(self.call("/api/images/tags?image=")[0], 400)
        self.assertEqual(self.call("/api/images/search?q=nginx")[1]["results"][0]["name"], "nginx")
        self.assertEqual(self.call("/api/package/nothing", "POST", {})[0], 404)


if __name__ == "__main__":
    unittest.main()
