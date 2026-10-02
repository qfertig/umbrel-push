"""Self-contained Linux SSH worker. No third-party Python packages on Umbrel.

The payload is sent on stdin. Package scripts are never sourced by this worker;
only Umbrel's own lifecycle commands execute them.
"""
from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

PREFIX = "UMBREL_PUSH_RESULT="
CORE = ("umbrel-app.yml", "docker-compose.yml")


def run(args, *, env=None, timeout=900, input=None):
    result = subprocess.run(args, input=input, text=True, capture_output=True, env=env, timeout=timeout)
    if result.returncode:
        # Never echo uploaded YAML or export values. Detailed lifecycle logs stay on the server.
        raise RuntimeError(f"{Path(args[0]).name} failed (exit {result.returncode}). "
                           "Check Umbrel's app logs; no package files or credentials were printed.")
    return result.stdout


def client(root, procedure, data=None):
    env = {**os.environ, "UMBREL_DATA_DIR": str(root)}
    command = ["umbreld", "client", procedure]
    if data is not None:
        command.append(json.dumps(data, separators=(",", ":")))
    # umbreld exits immediately after console.log. Large registry responses can
    # be truncated when Node stdout is a pipe; a regular file makes writes synchronous.
    with tempfile.TemporaryFile(mode="w+") as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.PIPE, text=True, env=env, timeout=900)
        if result.returncode:
            raise RuntimeError(f"Umbrel procedure {procedure} failed (exit {result.returncode}).")
        output.seek(0)
        text = output.read()
    try:
        return json.loads(text)
    except ValueError:
        raise RuntimeError("Unexpected umbreld client response. This build needs a compatible adapter.")


def identifier(value):
    if not isinstance(value, str) or len(value) > 80 or not re.fullmatch(r"[a-z0-9]+(?:[-_][a-z0-9]+)*", value):
        raise RuntimeError("Invalid app ID.")
    return value


def allowed(name):
    if not isinstance(name, str) or "\\" in name or ":" in name or any(ord(c) < 32 for c in name):
        return False
    if "/" not in name and (name in CORE or name in ("exports.sh", "torrc") or name.endswith(".template")):
        return name not in (".", "..")
    return bool(re.fullmatch(r"hooks/(pre|post)-(install|start|stop|update|uninstall)", name))


def digest(files):
    canonical = {k: {"content": v["content"], "mode": v.get("mode", 0o644)} for k, v in sorted(files.items())}
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def yaml_read(path):
    return json.loads(run(["yq", "-o=json", ".", str(path)], timeout=20))


def check_files(files):
    if not isinstance(files, dict) or not all(k in files for k in CORE):
        raise RuntimeError("Missing app package files.")
    total = 0
    for name, entry in files.items():
        if not allowed(name) or not isinstance(entry.get("content"), str):
            raise RuntimeError("Invalid package file.")
        size = len(entry["content"].encode())
        total += size
        if size > 2 * 1024 * 1024 or entry.get("mode", 0o644) not in (0o644, 0o755, 0o600, 0o700, 0o640, 0o750):
            raise RuntimeError("Package size or permission mode is unsupported.")
    if total > 8 * 1024 * 1024:
        raise RuntimeError("Package is larger than 8 MiB.")


def confined(base, child):
    path = base / child
    if path.is_symlink() or not path.resolve().is_relative_to(base.resolve()):
        raise RuntimeError("Refusing a symbolic link or path outside the app directory.")
    for parent in path.parents:
        if parent == base:
            break
        if parent.is_symlink():
            raise RuntimeError("Refusing a symbolic link in the package path.")
    return path


def read_files(directory):
    files = {}
    candidates = list(directory.iterdir())
    hooks = directory / "hooks"
    if hooks.is_symlink():
        raise RuntimeError("Hooks directory is a symbolic link; manual review required.")
    if hooks.is_dir():
        candidates += list(hooks.iterdir())
    for path in candidates:
        name = path.relative_to(directory).as_posix()
        if not allowed(name):
            continue
        path = confined(directory, name)
        if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
            raise RuntimeError(f"Unsupported package file: {name}")
        files[name] = {"content": path.read_text(), "mode": path.stat().st_mode & 0o777}
    check_files(files)
    return files


def atomic_write(path, text, mode=0o644, uid=1000, gid=1000):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".umbrel-push-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.chown(temporary, uid, gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_files(directory, files):
    check_files(files)
    for name, entry in files.items():
        target = confined(directory, name)
        stat = target.stat() if target.exists() else None
        atomic_write(target, entry["content"], entry.get("mode", 0o644),
                     stat.st_uid if stat else 1000, stat.st_gid if stat else 1000)


def origin(root, app, registry=None):
    marker = root / ".umbrel-push" / "apps" / f"{app}.json"
    if marker.exists():
        return json.loads(marker.read_text())
    if registry is None:
        try:
            registry = client(root, "appStore.registry.query")
        except Exception:
            registry = []
    for repo in registry:
        if any(a.get("id") == app for a in repo.get("apps", [])):
            meta = repo.get("meta", {})
            kind = "official" if meta.get("id") == "umbrel-app-store" else "community"
            return {"kind": kind, "store": meta.get("name"),
                    "notice": "Store-managed app: store/OS updates may overwrite local edits."}
    return {"kind": "existing", "notice": "Origin unknown: updates may overwrite local edits."}


def images(app):
    ids = run(["docker", "ps", "-aq", "--filter", f"label=com.docker.compose.project={app}"], timeout=30).split()
    if not ids:
        return []
    details = json.loads(run(["docker", "inspect", *ids], timeout=30))
    return [{"container": c["Name"].lstrip("/"), "configuredImage": c["Config"]["Image"],
             "runningImageId": c["Image"], "state": c["State"]["Status"]} for c in details]


def retrieve(root, app):
    directory = confined(root / "app-data", identifier(app))
    if not directory.is_dir():
        raise RuntimeError("App package does not exist on this Umbrel.")
    files = read_files(directory)
    return {"appId": app, "files": files, "baseline": digest(files), "origin": origin(root, app),
            "manifest": yaml_read(directory / CORE[0]), "images": images(app)}


def official_cache(root):
    matches = []
    for path in (root / "app-stores").iterdir():
        config = path / ".git" / "config"
        if path.is_symlink() or not config.is_file():
            continue
        try:
            url = run(["git", "config", "--file", str(config), "--get", "remote.origin.url"], timeout=20).strip()
        except RuntimeError:
            continue
        if url.rstrip("/").removesuffix(".git") == "https://github.com/getumbrel/umbrel-apps":
            matches.append(path)
    if len(matches) != 1:
        raise RuntimeError("Could not identify exactly one official package cache. No changes made.")
    return matches[0]


PORT_SHORT = re.compile(r"^(?:[\w.\[\]:]+?:)?(\d+):\d+(?:/(?:tcp|udp))?$")


def published_ports(compose):
    """Host ports a Compose file publishes directly (besides the app_proxy dashboard port)."""
    ports = []
    for name, service in (compose.get("services") or {}).items():
        if name == "app_proxy" or not isinstance(service, dict):
            continue
        for entry in service.get("ports") or []:
            if isinstance(entry, dict) and str(entry.get("published", "")).isdigit():
                ports.append(int(entry["published"]))
            elif isinstance(entry, (str, int)):
                match = PORT_SHORT.match(str(entry))
                if match:
                    ports.append(int(match.group(1)))
    return ports


def listening_ports():
    try:
        output = run(["ss", "-ltnH"], timeout=20)
    except (RuntimeError, FileNotFoundError):
        return set()
    ports = set()
    for line in output.splitlines():
        columns = line.split()
        if len(columns) >= 4 and ":" in columns[3]:
            port = columns[3].rsplit(":", 1)[-1]
            if port.isdigit():
                ports.add(int(port))
    return ports


def used_ports(root, exclude=None, apps=None):
    """Host ports in use: every app's dashboard and published ports, then anything else listening.

    Returns ({port: owner}, own) where own are the ports belonging to the excluded app.
    """
    apps = apps if apps is not None else client(root, "apps.list.query")
    used, own = {}, set()
    for app in apps:
        label_text = app.get("name") or app["id"]
        ports = {}
        if type(app.get("port")) is int:
            ports[app["port"]] = f"{label_text} (dashboard)"
        compose_path = root / "app-data" / app["id"] / CORE[1]
        if compose_path.is_file():
            try:
                for port in published_ports(yaml_read(compose_path)):
                    ports.setdefault(port, label_text)
            except Exception:
                pass
        if app["id"] == exclude:
            own.update(ports)
        else:
            used.update(ports)
    for port in listening_ports():
        if port not in used and port not in own:
            used[port] = "a service on the Umbrel"
    return used, own


def validate_remote(root, app, files, pull=False):
    check_files(files)
    with tempfile.TemporaryDirectory(prefix="umbrel-push-check-") as temp:
        directory = Path(temp)
        write_files(directory, files)
        manifest = yaml_read(directory / CORE[0])
        if manifest.get("id") != app:
            raise RuntimeError("Manifest ID does not match the requested app.")
        port = manifest.get("port")
        if type(port) is not int or not 1 <= port <= 65535:
            raise RuntimeError("Manifest port must be between 1 and 65535.")
        existing_manifest = root / "app-data" / app / CORE[0]
        previous_port = yaml_read(existing_manifest).get("port") if existing_manifest.is_file() else None
        if port != previous_port:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                try:
                    probe.bind(("0.0.0.0", port))
                except OSError:
                    raise RuntimeError(f"Dashboard port {port} is already in use; choose a different port.")
        compose = yaml_read(directory / CORE[1])
        used, own = used_ports(root, exclude=app)
        for wanted in [port] + published_ports(compose):
            if wanted in used and wanted not in own:
                raise RuntimeError(f"Port {wanted} is already used by {used[wanted]}; choose a different port.")
        services = compose.get("services", {})
        if not services or not isinstance(services, dict):
            raise RuntimeError("Missing Compose services.")
        references = []
        for name, service in services.items():
            if name == "app_proxy":
                continue
            if service.get("build") or not service.get("image"):
                raise RuntimeError("This adapter requires prebuilt images.")
            reference = service["image"]
            if pull and (not isinstance(reference, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/:@-]*", reference)):
                raise RuntimeError("Pull requires literal image references in this version; export-derived images are unsupported.")
            references.append(reference)
        # Parse and check Compose structure without evaluating exports or interpolating secrets.
        proxy = directory / "proxy.yml"
        proxy.write_text("services:\n  app_proxy:\n    image: app-proxy-config-only\n" if "app_proxy" in services else "services: {}\n")
        run(["docker", "compose", "--project-name", app, "-f", str(proxy), "-f", str(directory / CORE[1]),
             "config", "--no-interpolate", "--quiet"], timeout=60)
        if pull:
            for reference in dict.fromkeys(references):
                run(["docker", "pull", reference])
        return manifest


def snapshot(root, app, files, auto_start):
    token = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + uuid.uuid4().hex[:8]
    target = root / ".umbrel-push" / "backups" / app / f"{token}.json"
    atomic_write(target, json.dumps({"files": files, "autoStart": auto_start}), 0o600, 0, 0)
    return token


def remember(root, app, kind, files, backup=None):
    marker = root / ".umbrel-push" / "apps" / f"{app}.json"
    value = {"kind": kind, "modified": True, "lastApplied": digest(files), "backup": backup,
             "notice": "Custom app; use Umbrel Push for package updates." if kind == "custom" else
             "Locally modified: future store/OS updates can overwrite these changes."}
    atomic_write(marker, json.dumps(value), 0o600, 0, 0)


def install(root, app, files):
    # Umbrel has no folder-install API. This adapter exposes a NEW unique package
    # briefly in its existing local discovery cache and invokes the normal installer.
    # No repository is created, published, registered, or modified upstream.
    cache = official_cache(root)
    registry = client(root, "appStore.registry.query")
    if any(a.get("id") == app for repo in registry for a in repo.get("apps", [])):
        raise RuntimeError("App ID already belongs to a store; choose a unique custom ID.")
    target = confined(cache, app)
    installed = confined(root / "app-data", app)
    if target.exists() or installed.exists():
        raise RuntimeError("App folder already exists. Retrieve it or choose a different ID.")
    token = uuid.uuid4().hex
    staging = Path(tempfile.mkdtemp(prefix=".umbrel-push-stage-", dir=cache))
    published = False
    try:
        write_files(staging, files)
        (staging / ".umbrel-push-stage-owner").write_text(token)
        os.chmod(staging, 0o755)
        os.chown(staging, 1000, 1000)
        staging.rename(target)
        published = True
        client(root, "apps.install.mutate", {"appId": app})
        result = retrieve(root, app)
        if result["manifest"].get("id") != app:
            raise RuntimeError("Installed identity did not match. Inspect the server before retrying.")
        remember(root, app, "custom", result["files"])
        result["origin"] = origin(root, app)
        return result
    finally:
        cleanup = target if published else staging
        marker = cleanup / ".umbrel-push-stage-owner"
        # A cache refresh can replace the entire directory; only remove OUR folder.
        if cleanup.parent == cache and not cleanup.is_symlink() and marker.is_file() and marker.read_text() == token:
            shutil.rmtree(cleanup)


def apply(root, app, files, baseline, installed_apps):
    current = retrieve(root, app)
    if not baseline or current["baseline"] != baseline:
        raise RuntimeError("Installed files changed since retrieval. Retrieve again and merge your changes.")
    if set(current["files"]) - set(files):
        raise RuntimeError("Deleting package files is not supported yet; no changes applied.")
    info = next(a for a in installed_apps if a["id"] == app)
    if info.get("state") not in ("ready", "running", "stopped"):
        raise RuntimeError("App must be running or stopped, with no installation/update in progress.")
    was_running = info.get("state") in ("ready", "running")
    auto_start = info.get("autoStart", True)
    if was_running and auto_start is False:
        raise RuntimeError("Running app has auto-start disabled. This lifecycle combination needs a newer adapter.")
    backup = snapshot(root, app, current["files"], auto_start)
    directory = root / "app-data" / app
    writing = False
    try:
        if was_running:
            client(root, "apps.stop.mutate", {"appId": app})
        # Hooks can edit package files on stop. Do not silently overwrite their changes.
        if digest(read_files(directory)) != current["baseline"]:
            raise RuntimeError("Package changed during stop hooks. Snapshot saved; retrieve again.")
        writing = True
        write_files(directory, files)
        if was_running:
            client(root, "apps.start.mutate", {"appId": app})
    except Exception as exc:
        # Restore package configuration, never remove volumes or app data.
        try:
            if writing:
                write_files(directory, current["files"])
                for name in set(files) - set(current["files"]):
                    confined(directory, name).unlink(missing_ok=True)
            if was_running:
                client(root, "apps.start.mutate", {"appId": app})
        except Exception:
            raise RuntimeError(f"Apply and configuration recovery failed. Backup {backup}; inspect the app before retrying.") from exc
        raise RuntimeError(f"Apply failed; previous configuration restored. Backup {backup}.") from exc
    result = retrieve(root, app)
    remember(root, app, current["origin"]["kind"], result["files"], backup)
    result.update(backup=backup, origin=origin(root, app))
    return result


def memory_usage(root):
    """Per-app and total memory as Umbrel's own Settings card reports it (container cgroup memory, in bytes).

    Cheap enough to poll every few seconds.
    """
    data = client(root, "system.memoryUsage.query")
    try:
        return {"size": int(data["size"]), "used": int(data["totalUsed"]), "apps": {a["id"]: int(a["used"]) for a in data["apps"]}}
    except (KeyError, TypeError, ValueError):
        raise RuntimeError("Unexpected memory usage response. This build needs a compatible adapter.")


def disk_usage(root):
    """Per-app and total storage as Umbrel reports it (the size of each app's data folder, in bytes).

    Umbrel walks every app's data directory to measure this, so it can take a long time on a large library. Ask rarely.
    """
    data = client(root, "system.diskUsage.query")
    try:
        return {"size": int(data["size"]), "used": int(data["totalUsed"]), "available": int(data["available"]),
                "apps": {a["id"]: int(a["used"]) for a in data["apps"]}}
    except (KeyError, TypeError, ValueError):
        raise RuntimeError("Unexpected storage usage response. This build needs a compatible adapter.")


LIFECYCLE = {"start": ("stopped",), "stop": ("ready", "running"), "restart": ("ready", "running")}


@contextlib.contextmanager
def operation_lock(root):
    """The lock a push takes, so our own writes and lifecycle changes never interleave."""
    import fcntl
    lock_dir = root / ".umbrel-push"
    lock_dir.mkdir(mode=0o700, exist_ok=True)
    with (lock_dir / "operation.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another Umbrel Push operation is in progress.")
        yield


def lifecycle(root, app, action, version):
    """Start, stop or restart one installed app through umbreld, only from a state where that makes sense."""
    if action not in LIFECYCLE:
        raise RuntimeError("Unknown operation.")
    if version.get("version") != "2.0.0":
        raise RuntimeError("Starting and stopping apps requires a verified Umbrel 2.0.0 adapter. This server is read-only for now.")
    with operation_lock(root):
        info = next((a for a in client(root, "apps.list.query") if a["id"] == app), None)
        if info is None:
            raise RuntimeError(f"{app} is not installed.")
        if info.get("state") not in LIFECYCLE[action]:
            raise RuntimeError(f"Cannot {action} {app} while it is {info.get('state')}.")
        client(root, f"apps.{action}.mutate", {"appId": app})
        after = next((a for a in client(root, "apps.list.query") if a["id"] == app), {})
        return {"appId": app, "action": action, "state": after.get("state")}


def dispatch(request):
    if os.geteuid() != 0:
        raise RuntimeError("The worker needs sudo on Umbrel to access app packages and umbreld.")
    root = Path(request.get("root", "/home/umbrel/umbrel"))
    if not root.is_absolute() or not (root / "umbrel.yaml").is_file():
        raise RuntimeError("Umbrel data directory not found. Set --data-dir to its actual absolute path.")
    operation = request["operation"]
    version = client(root, "system.version.query")
    if operation == "doctor":
        return {"version": version, "dataDirectory": str(root), "python": sys.version.split()[0],
                "commands": {name: bool(shutil.which(name)) for name in ("umbreld", "docker", "yq", "git")},
                "adapter": "2.0.0" if version.get("version") == "2.0.0" else "read-only; version not verified"}
    if operation == "list":
        try:
            registry = client(root, "appStore.registry.query")
        except Exception:
            registry = []
        result = []
        for a in client(root, "apps.list.query"):
            entry = {k: a.get(k) for k in ("id", "name", "version", "state", "port", "path", "autoStart")}
            icon = a.get("icon")
            if not isinstance(icon, str) or not icon:
                manifest_path = root / "app-data" / a["id"] / CORE[0]
                try:
                    icon = yaml_read(manifest_path).get("icon") if manifest_path.is_file() else None
                except Exception:
                    icon = None
            # Embedded icons travel inline but a 1 MiB upload per app would make the list slow.
            if isinstance(icon, str) and icon.startswith("data:") and len(icon) > 300_000:
                icon = None
            entry["icon"] = icon if isinstance(icon, str) else None
            entry["origin"] = origin(root, a["id"], registry)
            result.append(entry)
        return result
    if operation == "usage":
        return memory_usage(root)
    if operation == "storage":
        return disk_usage(root)
    app = identifier(request["appId"])
    if operation == "retrieve":
        return retrieve(root, app)
    if operation == "ports":
        used, own = used_ports(root, exclude=app)
        return {"used": {str(k): v for k, v in used.items()}, "own": sorted(own)}
    if operation == "logs":
        return client(root, "apps.logs.query", {"appId": app, "maxOutputBytes": 20000})
    if operation in LIFECYCLE:
        return lifecycle(root, app, operation, version)
    if operation != "push":
        raise RuntimeError("Unknown operation.")
    if version.get("version") != "2.0.0":
        raise RuntimeError("Writes require a verified Umbrel 2.0.0 adapter. This server is read-only for now.")
    files = request["files"]
    # Serialize our own writes. Umbrel's dashboard remains independently operable.
    import fcntl
    lock_dir = root / ".umbrel-push"
    lock_dir.mkdir(mode=0o700, exist_ok=True)
    with (lock_dir / "operation.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another Umbrel Push operation is in progress.")
        installed_apps = client(root, "apps.list.query")
        if any(a["id"] == app for a in installed_apps):
            if not request.get("baseline") or retrieve(root, app)["baseline"] != request["baseline"]:
                raise RuntimeError("Installed files changed since retrieval. Retrieve again and merge your changes.")
            validate_remote(root, app, files, pull=request.get("pull", False))
            return apply(root, app, files, request.get("baseline"), installed_apps)
        if request.get("baseline"):
            raise RuntimeError("Previously retrieved app is no longer installed. Refusing to recreate it silently.")
        validate_remote(root, app, files, pull=request.get("pull", False))
        return install(root, app, files)


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(12 * 1024 * 1024 + 1)
        if len(raw) > 12 * 1024 * 1024:
            raise RuntimeError("Request is too large.")
        result = {"ok": True, "result": dispatch(json.loads(raw))}
    except Exception as error:
        result = {"ok": False, "error": str(error)}
    print(PREFIX + base64.b64encode(json.dumps(result).encode()).decode())
