import base64
import json
import subprocess
import unittest
from unittest.mock import patch

from umbrel_push.transport import ConnectionError, SSHConnection


class TransportTests(unittest.TestCase):
    def test_rejects_ssh_option_injection(self):
        for host in ("-oProxyCommand=bad", "http://192.168.1.104", "host;id", "host/path"):
            with self.assertRaises(ValueError):
                SSHConnection(host)

    def test_payload_uses_stdin_and_host_checks_stay_enabled(self):
        encoded = base64.b64encode(json.dumps({"ok": True, "result": {"version": "2.0.0"}}).encode())
        result = subprocess.CompletedProcess([], 0, b"UMBREL_PUSH_RESULT=" + encoded + b"\n", b"")
        with patch("shutil.which", return_value="ssh"), patch("subprocess.run", return_value=result) as run:
            response = SSHConnection("192.168.1.104").request("push", private_value="sensitive-test-value")
            self.assertEqual(response["version"], "2.0.0")
            self.assertNotIn("sensitive-test-value", " ".join(run.call_args.args[0]))
            self.assertIn("StrictHostKeyChecking=yes", run.call_args.args[0])
            self.assertIn(b"sensitive-test-value", run.call_args.kwargs["input"])

    def test_failure_does_not_masquerade_as_success(self):
        result = subprocess.CompletedProcess([], 255, b"", b"Permission denied")
        with patch("shutil.which", return_value="ssh"), patch("subprocess.run", return_value=result):
            with self.assertRaisesRegex(ConnectionError, "Permission denied"):
                SSHConnection("192.168.1.104").request("doctor")

    def test_sudo_password_is_only_sent_on_stdin_and_not_represented(self):
        encoded = base64.b64encode(json.dumps({"ok": True, "result": True}).encode())
        result = subprocess.CompletedProcess([], 0, b"UMBREL_PUSH_RESULT=" + encoded, b"")
        connection = SSHConnection("192.168.1.104", sudo_password="test-secret")
        self.assertNotIn("test-secret", repr(connection))
        with patch("shutil.which", return_value="ssh"), patch("subprocess.run", return_value=result) as run:
            connection.request("doctor")
            self.assertNotIn("test-secret", " ".join(run.call_args.args[0]))
            self.assertTrue(run.call_args.kwargs["input"].startswith(b"test-secret\n{"))
            self.assertIn("sudo -k -S", run.call_args.args[0][-1])
