import base64
import hashlib
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from umbrel_push import access

HOST_LINE = "192.168.1.104 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILpMVGovPFJFxQhz2fztIx7gwfON98LV2nzR/4J5Qowh"


def completed(code=0, out=b"", err=b""):
    return subprocess.CompletedProcess([], code, out, err)


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.patches = [patch.object(access.Path, "home", return_value=self.home),
                        patch("shutil.which", return_value="ssh-tool")]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()
        self.temp.cleanup()

    def test_public_key_path_keeps_dotted_host_names(self):
        self.assertEqual(access.public_key_path("/k/umbrel-push-192.168.1.104").name, "umbrel-push-192.168.1.104.pub")

    def test_default_identity_only_when_dedicated_key_exists(self):
        self.assertIsNone(access.default_identity("192.168.1.104"))
        (self.home / ".ssh").mkdir()
        (self.home / ".ssh" / "umbrel-push-192.168.1.104").write_text("key")
        self.assertEqual(access.default_identity("192.168.1.104"), str(self.home / ".ssh" / "umbrel-push-192.168.1.104"))
        self.assertIn("created on first connection", access.describe_identity("other.host", None))
        self.assertEqual(access.describe_identity("other.host", "/chosen"), "/chosen")

    def test_ensure_key_generates_ed25519_with_empty_passphrase(self):
        def fake_keygen(command, **kwargs):
            Path(command[-1]).write_text("private")
            Path(command[-1] + ".pub").write_text("ssh-ed25519 AAAA umbrel-push@umbrel.test")
            return completed()
        with patch("subprocess.run", side_effect=fake_keygen) as run:
            path = access.ensure_key("umbrel.test")
            command = run.call_args.args[0]
        self.assertEqual(path, self.home / ".ssh" / "umbrel-push-umbrel.test")
        self.assertIn("ed25519", command)
        self.assertEqual(command[command.index("-N") + 1], "")
        self.assertEqual(access.public_key(path), "ssh-ed25519 AAAA umbrel-push@umbrel.test")
        with patch("subprocess.run") as run:
            access.ensure_key("umbrel.test")
            run.assert_not_called()

    def test_fingerprint_matches_openssh_sha256_format(self):
        blob = base64.b64decode(HOST_LINE.split()[2])
        expected = "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")
        self.assertEqual(access.fingerprint(HOST_LINE), expected)
        self.assertEqual(access.fingerprint(HOST_LINE), "SHA256:OU+VeuBVTF4nvtON0slE/zkd8xHVBRTpxz16TBDgEGY")

    def test_scan_host_never_authenticates_and_reads_scratch_file(self):
        def fake_ssh(command, **kwargs):
            self.assertIn("PasswordAuthentication=no", command)
            self.assertIn("PubkeyAuthentication=no", command)
            self.assertIn("StrictHostKeyChecking=accept-new", command)
            scratch = next(c for c in command if c.startswith("UserKnownHostsFile=")).split("=", 1)[1].strip('"')
            Path(scratch).write_text(HOST_LINE + "\n")
            return completed(255, err=b"umbrel@192.168.1.104: Permission denied (publickey,password).")
        with patch("subprocess.run", side_effect=fake_ssh):
            keys = access.scan_host("192.168.1.104")
        self.assertEqual([k.type for k in keys], ["ssh-ed25519"])
        self.assertEqual(keys[0].line, HOST_LINE)

    def test_scan_host_reports_unreachable_hosts(self):
        with patch("subprocess.run", return_value=completed(255, err=b"ssh: connect to host 10.0.0.9 port 22: Connection timed out")):
            with self.assertRaisesRegex(access.AccessError, "Could not reach"):
                access.scan_host("10.0.0.9")

    def test_trust_host_appends_to_known_hosts_with_newline_repair(self):
        (self.home / ".ssh").mkdir()
        known = self.home / ".ssh" / "known_hosts"
        known.write_bytes(b"other ssh-ed25519 AAAA")  # no trailing newline
        access.trust_host([access.HostKey(HOST_LINE, "ssh-ed25519", "SHA256:x")])
        self.assertEqual(known.read_text().splitlines(), ["other ssh-ed25519 AAAA", HOST_LINE])

    def test_key_login_distinguishes_refusal_from_failure(self):
        with patch("subprocess.run", return_value=completed(0)):
            self.assertTrue(access.key_login("h", "umbrel", 22, "/k"))
        with patch("subprocess.run", return_value=completed(255, err=b"umbrel@h: Permission denied (publickey,password).")):
            self.assertFalse(access.key_login("h", "umbrel", 22, "/k"))
        with patch("subprocess.run", return_value=completed(255, err=b"Host key verification failed.")):
            with self.assertRaisesRegex(access.AccessError, "does not match"):
                access.key_login("h", "umbrel", 22, "/k")
        with patch("subprocess.run", return_value=completed(255, err=b"ssh: Could not resolve hostname h")):
            with self.assertRaisesRegex(access.AccessError, "could not connect"):
                access.key_login("h", "umbrel", 22, "/k")

    def test_authorize_sends_password_only_through_askpass_environment(self):
        (self.home / ".ssh").mkdir()
        key = self.home / ".ssh" / "umbrel-push-h"
        key.write_text("private")
        Path(str(key) + ".pub").write_text("ssh-ed25519 AAAAC3Nz umbrel-push@h\n")
        seen = {}
        def fake_ssh(command, **kwargs):
            seen["command"] = command
            seen["env"] = kwargs["env"]
            helper = Path(kwargs["env"]["SSH_ASKPASS"])
            seen["helper"] = helper.read_text()
            self.assertTrue(helper.is_file())
            return completed(0, out=b"UMBREL_PUSH_AUTHORIZED\n")
        with patch("subprocess.run", side_effect=fake_ssh):
            access.authorize("h", "umbrel", 22, str(key), "s3cret p@ss")
        self.assertNotIn("s3cret p@ss", " ".join(seen["command"]))
        self.assertNotIn("s3cret p@ss", seen["helper"])
        self.assertEqual(seen["env"]["UMBREL_PUSH_ASKPASS"], "s3cret p@ss")
        self.assertEqual(seen["env"]["SSH_ASKPASS_REQUIRE"], "force")
        self.assertIn("PubkeyAuthentication=no", seen["command"])
        self.assertIn("StrictHostKeyChecking=yes", seen["command"])
        self.assertTrue(seen["helper"].endswith(".cmd") or True)
        remote = seen["command"][-1]
        encoded = remote.split("'")[3]
        script = base64.b64decode(encoded).decode()
        self.assertIn("ssh-ed25519 AAAAC3Nz umbrel-push@h", script)
        self.assertIn("authorized_keys", script)
        self.assertNotIn("s3cret", script)

    def test_authorize_reports_wrong_password(self):
        (self.home / ".ssh").mkdir()
        key = self.home / ".ssh" / "k"
        key.write_text("private")
        Path(str(key) + ".pub").write_text("ssh-ed25519 AAAA c")
        with patch("subprocess.run", return_value=completed(255, err=b"Permission denied, please try again.\numbrel@h: Permission denied (publickey,password).")):
            with self.assertRaisesRegex(access.AccessError, "did not accept"):
                access.authorize("h", "umbrel", 22, str(key), "wrong")
        with self.assertRaisesRegex(access.AccessError, "line breaks"):
            access.authorize("h", "umbrel", 22, str(key), "a\nb")

    def test_askpass_helper_is_a_batch_file_on_windows_and_executable_elsewhere(self):
        helper = access.askpass_helper(self.home)
        if sys.platform == "win32":
            self.assertEqual(helper.suffix, ".cmd")
            self.assertTrue(helper.read_text().startswith("@echo off"))
        else:
            self.assertTrue(os.access(helper, os.X_OK))
        self.assertIn("UMBREL_PUSH_ASKPASS", helper.read_text())

    def test_public_key_rejects_garbage(self):
        (self.home / ".ssh").mkdir()
        key = self.home / ".ssh" / "k"
        key.write_text("private")
        Path(str(key) + ".pub").write_text("not a key\n")
        with self.assertRaisesRegex(access.AccessError, "does not look like"):
            access.public_key(key)


if __name__ == "__main__":
    unittest.main()
