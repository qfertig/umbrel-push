"""OpenSSH transport shared by CLI and future desktop UI."""
from __future__ import annotations

import base64
import json
import re
import shlex
import shutil
import subprocess
import sys
import zlib
from dataclasses import dataclass, field
from pathlib import Path


class ConnectionError(RuntimeError):
    pass


@dataclass
class SSHConnection:
    host: str
    user: str = "umbrel"
    port: int = 22
    identity: str | None = None
    root: str = "/home/umbrel/umbrel"
    sudo_password: str | None = field(default=None, repr=False)

    def __post_init__(self):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.:-]*", self.host):
            raise ValueError("Use a hostname or IP address, without http://, a path, or SSH options.")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", self.user):
            raise ValueError("Invalid SSH username.")
        if not 1 <= self.port <= 65535:
            raise ValueError("Invalid SSH port.")

    @property
    def fingerprint(self):
        return f"{self.user}@{self.host}:{self.port}:{self.root}"

    def request(self, operation: str, **payload):
        ssh = shutil.which("ssh")
        if not ssh:
            raise ConnectionError("OpenSSH is required. Install the OpenSSH client for Windows or Linux.")
        worker = Path(__file__).with_name("remote.py").read_bytes()
        encoded = base64.b64encode(zlib.compress(worker)).decode()
        code = f"import base64,zlib;exec(compile(zlib.decompress(base64.b64decode('{encoded}')),'umbrel-push-worker','exec'))"
        sudo = "sudo -n" if self.sudo_password is None else "sudo -k -S -p ''"
        remote_command = sudo + " python3 -c " + shlex.quote(code)
        command = [ssh, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                   "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4",
                   "-p", str(self.port)]
        if self.identity:
            command += ["-i", self.identity, "-o", "IdentitiesOnly=yes"]
        command += [f"{self.user}@{self.host}", remote_command]
        body = json.dumps({"operation": operation, "root": self.root, **payload}).encode()
        if self.sudo_password is not None:
            if "\n" in self.sudo_password or "\r" in self.sudo_password:
                raise ConnectionError("Sudo passwords containing line breaks are unsupported.")
            body = self.sudo_password.encode() + b"\n" + body
        options = {}
        if sys.platform == "win32":
            options["creationflags"] = subprocess.CREATE_NO_WINDOW  # no console flashes under pythonw
        try:
            result = subprocess.run(command, input=body, capture_output=True, timeout=1800, **options)
        except subprocess.TimeoutExpired as exc:
            raise ConnectionError("SSH operation timed out. Check the installed app before retrying; the server may have continued.") from exc
        output = result.stdout.decode("utf-8", errors="replace")
        prefix = "UMBREL_PUSH_RESULT="
        envelopes = [line[len(prefix):] for line in output.splitlines() if line.startswith(prefix)]
        if not envelopes:
            error = result.stderr.decode("utf-8", errors="replace").strip()
            if "sudo: a password is required" in error:
                raise ConnectionError("Umbrel needs a sudo password: pass --ask-sudo-password before the command, or enter it in the desktop's Connect dialog.")
            if "Sorry, try again" in error or "incorrect password" in error.lower():
                raise ConnectionError("Umbrel did not accept that sudo password.")
            hint = ("Check the host key with ssh or the desktop's Connect dialog, and make sure this computer's key is authorized."
                    if "Permission denied" in error or "Host key verification failed" in error else "")
            raise ConnectionError(f"SSH worker could not run: {error[-1000:] or 'no response'}. {hint}".strip())
        response = json.loads(base64.b64decode(envelopes[-1]))
        if not response["ok"]:
            raise ConnectionError(response["error"])
        return response["result"]
