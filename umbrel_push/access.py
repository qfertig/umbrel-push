"""SSH access setup shared by the desktop and CLI: dedicated key, host trust, one-time authorization.

Everything here calls OpenSSH's own tools; no SSH library is bundled. Passwords are never written
to disk. During the one-time authorization the password reaches ssh only through an askpass helper
that reads it from its own environment, the same approach sshpass -e uses.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

PUBLIC_KEY = re.compile(r"(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+|sk-[\w.@-]+) [A-Za-z0-9+/=]+(?: [^'\x00-\x1f]*)?")
AUTHORIZED = "UMBREL_PUSH_AUTHORIZED"
SETUP_SCRIPT = """set -eu
umask 077
mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 700 "$HOME/.ssh"
chmod 600 "$HOME/.ssh/authorized_keys"
grep -qxF '__KEY__' "$HOME/.ssh/authorized_keys" || printf '%s\\n' '__KEY__' >> "$HOME/.ssh/authorized_keys"
echo __MARKER__
"""


class AccessError(RuntimeError):
    pass


@dataclass
class HostKey:
    line: str
    type: str
    fingerprint: str


def ssh_directory() -> Path:
    return Path.home() / ".ssh"


def key_path(host: str) -> Path:
    return ssh_directory() / f"umbrel-push-{host}"


def public_key_path(private: str | os.PathLike) -> Path:
    # Path.with_suffix would clobber the last octet of "umbrel-push-192.168.1.104".
    return Path(str(private) + ".pub")


def default_identity(host: str) -> str | None:
    """The dedicated key for this host, if it exists. None lets OpenSSH use its agent and default keys."""
    path = key_path(host)
    return str(path) if path.is_file() else None


def describe_identity(host: str, chosen: str | None) -> str:
    if chosen:
        return chosen
    path = key_path(host)
    return f"{path}" + ("" if path.is_file() else "  (created on first connection)")


def tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise AccessError(f"{name} was not found. Install the OpenSSH client; it ships with Windows 10+ and most Linux distributions.")
    return path


def run(command, **kwargs):
    kwargs.setdefault("capture_output", True)
    kwargs.setdefault("timeout", 60)
    if sys.platform == "win32":
        kwargs.setdefault("creationflags", subprocess.CREATE_NO_WINDOW)
    try:
        return subprocess.run(command, **kwargs)
    except subprocess.TimeoutExpired as exc:
        raise AccessError("SSH did not respond in time. Check that the host is reachable.") from exc


def tail(data: bytes, limit: int = 400) -> str:
    lines = [line for line in data.decode("utf-8", errors="replace").splitlines()
             if line.strip() and not line.startswith("Warning: Permanently added")]
    return "\n".join(lines)[-limit:].strip()


def host_entry(host: str, port: int) -> str:
    return host if port == 22 else f"[{host}]:{port}"


def ensure_key(host: str) -> Path:
    """Create the dedicated ed25519 key for this host when it does not exist yet."""
    path = key_path(host)
    if path.is_file() and public_key_path(path).is_file():
        return path
    if path.exists() or public_key_path(path).exists():
        raise AccessError(f"{path} is incomplete. Remove it and its .pub file, or choose another key.")
    ssh_directory().mkdir(mode=0o700, exist_ok=True)
    result = run([tool("ssh-keygen"), "-q", "-t", "ed25519", "-N", "", "-C", f"umbrel-push@{host}", "-f", str(path)])
    if result.returncode != 0:
        raise AccessError("Could not create the SSH key: " + (tail(result.stderr) or "ssh-keygen failed"))
    return path


def public_key(identity: str | os.PathLike) -> str:
    path = public_key_path(identity)
    if not path.is_file():
        raise AccessError(f"No public key next to {identity}. Run ssh-keygen -y to recreate the .pub file, or choose another key.")
    text = path.read_text(encoding="utf-8").strip()
    if not PUBLIC_KEY.fullmatch(text):
        raise AccessError(f"{path} does not look like an OpenSSH public key.")
    return text


def known_host(host: str, port: int = 22) -> bool:
    result = run([tool("ssh-keygen"), "-F", host_entry(host, port)])
    return result.returncode == 0 and bool(result.stdout.strip())


def fingerprint(line: str) -> str:
    blob = base64.b64decode(line.split()[2])
    return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


def scan_host(host: str, user: str = "umbrel", port: int = 22) -> list[HostKey]:
    """Fetch the server's host keys through ssh and a throwaway known_hosts file.

    Windows' ssh-keyscan cannot negotiate with current OpenSSH servers, so ssh itself is used with
    every authentication method disabled. Nothing is trusted until trust_host() is called.
    An empty list means the host is already trusted by a system-wide known_hosts file.
    """
    with tempfile.TemporaryDirectory(prefix="umbrel-push-") as temp:
        scratch = Path(temp) / "known_hosts"
        scratch.write_text("")
        result = run([tool("ssh"), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
                      "-o", f'UserKnownHostsFile="{scratch}"', "-o", "ConnectTimeout=10",
                      "-o", "PubkeyAuthentication=no", "-o", "PasswordAuthentication=no",
                      "-o", "KbdInteractiveAuthentication=no", "-p", str(port), f"{user}@{host}", "exit"])
        lines = [line for line in scratch.read_text().splitlines() if line.strip() and not line.startswith("#")]
    error = tail(result.stderr)
    if not lines:
        if "Permission denied" in error:
            return []
        raise AccessError(f"Could not reach {host_entry(host, port)}: {error or 'no response'}")
    return [HostKey(line, line.split()[1], fingerprint(line)) for line in lines]


def trust_host(keys: list[HostKey]) -> None:
    directory = ssh_directory()
    directory.mkdir(mode=0o700, exist_ok=True)
    path = directory / "known_hosts"
    existing = path.read_bytes() if path.is_file() else b""
    with path.open("ab") as stream:
        if existing and not existing.endswith(b"\n"):
            stream.write(b"\n")
        for key in keys:
            stream.write(key.line.strip().encode() + b"\n")
    if os.name != "nt":
        os.chmod(path, 0o600)


def key_login(host: str, user: str, port: int, identity: str | None) -> bool:
    """True when key authentication works, False when the server refuses the key, raise otherwise."""
    command = [tool("ssh"), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", "-p", str(port)]
    if identity:
        command += ["-i", identity, "-o", "IdentitiesOnly=yes"]
    result = run(command + [f"{user}@{host}", "exit"])
    if result.returncode == 0:
        return True
    error = tail(result.stderr)
    if "Permission denied" in error:
        return False
    if "Host key verification failed" in error or "REMOTE HOST IDENTIFICATION HAS CHANGED" in error:
        raise AccessError(f"The host key of {host} does not match ~/.ssh/known_hosts. "
                          "If the server was reinstalled, remove its old entry with ssh-keygen -R.")
    raise AccessError(f"SSH could not connect: {error or 'no response'}")


def askpass_helper(directory: Path) -> Path:
    """A helper ssh runs to obtain the password; it only echoes its own environment variable."""
    python = Path(sys.executable)
    if python.name.lower() == "pythonw.exe" and python.with_name("python.exe").is_file():
        python = python.with_name("python.exe")
    code = "import os,sys;sys.stdout.write(os.environ['UMBREL_PUSH_ASKPASS'])"
    if sys.platform == "win32":
        helper = directory / "askpass.cmd"
        helper.write_text(f'@echo off\r\n"{python}" -c "{code}"\r\n', encoding="ascii")
    else:
        helper = directory / "askpass.sh"
        helper.write_text(f'#!/bin/sh\nexec "{python}" -c "{code}"\n', encoding="ascii")
        helper.chmod(0o700)
    return helper


def authorize(host: str, user: str, port: int, identity: str, password: str) -> None:
    """Add the identity's public key to the account's authorized_keys using the account password once."""
    if "\n" in password or "\r" in password:
        raise AccessError("Passwords containing line breaks are unsupported.")
    key = public_key(identity)
    script = SETUP_SCRIPT.replace("__KEY__", key).replace("__MARKER__", AUTHORIZED)
    encoded = base64.b64encode(script.encode()).decode()
    with tempfile.TemporaryDirectory(prefix="umbrel-push-") as temp:
        helper = askpass_helper(Path(temp))
        env = {**os.environ, "SSH_ASKPASS": str(helper), "SSH_ASKPASS_REQUIRE": "force", "UMBREL_PUSH_ASKPASS": password}
        env.setdefault("DISPLAY", ":0")  # OpenSSH before 8.4 only consults askpass when DISPLAY is set
        result = run([tool("ssh"), "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
                      "-o", "PubkeyAuthentication=no", "-o", "NumberOfPasswordPrompts=1",
                      "-o", "PreferredAuthentications=password,keyboard-interactive", "-p", str(port),
                      f"{user}@{host}", f"printf '%s' '{encoded}' | base64 -d | sh"],
                     env=env, stdin=subprocess.DEVNULL, timeout=90)
    if AUTHORIZED.encode() in result.stdout:
        return
    error = tail(result.stderr)
    if "Permission denied" in error:
        raise AccessError("Umbrel did not accept that password.")
    raise AccessError("Could not authorize this computer: " + (error or "no response from the server"))
