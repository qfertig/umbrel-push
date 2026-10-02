"""Package editing for the web UI.

Translates between the core's objects and JSON, and holds the operations that need no connection to the Umbrel:
validate, diff, read and write the structured settings, move a port, generate a package, and look up image tags and
icons. The package itself lives in the browser while it is being edited; every call here takes the files and returns
new ones, so the server keeps no editing state.
"""
from __future__ import annotations

import base64
import binascii

from . import core
from .errors import ApiError

access, package, transport = core.load()
from umbrel_push import catalog  # noqa: E402
from umbrel_push import settings as core_settings  # noqa: E402

PackageError = package.PackageError
ICON_PREFIXES = ("https://", "http://", "data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,")


# --- input checks -------------------------------------------------------------------------------------

def clean_files(value, allow_empty: bool = False) -> dict:
    """Package files from the browser, checked for shape. Names and sizes are checked again by package.validate."""
    if not isinstance(value, dict) or (not value and not allow_empty):
        raise PackageError("The package has no files.")
    files = {}
    for name, entry in value.items():
        if not isinstance(name, str) or not isinstance(entry, dict) or not isinstance(entry.get("content"), str):
            raise PackageError("Every package file needs a name and text content.")
        mode = entry.get("mode", 0o644)
        if not isinstance(mode, int) or isinstance(mode, bool) or not 0 <= mode <= 0o777:
            raise PackageError(f"{name} has an invalid file mode.")
        files[name] = {"content": entry["content"], "mode": mode}
    return files


def whole_number(value, label: str, low: int = 0, high: int = 65535) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise PackageError(f"{label} must be a whole number from {low} to {high}.")
    return value


def text(value, label: str, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise PackageError(f"{label} must be text.")
    if required and not value.strip():
        raise PackageError(f"{label} cannot be empty.")
    return value


# --- settings <-> JSON --------------------------------------------------------------------------------

def settings_to_json(s) -> dict:
    return {
        "appId": s.app_id, "name": s.name, "version": s.version, "icon": s.icon,
        "dashboardPort": s.dashboard_port, "path": s.path, "webPort": s.web_port, "service": s.service,
        "image": s.image, "containerName": s.container_name, "network": s.network,
        "ports": [{"host": p.host, "container": p.container, "protocol": p.protocol, "ip": p.ip} for p in s.ports],
        "volumes": [{"host": v.host, "container": v.container, "mode": v.mode} for v in s.volumes],
        "environment": [[key, value] for key, value in s.environment], "devices": list(s.devices),
        "command": s.command, "privileged": s.privileged, "memoryMb": s.memory_mb, "cpuShares": s.cpu_shares,
        "restart": s.restart, "capAdd": list(s.cap_add),
    }


def settings_from_json(data) -> "core_settings.Settings":
    """The same checks the Qt form makes, so a bad value is refused here with a sentence instead of producing bad YAML."""
    if not isinstance(data, dict):
        raise PackageError("The settings are missing.")
    ports = []
    for entry in data.get("ports") or []:
        host, container = (entry or {}).get("host"), (entry or {}).get("container")
        if not isinstance(host, int) or not isinstance(container, int) or isinstance(host, bool) or isinstance(container, bool):
            shown = lambda value: "" if value is None else value  # noqa: E731
            raise PackageError(f"Published port '{shown(host)}:{shown(container)}' must use numbers.")
        whole_number(host, "A published host port", 1)
        whole_number(container, "A published container port", 1)
        protocol = str(entry.get("protocol") or "tcp").lower()
        if protocol not in ("tcp", "udp"):
            raise PackageError("A published port's protocol must be tcp or udp.")
        ports.append(core_settings.PortMapping(host, container, protocol, entry.get("ip") or None))
    volumes = []
    for entry in data.get("volumes") or []:
        host, container = text((entry or {}).get("host"), "A volume's host path").strip(), text(entry.get("container"), "A volume's container path").strip()
        if not host or not container.startswith("/"):
            raise PackageError(f"Volume '{host}:{container}' needs a host path and an absolute container path.")
        volumes.append(core_settings.Volume(host, container, entry.get("mode") or None))
    environment = []
    for pair in data.get("environment") or []:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            raise PackageError("Each environment variable needs a name and a value.")
        environment.append((text(pair[0], "An environment variable name"), text(pair[1], "An environment variable value")))
    network = text(data.get("network") or "bridge", "The network mode")
    if network not in core_settings.NETWORKS:
        raise PackageError("The network mode must be bridge or host.")
    icon = data.get("icon")
    if icon is not None and (not isinstance(icon, str) or (icon and not icon.startswith(ICON_PREFIXES))):
        raise PackageError("The icon must be an HTTP(S) URL or an embedded PNG, JPEG, or WebP image.")
    cpu = data.get("cpuShares")
    web_port = data.get("webPort")
    return core_settings.Settings(
        app_id=text(data.get("appId"), "The app ID"), name=text(data.get("name"), "The title"),
        version=text(data.get("version"), "The version"), icon=icon or None,
        dashboard_port=whole_number(data.get("dashboardPort"), "The dashboard port", 1),
        path=text(data.get("path"), "The dashboard path"),
        web_port=None if web_port is None else whole_number(web_port, "The container web port", 1),
        service=text(data.get("service"), "The service", required=True), image=text(data.get("image"), "The container image"),
        container_name=text(data.get("containerName"), "The container name"), network=network,
        ports=ports, volumes=volumes, environment=environment,
        devices=[text(d, "A device") for d in data.get("devices") or []], command=text(data.get("command"), "The command"),
        privileged=bool(data.get("privileged")), memory_mb=whole_number(data.get("memoryMb") or 0, "The memory limit", 0, 1024 * 1024),
        cpu_shares=None if cpu is None else whole_number(cpu, "CPU shares", 2, 262144),
        restart=text(data.get("restart") or "unless-stopped", "The restart policy"),
        cap_add=[text(c, "A capability") for c in data.get("capAdd") or []],
    )


# --- pure operations ----------------------------------------------------------------------------------

def read_settings(files) -> dict:
    """The structured view of a package, or the reason there is none (the YAML tab still works then)."""
    files = clean_files(files)
    try:
        return {"settings": settings_to_json(core_settings.read_settings(files)), "error": None}
    except (KeyError, ValueError, TypeError, AttributeError) as exc:
        return {"settings": None, "error": f"The settings view is unavailable for this package: {exc}"}


def write_settings(files, settings) -> dict:
    return {"files": core_settings.write_settings(clean_files(files), settings_from_json(settings))}


def validate(files) -> dict:
    manifest, warnings = package.validate(clean_files(files))
    return {"manifest": manifest, "warnings": warnings}


def diff(before, after) -> dict:
    return {"diff": package.diff(clean_files(before, allow_empty=True), clean_files(after))}


def replace_port(files, old, new) -> dict:
    old, new = whole_number(old, "The old port", 1), whole_number(new, "The new port", 1)
    return {"files": core_settings.replace_port(clean_files(files), old, new)}


def generate(data) -> dict:
    if not isinstance(data, dict):
        raise PackageError("The new app's details are missing.")
    name = text(data.get("name"), "The name", required=True).strip()
    files = package.generate(
        text(data.get("id"), "The ID", required=True).strip(), text(data.get("image"), "The image", required=True).strip(), name,
        whole_number(data.get("containerPort"), "The container web port", 1), whole_number(data.get("port"), "The dashboard port", 1),
        text(data.get("dataPath"), "The data path").strip() or None, data.get("icon") or None)
    return {"files": files}


def check_for_apply(app_id: str, files: dict, baseline) -> dict:
    """Validate the package, and keep a retrieved app from being renamed into a different one."""
    manifest, warnings = package.validate(files)
    if baseline and manifest["id"] != app_id:
        raise ApiError(400, "The ID of a retrieved app cannot be changed. Create a new package for a second installation.", "id")
    return manifest


def conflicts_for(files: dict, used: dict, own: set) -> list:
    taken: set = set()
    result = []
    for conflict in core_settings.find_conflicts(files, used, own):
        suggestions = core_settings.suggest_ports(used, conflict.port, taken=taken)
        if suggestions:
            taken.add(suggestions[0])
        result.append({"port": conflict.port, "owner": conflict.owner, "kind": conflict.kind, "suggestions": suggestions})
    return result


# --- public lookups (Docker Hub and the dashboard-icons project) ---------------------------------------

def lookup(action, failure: str):
    try:
        return action()
    except (OSError, ValueError, KeyError) as exc:
        raise ApiError(502, f"{failure} ({exc}).", "lookup") from exc


def image_tags(image: str) -> dict:
    image = text(image, "The image", required=True).strip()
    if not package.IMAGE.fullmatch(image):
        raise PackageError("Enter a container image reference, such as nginx:latest.")
    repository = catalog.hub_repository(image)
    tags = lookup(lambda: catalog.image_tags(image), "Docker Hub could not be reached") if repository else []
    return {"image": image, "tags": tags, "registry": "docker-hub" if repository else "other"}


def search_images(query: str) -> dict:
    results = lookup(lambda: catalog.search_images(query), "Docker Hub could not be searched")
    return {"results": [{"name": r.get("repo_name", ""), "official": bool(r.get("is_official")), "description": r.get("short_description", "")}
                        for r in results if r.get("repo_name")]}


def automatic_icon(image: str) -> dict:
    return {"icon": catalog.automatic_icon(text(image, "The image", required=True).strip())}


def embed_icon(data: str) -> dict:
    try:
        raw = base64.b64decode(text(data, "The image", required=True), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PackageError("The image could not be read.") from exc
    try:
        return {"icon": catalog.image_data(raw)}
    except ValueError as exc:
        raise PackageError(str(exc)) from exc

