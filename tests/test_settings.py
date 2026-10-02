import unittest

import yaml

from umbrel_push.catalog import hub_repository
from umbrel_push.package import PackageError, generate, validate
from umbrel_push.settings import (PortMapping, Volume, find_conflicts, parse_memory, parse_port, read_settings,
                                  replace_port, requested_ports, split_image, suggest_ports, write_settings)


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.files = generate("grafana", "grafana/grafana:11.2.0", "Grafana", 3000, 18990, "/var/lib/grafana")

    def test_read_maps_manifest_and_compose_onto_casaos_fields(self):
        settings = read_settings(self.files)
        self.assertEqual((settings.name, settings.dashboard_port, settings.web_port), ("Grafana", 18990, 3000))
        self.assertEqual(settings.image, "grafana/grafana:11.2.0")
        self.assertEqual(settings.service, "server")
        self.assertEqual(settings.volumes, [Volume("${APP_DATA_DIR}/data", "/var/lib/grafana")])
        self.assertEqual(settings.restart, "unless-stopped")
        self.assertEqual(settings.network, "bridge")
        self.assertEqual(settings.memory_mb, 0)

    def test_changing_the_image_changes_only_the_image_line(self):
        compose = (
            "# managed by hand\n"
            "services:\n"
            "  gladys:\n"
            "    image: gladysassistant/gladys:v4.48.0@sha256:536b970e\n"
            "    restart: on-failure\n"
            "    environment:\n"
            "      SERVER_PORT: 9212\n"
            "      NODE_ENV: 'production'  # keep quotes\n"
            "    volumes:\n"
            "    - /var/run/docker.sock:/var/run/docker.sock\n"
            "    - ${APP_DATA_DIR}/data:/var/lib/gladysassistant\n"
        )
        manifest = ('manifestVersion: 1\nid: gladys\nname: Gladys\nversion: "4.48.0"\nport: 9212\n'
                    'description: >-\n  First paragraph.\n\n  Second paragraph.\n  \ndeveloper: Someone\n'
                    'dependencies:\npath: ""\ndefaultUsername: ""\n')
        files = {"umbrel-app.yml": {"content": manifest, "mode": 0o644}, "docker-compose.yml": {"content": compose, "mode": 0o644}}
        settings = read_settings(files)
        settings.image = "gladysassistant/gladys:v5.1.3"
        written = write_settings(files, settings)
        before, after = compose.splitlines(), written["docker-compose.yml"]["content"].splitlines()
        self.assertEqual([(a, b) for a, b in zip(before, after) if a != b],
                         [("    image: gladysassistant/gladys:v4.48.0@sha256:536b970e", "    image: gladysassistant/gladys:v5.1.3")])
        self.assertEqual(len(before), len(after))
        self.assertEqual(written["umbrel-app.yml"]["content"], manifest)

    def test_write_round_trips_and_keeps_unknown_keys(self):
        compose = yaml.safe_load(self.files["docker-compose.yml"]["content"])
        compose["services"]["server"]["labels"] = {"keep": "me"}
        compose["services"]["server"]["environment"] = {"GF_SECURITY_ADMIN_USER": "admin"}
        self.files["docker-compose.yml"]["content"] = yaml.safe_dump(compose, sort_keys=False)
        settings = read_settings(self.files)
        settings.name = "Grafana Dashboards"
        settings.image = "grafana/grafana:11.3.0"
        settings.dashboard_port = 18991
        settings.web_port = 3001
        settings.path = "/login"
        settings.ports = [PortMapping(9094, 9094, "udp")]
        settings.volumes.append(Volume("${APP_DATA_DIR}/provisioning", "/etc/grafana/provisioning", "ro"))
        settings.environment.append(("GF_SECURITY_ADMIN_PASSWORD", "test-value"))
        settings.devices = ["/dev/dri:/dev/dri"]
        settings.command = "grafana server --homepath /usr/share/grafana"
        settings.privileged = True
        settings.memory_mb = 512
        settings.cpu_shares = 2048
        settings.restart = "always"
        settings.cap_add = ["NET_ADMIN"]
        settings.network = "host"
        written = write_settings(self.files, settings)
        manifest, _ = validate(written)
        service = yaml.safe_load(written["docker-compose.yml"]["content"])["services"]["server"]
        proxy = yaml.safe_load(written["docker-compose.yml"]["content"])["services"]["app_proxy"]
        self.assertEqual((manifest["name"], manifest["port"], manifest["path"]), ("Grafana Dashboards", 18991, "/login"))
        self.assertEqual(proxy["environment"]["APP_PORT"], "3001")
        self.assertEqual(service["image"], "grafana/grafana:11.3.0")
        self.assertEqual(service["labels"], {"keep": "me"})
        self.assertEqual(service["ports"], ["9094:9094/udp"])
        self.assertEqual(service["volumes"][1], "${APP_DATA_DIR}/provisioning:/etc/grafana/provisioning:ro")
        self.assertEqual(service["environment"]["GF_SECURITY_ADMIN_PASSWORD"], "test-value")
        self.assertEqual(service["devices"], ["/dev/dri:/dev/dri"])
        self.assertEqual(service["command"], ["grafana", "server", "--homepath", "/usr/share/grafana"])
        self.assertTrue(service["privileged"])
        self.assertEqual((service["mem_limit"], service["cpu_shares"], service["restart"]), ("512m", 2048, "always"))
        self.assertEqual((service["cap_add"], service["network_mode"]), (["NET_ADMIN"], "host"))
        again = read_settings(written)
        self.assertEqual(again.command, "grafana server --homepath /usr/share/grafana")
        self.assertEqual(again.memory_mb, 512)
        again.privileged, again.network, again.memory_mb, again.restart = False, "bridge", 0, "no"
        cleared = yaml.safe_load(write_settings(written, again)["docker-compose.yml"]["content"])["services"]["server"]
        for key in ("privileged", "network_mode", "mem_limit", "restart"):
            self.assertNotIn(key, cleared)

    def test_write_rejects_bad_values(self):
        settings = read_settings(self.files)
        settings.dashboard_port = 70000
        with self.assertRaises(PackageError):
            write_settings(self.files, settings)
        settings = read_settings(self.files)
        settings.name = "  "
        with self.assertRaises(PackageError):
            write_settings(self.files, settings)

    def test_image_and_port_parsing(self):
        self.assertEqual(split_image("ghcr.io/org/app:1.2"), ("ghcr.io/org/app", "1.2"))
        self.assertEqual(split_image("localhost:5000/app"), ("localhost:5000/app", ""))
        self.assertEqual(split_image("nginx@sha256:abc"), ("nginx", "@sha256:abc"))
        self.assertEqual(parse_port("127.0.0.1:8080:80/udp"), PortMapping(8080, 80, "udp", "127.0.0.1"))
        self.assertEqual(parse_port({"published": 9000, "target": 9000}), PortMapping(9000, 9000, "tcp", None))
        self.assertIsNone(parse_port("8080"))
        self.assertEqual(parse_memory("2g"), 2048)
        self.assertEqual(parse_memory(1024 ** 3), 1024)

    def test_conflicts_suggestions_and_replacement(self):
        compose = yaml.safe_load(self.files["docker-compose.yml"]["content"])
        compose["services"]["server"]["ports"] = ["3000:3000", "9094:9094/udp"]
        self.files["docker-compose.yml"]["content"] = yaml.safe_dump(compose, sort_keys=False)
        self.assertEqual(requested_ports(self.files), (18990, [3000, 9094]))
        used = {3000: "Grafana (dashboard)", 18990: "Umbrel Push Test (dashboard)", 18991: "x", 22: "a service on the Umbrel"}
        conflicts = find_conflicts(self.files, used)
        self.assertEqual([(c.port, c.kind) for c in conflicts], [(18990, "dashboard"), (3000, "published")])
        self.assertEqual(find_conflicts(self.files, used, own={18990, 3000}), [])
        suggestions = suggest_ports(used, 18990, count=3)
        self.assertEqual(suggestions, [18992, 18993, 18994])
        self.assertEqual(suggest_ports(used, 3000, count=2, taken={3001}), [3002, 3003])
        moved = replace_port(replace_port(self.files, 18990, 18992), 3000, 3100)
        manifest, _ = validate(moved)
        self.assertEqual(manifest["port"], 18992)
        self.assertEqual(yaml.safe_load(moved["docker-compose.yml"]["content"])["services"]["server"]["ports"], ["3100:3000", "9094:9094/udp"])

    def test_hub_repository_detection(self):
        self.assertEqual(hub_repository("nginx:latest"), "library/nginx")
        self.assertEqual(hub_repository("grafana/grafana:11.2"), "grafana/grafana")
        self.assertIsNone(hub_repository("ghcr.io/paperless-ngx/paperless-ngx:2.14"))
        self.assertIsNone(hub_repository("localhost:5000/app"))
        self.assertIsNone(hub_repository("a/b/c"))


if __name__ == "__main__":
    unittest.main()
