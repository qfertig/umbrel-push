"""The operations the web UI needs, with no HTTP in them so they can be tested directly."""
from __future__ import annotations

import copy
import json
import random
import threading
import time
from datetime import datetime

from . import core, editor
from .errors import ApiError  # noqa: F401  (re-exported for callers and tests)

access, package, transport = core.load()

DEMO_APPS = [
    {"id": "dockge", "name": "Dockge", "version": "1.5.0-2", "state": "ready", "port": 5001,
     "origin": {"kind": "official", "notice": "Official app; store updates replace local edits."}},
    {"id": "immich", "name": "Immich", "version": "v2.4.1", "state": "ready", "port": 2283,
     "origin": {"kind": "official", "notice": "Official app; store updates replace local edits."}},
    {"id": "scrutiny", "name": "Scrutiny", "version": "master-omnibus", "state": "ready", "port": 8080,
     "origin": {"kind": "community", "modified": True, "notice": "Community app with local edits."}},
    {"id": "push-smoke", "name": "Umbrel Push Test", "version": "1.0.2", "state": "ready", "port": 18991,
     "origin": {"kind": "custom", "notice": "Custom app; use Umbrel Push for package updates."}},
    {"id": "paperless", "name": "Paperless-ngx", "version": "2.14.7", "state": "stopped", "port": 8000,
     "origin": {"kind": "official", "notice": "Official app; store updates replace local edits."}},
    {"id": "community-gladys", "name": "Gladys Assistant", "version": "4.48.0", "state": "ready", "port": 9212,
     "origin": {"kind": "community", "store": "Community store", "notice": "Store-managed app: store/OS updates may overwrite local edits."}},
]

DEMO_IMAGES = {
    "dockge": "louislam/dockge:1", "immich": "ghcr.io/immich-app/immich-server:v2.4.1", "scrutiny": "ghcr.io/analogj/scrutiny:master-omnibus",
    "push-smoke": "nginx:1.27", "paperless": "ghcr.io/paperless-ngx/paperless-ngx:2.14.7", "community-gladys": "gladysassistant/gladys:v4.48.0",
}
DEMO_TAGS = {
    "gladysassistant/gladys": ["v4.55.0", "v4.54.1", "v4.53.0", "v4.52.0", "v4.50.0", "v4.48.0", "v4.47.2", "latest"],
    "library/nginx": ["1.29", "1.28", "1.27", "stable", "latest"],
}
DEMO_SEARCH = [
    {"name": "gladysassistant/gladys", "official": False, "description": "Gladys Assistant, a privacy-first home assistant"},
    {"name": "nginx", "official": True, "description": "Official build of Nginx."},
]

# Which states each action may start from; the Umbrel-side worker enforces the same table.
LIFECYCLE = {"start": ("stopped",), "stop": ("ready", "running"), "restart": ("ready", "running")}

# Memory is read from the kernel's container counters and is cheap, so it is refreshed often. Storage is measured by
# walking each app's data folder, which can take a long time on a big library, so it is kept for minutes.
MEMORY_TTL = 5.0
STORAGE_TTL = 300.0

GIB = 1024**3
DEMO_RAM_SIZE = 16 * GIB
DEMO_DISK_SIZE = 1_800_000_000_000
DEMO_MEMORY = {"dockge": 90e6, "immich": 2.1 * GIB, "scrutiny": 160e6, "push-smoke": 12e6, "paperless": 780e6, "community-gladys": 300e6}
DEMO_DISK = {"dockge": 0.2e9, "immich": 412e9, "scrutiny": 1.4e9, "push-smoke": 0.05e9, "paperless": 6.5e9, "community-gladys": 5e3}

DEMO_LOGS = (
    "umbreld: app {id}: lifecycle start requested\n"
    "umbreld: app {id}: compose project ready\n"
    "{id}_server_1  | listening on port {port}\n"
)


def clock() -> str:
    return datetime.now().strftime("%H:%M:%S")


class Service:
    """One browser session talking to one Umbrel. The sudo password lives here, in memory, until disconnect."""

    def __init__(self, demo: bool = False):
        self.demo = demo
        self.lock = threading.Lock()
        self.connection = None
        self.doctor = None
        self.refreshed_at = None
        self.pending_keys = {}
        self.demo_apps = [copy.deepcopy(app) for app in DEMO_APPS]
        self.demo_packages = {}
        self.cache = {}
        if demo:
            self.connection = transport.SSHConnection("192.168.1.104", "umbrel")
            self.doctor = {"version": {"version": "2.0.0"}}

    # -- state
    def state(self) -> dict:
        connection = self.connection
        version = ((self.doctor or {}).get("version") or {}).get("version") if isinstance(self.doctor, dict) else None
        return {
            "connected": connection is not None,
            "demo": self.demo,
            "host": connection.host if connection else None,
            "user": connection.user if connection else None,
            "port": connection.port if connection else None,
            "version": version,
            "refreshedAt": self.refreshed_at,
        }

    # -- connection
    def connect(self, host: str, user: str = "umbrel", port: int = 22, password: str = "", trust: bool = False) -> dict:
        if self.demo:
            return {"status": "connected", **self.state()}
        try:
            candidate = transport.SSHConnection(host.strip(), (user or "umbrel").strip(), int(port or 22),
                                                sudo_password=password or None)
        except (ValueError, TypeError) as exc:
            raise ApiError(400, str(exc), "invalid") from exc
        try:
            unseen = self.verify_host_key(candidate, trust)
            if unseen:
                return {"status": "trust", "host": candidate.host,
                        "keys": [{"type": key.type, "fingerprint": key.fingerprint} for key in unseen]}
            identity = str(access.ensure_key(candidate.host))
            if not access.key_login(candidate.host, candidate.user, candidate.port, identity):
                if not password:
                    raise ApiError(401, "This computer isn't authorized on the Umbrel yet. Enter the Umbrel password once so its key can be added.",
                                   "password_required")
                access.authorize(candidate.host, candidate.user, candidate.port, identity, password)
                if not access.key_login(candidate.host, candidate.user, candidate.port, identity):
                    raise ApiError(502, "The key was added but the server still refuses it. Check the account's ~/.ssh permissions on the Umbrel.",
                                   "key_refused")
            candidate.identity = identity
            doctor = candidate.request("doctor")
        except ApiError:
            raise
        except (access.AccessError, transport.ConnectionError, RuntimeError, OSError) as exc:
            raise ApiError(502, self.friendly(str(exc)), "ssh") from exc
        with self.lock:
            self.connection, self.doctor, self.refreshed_at = candidate, doctor, None
            self.cache.clear()
        return {"status": "connected", **self.state()}

    def verify_host_key(self, candidate, trust: bool):
        """None when the host key is known or was just trusted; otherwise the unseen keys the user must confirm."""
        key = (candidate.host, candidate.port)
        if access.known_host(candidate.host, candidate.port):
            self.pending_keys.pop(key, None)
            return None
        pending = self.pending_keys.get(key)
        if trust and pending:
            access.trust_host(pending)  # only the keys that were shown to the user
            self.pending_keys.pop(key, None)
            return None
        keys = access.scan_host(candidate.host, candidate.user, candidate.port)
        if not keys:
            raise ApiError(502, "Could not read the server's host key. Check the address and that SSH is reachable.", "hostkey")
        self.pending_keys[key] = keys
        return keys

    @staticmethod
    def friendly(message: str) -> str:
        if "password is required" in message:
            return "Umbrel needs your password for sudo. Enter it and connect again."
        if "Sorry, try again" in message or "incorrect password" in message.lower():
            return "Umbrel did not accept that password for sudo."
        return message

    def disconnect(self) -> dict:
        with self.lock:
            if self.connection is not None and not self.demo:
                self.connection.sudo_password = None
            if not self.demo:
                self.connection, self.doctor, self.refreshed_at = None, None, None
            self.cache.clear()
        return self.state()

    # -- apps
    def require_connection(self):
        if self.connection is None:
            raise ApiError(409, "Not connected. Connect to an Umbrel first.", "not_connected")
        return self.connection

    def apps(self) -> dict:
        connection = self.require_connection()
        try:
            apps = copy.deepcopy(self.demo_apps) if self.demo else connection.request("list")
        except (transport.ConnectionError, RuntimeError, OSError) as exc:
            raise ApiError(502, self.friendly(str(exc)), "ssh") from exc
        self.refreshed_at = clock()
        return {"apps": apps, "refreshedAt": self.refreshed_at}

    def logs(self, app_id: str) -> dict:
        connection = self.require_connection()
        try:
            identifier = package.app_id(app_id)
        except package.PackageError as exc:
            raise ApiError(400, str(exc), "invalid") from exc
        if self.demo:
            known = next((app for app in self.demo_apps if app["id"] == identifier), None)
            if known is None:
                raise ApiError(404, f"No app named {identifier} is installed.", "not_found")
            return {"appId": identifier, "text": DEMO_LOGS.format(id=identifier, port=known["port"])}
        try:
            result = connection.request("logs", appId=identifier)
        except (transport.ConnectionError, RuntimeError, OSError) as exc:
            raise ApiError(502, self.friendly(str(exc)), "ssh") from exc
        return {"appId": identifier, "text": result if isinstance(result, str) else json.dumps(result, indent=2, ensure_ascii=False)}

    def lifecycle(self, app_id: str, action: str) -> dict:
        """Start, stop or restart one app. The demo changes its own sample state; a real Umbrel goes through the core."""
        connection = self.require_connection()
        if action not in LIFECYCLE:
            raise ApiError(404, "No such action.", "not_found")
        try:
            identifier = package.app_id(app_id)
        except package.PackageError as exc:
            raise ApiError(400, str(exc), "invalid") from exc
        if self.demo:
            app = next((app for app in self.demo_apps if app["id"] == identifier), None)
            if app is None:
                raise ApiError(404, f"No app named {identifier} is installed.", "not_found")
            if app["state"] not in LIFECYCLE[action]:
                raise ApiError(409, f"Cannot {action} {identifier} while it is {app['state']}.", "state")
            app["state"] = "stopped" if action == "stop" else "ready"
            self.cache.pop("memory", None)
            return {"appId": identifier, "action": action, "state": app["state"]}
        try:
            result = connection.request(action, appId=identifier)
            self.cache.pop("memory", None)  # the app's memory just changed
            return result
        except (transport.ConnectionError, RuntimeError, OSError) as exc:
            message = self.friendly(str(exc))
            refused = message.startswith("Cannot ") or message.endswith("is not installed.")
            raise ApiError(409 if refused else 502, message, "state" if refused else "ssh") from exc

    # -- usage
    def cached(self, key: str, ttl: float, force: bool, produce) -> dict:
        now = time.monotonic()
        hit = self.cache.get(key)
        if hit and not force and now - hit[0] < ttl:
            return hit[1]
        try:
            value = produce()
        except (transport.ConnectionError, RuntimeError, OSError) as exc:
            raise ApiError(502, self.friendly(str(exc)), "ssh") from exc
        value = {**value, "measuredAt": clock()}
        self.cache[key] = (now, value)
        return value

    def usage(self) -> dict:
        """Memory per app and in total, in bytes. Safe to ask every few seconds."""
        connection = self.require_connection()
        return self.cached("memory", MEMORY_TTL, False, self.demo_memory if self.demo else lambda: connection.request("usage"))

    def storage(self, refresh: bool = False) -> dict:
        """Storage per app and in total, in bytes. Slow on the Umbrel, so it is kept for minutes unless `refresh` is set."""
        connection = self.require_connection()
        return self.cached("storage", STORAGE_TTL, refresh, self.demo_storage if self.demo else lambda: connection.request("storage"))

    def demo_memory(self) -> dict:
        running = {app["id"] for app in self.demo_apps if app["state"] in ("ready", "running")}
        apps = {name: int(base * random.uniform(0.97, 1.03)) if name in running else 0 for name, base in DEMO_MEMORY.items()}
        return {"size": DEMO_RAM_SIZE, "used": int(sum(apps.values()) + 1.4 * GIB), "apps": apps}

    def demo_storage(self) -> dict:
        used = int(sum(DEMO_DISK.values()) + 60e9)
        return {"size": DEMO_DISK_SIZE, "used": used, "available": DEMO_DISK_SIZE - used,
                "apps": {name: int(size) for name, size in DEMO_DISK.items()}}

    # -- packages: retrieve, review, ports, push
    @staticmethod
    def valid_id(app_id: str) -> str:
        try:
            return package.app_id(app_id)
        except package.PackageError as exc:
            raise ApiError(400, str(exc), "invalid") from exc

    def call(self, action):
        """Run something on the Umbrel and turn its failures into one sentence with the right status."""
        try:
            return action()
        except (transport.ConnectionError, RuntimeError, OSError) as exc:
            message = self.friendly(str(exc))
            stale = message.startswith(("Installed files changed", "Previously retrieved"))
            refused = stale or message.startswith("Cannot ")
            raise ApiError(409 if refused else 502, message, "stale" if stale else "state" if refused else "ssh") from exc

    def package_view(self, raw: dict) -> dict:
        """What the editor needs: the files and baseline, where the app came from, its images, and the structured settings."""
        view = {key: raw.get(key) for key in ("appId", "files", "baseline", "origin", "images", "backup")}
        view.update(editor.read_settings(view["files"]))
        return view

    def retrieve(self, app_id: str) -> dict:
        connection = self.require_connection()
        identifier = self.valid_id(app_id)
        raw = self.demo_package(identifier) if self.demo else self.call(lambda: connection.request("retrieve", appId=identifier))
        return self.package_view(raw)

    def review(self, app_id: str, files, baseline) -> dict:
        """The edited package compared with what is installed right now, refused if the installed copy changed since retrieval."""
        connection = self.require_connection()
        identifier = self.valid_id(app_id)
        files = editor.clean_files(files)
        editor.check_for_apply(identifier, files, baseline)
        if not baseline:
            return {"diff": package.diff({}, files) or "No YAML changes."}
        current = self.demo_package(identifier) if self.demo else self.call(lambda: connection.request("retrieve", appId=identifier))
        if current["baseline"] != baseline:
            raise ApiError(409, "Installed files changed since retrieval. Retrieve again and merge before applying.", "stale")
        return {"diff": package.diff(current["files"], files) or "No YAML changes."}

    def ports(self, app_id: str, files) -> dict:
        """Ports the package wants that something else on the Umbrel already uses, each with free ports to pick instead."""
        connection = self.require_connection()
        identifier = self.valid_id(app_id)
        files = editor.clean_files(files)
        if self.demo:
            used, own = self.demo_ports(identifier)
        else:
            reply = self.call(lambda: connection.request("ports", appId=identifier)) or {}
            used, own = {int(port): owner for port, owner in (reply.get("used") or {}).items()}, set(reply.get("own") or [])
        return {"conflicts": editor.conflicts_for(files, used, own), "used": {str(port): owner for port, owner in used.items()}}

    def push(self, app_id: str, files, baseline, pull: bool = False) -> dict:
        """Install a new app or apply edits to a retrieved one, then return the installed copy as the editor's new baseline."""
        connection = self.require_connection()
        identifier = self.valid_id(app_id)
        files = editor.clean_files(files)
        editor.check_for_apply(identifier, files, baseline)
        if self.demo:
            result = self.demo_push(identifier, files, baseline)
        else:
            result = self.call(lambda: connection.request("push", appId=identifier, files=files, baseline=baseline or None, pull=bool(pull)))
        self.cache.pop("memory", None)
        return self.package_view(result)

    # -- image and icon lookups
    def image_tags(self, image: str) -> dict:
        if self.demo:
            image = editor.text(image, "The image", required=True).strip()
            repository = editor.catalog.hub_repository(image)
            return {"image": image, "tags": DEMO_TAGS.get(repository, []), "registry": "docker-hub" if repository else "other"}
        return editor.image_tags(image)

    def search_images(self, query: str) -> dict:
        if self.demo:
            needle = query.strip().lower()
            return {"results": [hit for hit in DEMO_SEARCH if needle in hit["name"]]}
        return editor.search_images(query)

    def automatic_icon(self, image: str) -> dict:
        return {"icon": None} if self.demo else editor.automatic_icon(image)

    # -- demo packages
    def demo_package(self, identifier: str) -> dict:
        app = next((app for app in self.demo_apps if app["id"] == identifier), None)
        if app is None:
            raise ApiError(404, f"No app named {identifier} is installed.", "not_found")
        if identifier not in self.demo_packages:
            files = package.generate(identifier, DEMO_IMAGES.get(identifier, "nginx:1.27"), app["name"], 80, app["port"])
            settings = editor.core_settings.read_settings(files)
            settings.version = app["version"]
            self.demo_packages[identifier] = editor.core_settings.write_settings(files, settings)
        files = copy.deepcopy(self.demo_packages[identifier])
        baseline = package.digest(files)
        return {"appId": identifier, "files": files, "baseline": baseline, "origin": copy.deepcopy(app["origin"]),
                "images": [{"container": f"{identifier}_server_1", "configuredImage": editor.core_settings.read_settings(files).image,
                            "runningImageId": "sha256:" + baseline[:12], "state": "running" if app["state"] in ("ready", "running") else "exited"}]}

    def demo_ports(self, identifier: str):
        used = {app["port"]: f"{app['name']} (dashboard)" for app in self.demo_apps if app["id"] != identifier}
        used[22] = "a service on the Umbrel"
        own = {app["port"] for app in self.demo_apps if app["id"] == identifier}
        return used, own

    def demo_push(self, identifier: str, files: dict, baseline) -> dict:
        manifest = package.validate(files)[0]
        app = next((app for app in self.demo_apps if app["id"] == identifier), None)
        if app is None:
            if baseline:
                raise ApiError(409, "Previously retrieved app is no longer installed. Refusing to recreate it silently.", "stale")
            self.demo_apps.append({"id": identifier, "name": manifest["name"], "version": manifest["version"], "state": "ready", "port": manifest["port"],
                                   "origin": {"kind": "custom", "notice": "Custom app; use Umbrel Push for package updates."}})
            self.demo_packages[identifier] = files
            return {**self.demo_package(identifier), "backup": None}
        if not baseline or baseline != self.demo_package(identifier)["baseline"]:
            raise ApiError(409, "Installed files changed since retrieval. Retrieve again and merge your changes.", "stale")
        self.demo_packages[identifier] = files
        app.update(name=manifest["name"], version=manifest["version"], port=manifest["port"])
        app["origin"] = {**app["origin"], "modified": True}
        return {**self.demo_package(identifier), "backup": "20261001T120000Z-demo"}
