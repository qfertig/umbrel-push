import tempfile
import unittest
from pathlib import Path

import yaml

from umbrel_push.package import PackageError, app_id, digest, generate, read_package, safe_name, validate, write_package


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.files = generate("push-smoke", "nginx", "Push test", 80, 18991)

    def test_generator_separates_manifest_version_image_and_web_ports(self):
        manifest = yaml.safe_load(self.files["umbrel-app.yml"]["content"])
        compose = yaml.safe_load(self.files["docker-compose.yml"]["content"])
        self.assertEqual(manifest["version"], "1.0.0")
        self.assertEqual(manifest["port"], 18991)
        self.assertEqual(compose["services"]["server"]["image"], "nginx:latest")
        self.assertEqual(compose["services"]["app_proxy"]["environment"]["APP_PORT"], "80")
        self.assertNotIn("ports", compose["services"]["server"])

    def test_rejects_traversal_and_runtime_files(self):
        for name in ("../docker-compose.yml", "/umbrel-app.yml", "data/file.template", "settings.yml",
                     "docker-compose.umbreld.yml", "hooks/../../exports.sh", "hooks\\pre-start", "C:/exports.sh"):
            with self.subTest(name=name), self.assertRaises(PackageError):
                safe_name(name)

    def test_rejects_id_injection(self):
        for value in ("../app", "app;whoami", "$(id)", "--help", "", "a" * 81):
            with self.subTest(value=value), self.assertRaises(PackageError):
                app_id(value)

    def test_export_derived_image_is_retained_for_existing_apps(self):
        self.files["docker-compose.yml"]["content"] = "services:\n  server:\n    image: ${APP_IMAGE}\n"
        validate(self.files)

    def test_refuses_build_context_instead_of_silently_omitting_files(self):
        self.files["docker-compose.yml"]["content"] = "services:\n  server:\n    image: custom:latest\n    build: .\n"
        with self.assertRaises(PackageError):
            validate(self.files)

    def test_roundtrip_and_baseline_with_executable_hooks(self):
        self.files["hooks/pre-start"] = {"content": "#!/bin/sh\ntrue\n", "mode": 0o755}
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "package"
            write_package(directory, self.files, {"baseline": digest(self.files)})
            result, state = read_package(directory)
            self.assertEqual(digest(result), state["baseline"])
            self.assertEqual(result["hooks/pre-start"]["mode"], 0o755)
            with self.assertRaises(PackageError):
                write_package(directory, self.files)

    def test_numeric_app_version_requires_quotes(self):
        manifest = yaml.safe_load(self.files["umbrel-app.yml"]["content"])
        manifest["version"] = 1.2
        self.files["umbrel-app.yml"]["content"] = yaml.safe_dump(manifest)
        with self.assertRaises(PackageError):
            validate(self.files)

    def test_official_manifest_feature_versions_match_umbrel_two(self):
        manifest = yaml.safe_load(self.files["umbrel-app.yml"]["content"])
        for version in (1, 1.1, "1.1.0", "2.0.0"):
            manifest["manifestVersion"] = version
            self.files["umbrel-app.yml"]["content"] = yaml.safe_dump(manifest)
            validate(self.files)
        manifest["manifestVersion"] = "2.0.1"
        self.files["umbrel-app.yml"]["content"] = yaml.safe_dump(manifest)
        with self.assertRaises(PackageError):
            validate(self.files)


if __name__ == "__main__":
    unittest.main()
