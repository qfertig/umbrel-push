import contextlib
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from umbrel_push import remote
from umbrel_push.package import digest, generate


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.files = generate("push-smoke", "nginx:latest", "Test", 80, 18991)
        self.current = {"files": self.files, "baseline": digest(self.files), "origin": {"kind": "existing"}}
        self.apps = [{"id": "push-smoke", "state": "ready", "autoStart": True}]

    def test_local_and_remote_hash_contract(self):
        self.assertEqual(digest(self.files), remote.digest(self.files))

    def test_stale_edits_never_stop_an_app(self):
        with patch.object(remote, "retrieve", return_value=self.current), patch.object(remote, "client") as client:
            with self.assertRaisesRegex(RuntimeError, "changed since retrieval"):
                remote.apply(Path("/test"), "push-smoke", self.files, "stale", self.apps)
            client.assert_not_called()

    def test_lifecycle_failure_restores_configuration_and_attempts_start(self):
        edited = copy.deepcopy(self.files)
        edited["docker-compose.yml"]["content"] += "\n# edit\n"
        with patch.object(remote, "retrieve", return_value=self.current), \
             patch.object(remote, "snapshot", return_value="backup-1"), \
             patch.object(remote, "read_files", return_value=self.files), \
             patch.object(remote, "write_files") as write, \
             patch.object(remote, "client", side_effect=[True, RuntimeError("start failed"), True]) as client:
            with self.assertRaisesRegex(RuntimeError, "previous configuration restored"):
                remote.apply(Path("/test"), "push-smoke", edited, self.current["baseline"], self.apps)
            self.assertEqual(write.call_count, 2)
            self.assertEqual(write.call_args.args[1], self.files)
            self.assertEqual([c.args[1] for c in client.call_args_list],
                             ["apps.stop.mutate", "apps.start.mutate", "apps.start.mutate"])

    def test_stopped_app_is_not_started_or_stopped(self):
        with patch.object(remote, "retrieve", side_effect=[copy.deepcopy(self.current), copy.deepcopy(self.current)]), \
             patch.object(remote, "snapshot", return_value="backup-1"), \
             patch.object(remote, "read_files", return_value=self.files), \
             patch.object(remote, "write_files"), patch.object(remote, "remember"), \
             patch.object(remote, "origin", return_value={"kind": "existing"}), patch.object(remote, "client") as client:
            remote.apply(Path("/test"), "push-smoke", self.files, self.current["baseline"],
                         [{"id": "push-smoke", "state": "stopped", "autoStart": False}])
            client.assert_not_called()

    @staticmethod
    def unlocked():
        """The real lock needs fcntl, which only exists where the worker runs (Linux)."""
        return patch.object(remote, "operation_lock", return_value=contextlib.nullcontext())

    def lifecycle(self, action, states, version="2.0.0"):
        """Run remote.lifecycle against a temp root; `states` are the app's state before and after."""
        listing = [[{"id": "push-smoke", "state": state}] for state in states]
        with tempfile.TemporaryDirectory() as temp, self.unlocked(), \
             patch.object(remote, "client", side_effect=[listing[0], True, listing[-1]]) as client:
            result = remote.lifecycle(Path(temp), "push-smoke", action, {"version": version})
        return result, [c.args[1:] for c in client.call_args_list]

    def test_start_stop_and_restart_call_the_matching_umbreld_procedure(self):
        result, calls = self.lifecycle("start", ["stopped", "ready"])
        self.assertEqual(result, {"appId": "push-smoke", "action": "start", "state": "ready"})
        self.assertEqual(calls, [("apps.list.query",), ("apps.start.mutate", {"appId": "push-smoke"}), ("apps.list.query",)])
        self.assertEqual(self.lifecycle("stop", ["ready", "stopped"])[1][1], ("apps.stop.mutate", {"appId": "push-smoke"}))
        self.assertEqual(self.lifecycle("restart", ["running", "ready"])[1][1], ("apps.restart.mutate", {"appId": "push-smoke"}))

    def test_lifecycle_refuses_a_state_where_the_action_makes_no_sense(self):
        for action, state in (("start", "ready"), ("stop", "stopped"), ("restart", "stopped"), ("stop", "updating"), ("start", "starting")):
            with tempfile.TemporaryDirectory() as temp, self.unlocked(), \
                 patch.object(remote, "client", return_value=[{"id": "push-smoke", "state": state}]) as client:
                with self.assertRaisesRegex(RuntimeError, f"Cannot {action} push-smoke while it is {state}"):
                    remote.lifecycle(Path(temp), "push-smoke", action, {"version": "2.0.0"})
                self.assertEqual([c.args[1] for c in client.call_args_list], ["apps.list.query"])

    def test_lifecycle_is_read_only_on_an_unverified_version_and_rejects_unknown_actions(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(remote, "client") as client:
            with self.assertRaisesRegex(RuntimeError, "verified Umbrel 2.0.0"):
                remote.lifecycle(Path(temp), "push-smoke", "stop", {"version": "2.1.0"})
            with self.assertRaisesRegex(RuntimeError, "Unknown operation"):
                remote.lifecycle(Path(temp), "push-smoke", "uninstall", {"version": "2.0.0"})
            client.assert_not_called()

    def test_lifecycle_names_an_app_that_is_not_installed(self):
        with tempfile.TemporaryDirectory() as temp, self.unlocked(), patch.object(remote, "client", return_value=[]):
            with self.assertRaisesRegex(RuntimeError, "push-smoke is not installed"):
                remote.lifecycle(Path(temp), "push-smoke", "start", {"version": "2.0.0"})

    def test_memory_usage_is_reduced_to_bytes_per_app(self):
        reply = {"size": 16_000_000_000, "totalUsed": 6_000_000_000, "system": 1, "machines": [],
                 "apps": [{"id": "immich", "used": 2_100_000_000}, {"id": "dockge", "used": 90_000_000}]}
        with patch.object(remote, "client", return_value=reply) as client:
            usage = remote.memory_usage(Path("/test"))
        client.assert_called_once_with(Path("/test"), "system.memoryUsage.query")
        self.assertEqual(usage, {"size": 16_000_000_000, "used": 6_000_000_000, "apps": {"immich": 2_100_000_000, "dockge": 90_000_000}})

    def test_disk_usage_is_reduced_to_bytes_per_app(self):
        reply = {"size": 2_000_000_000_000, "totalUsed": 500_000_000_000, "available": 1_500_000_000_000, "system": 1, "files": 2, "machines": [],
                 "apps": [{"id": "immich", "used": 412_000_000_000}]}
        with patch.object(remote, "client", return_value=reply) as client:
            usage = remote.disk_usage(Path("/test"))
        client.assert_called_once_with(Path("/test"), "system.diskUsage.query")
        self.assertEqual(usage["apps"], {"immich": 412_000_000_000})
        self.assertEqual((usage["size"], usage["used"], usage["available"]), (2_000_000_000_000, 500_000_000_000, 1_500_000_000_000))

    def test_usage_reports_an_incompatible_umbreld_instead_of_guessing(self):
        with patch.object(remote, "client", return_value={"size": 1}):
            with self.assertRaisesRegex(RuntimeError, "Unexpected memory usage response"):
                remote.memory_usage(Path("/test"))
            with self.assertRaisesRegex(RuntimeError, "Unexpected storage usage response"):
                remote.disk_usage(Path("/test"))

    def test_worker_rejects_live_data_payload(self):
        self.files["data/db.template"] = {"content": "bad", "mode": 0o644}
        with self.assertRaisesRegex(RuntimeError, "Invalid package"):
            remote.check_files(self.files)

    def test_path_confinement(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(RuntimeError):
                remote.confined(root, "../outside")

    def test_published_ports_and_listening_parse(self):
        compose = {"services": {"app_proxy": {"ports": ["1:1"]}, "web": {"ports": ["3000:3000", "127.0.0.1:9094:9094/udp", {"published": 8443, "target": 443}]}}}
        self.assertEqual(remote.published_ports(compose), [3000, 9094, 8443])
        output = "LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*\nLISTEN 0 511 *:80 *:*\nLISTEN 0 128 [::1]:631 [::]:*\n"
        with patch.object(remote, "run", return_value=output):
            self.assertEqual(remote.listening_ports(), {22, 80, 631})

    def test_used_ports_attributes_owners_and_excludes_the_edited_app(self):
        apps = [{"id": "grafana", "name": "Grafana", "port": 3000}, {"id": "push-smoke", "name": "Test", "port": 18991}]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app-data" / "grafana").mkdir(parents=True)
            (root / "app-data" / "grafana" / "docker-compose.yml").write_text("x")
            with patch.object(remote, "yaml_read", return_value={"services": {"g": {"ports": ["9094:9094"]}}}), \
                 patch.object(remote, "listening_ports", return_value={22, 3000, 18991}):
                used, own = remote.used_ports(root, exclude="push-smoke", apps=apps)
        self.assertEqual(used, {3000: "Grafana (dashboard)", 9094: "Grafana", 22: "a service on the Umbrel"})
        self.assertEqual(own, {18991})


if __name__ == "__main__":
    unittest.main()
