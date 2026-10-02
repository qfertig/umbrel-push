"""Structured view of a package: the CasaOS-style fields people expect, mapped onto Umbrel's YAML.

read_settings() derives a Settings object from the manifest and Compose file; write_settings() edits
the parsed YAML in place so keys this form does not know about survive. Comments are not preserved
by PyYAML; the YAML tab shows the regenerated text immediately so nothing is hidden.
"""
from __future__ import annotations

import copy
import re
import shlex
from dataclasses import dataclass, field

import yaml

from .package import PackageError, dump_yaml_rt, parse_yaml, parse_yaml_rt

PORT = re.compile(r"^(?:(?P<ip>[\w.\[\]:]+?):)?(?P<host>\d+):(?P<container>\d+)(?:/(?P<proto>tcp|udp))?$")
RESTART_POLICIES = ("unless-stopped", "always", "on-failure", "no")
NETWORKS = ("bridge", "host")
CPU_SHARES = {"Low": 512, "Normal": 1024, "High": 2048}
MEMORY_UNITS = {"b": 1, "k": 1024, "m": 1024 ** 2, "g": 1024 ** 3}


@dataclass
class PortMapping:
    host: int
    container: int
    protocol: str = "tcp"
    ip: str | None = None


@dataclass
class Volume:
    host: str
    container: str
    mode: str | None = None


@dataclass
class Settings:
    app_id: str
    name: str
    version: str
    icon: str | None
    dashboard_port: int
    path: str
    web_port: int | None          # APP_PORT handed to app_proxy; None when there is no proxy
    service: str                  # Compose service edited by the form
    image: str
    container_name: str
    network: str                  # "bridge" (default) or "host"
    ports: list[PortMapping] = field(default_factory=list)
    volumes: list[Volume] = field(default_factory=list)
    environment: list[tuple[str, str]] = field(default_factory=list)
    devices: list[str] = field(default_factory=list)
    command: str = ""
    privileged: bool = False
    memory_mb: int = 0            # 0 means no limit
    cpu_shares: int | None = None
    restart: str = "unless-stopped"
    cap_add: list[str] = field(default_factory=list)


def split_image(image: str) -> tuple[str, str]:
    """'ghcr.io/org/app:1.2' -> ('ghcr.io/org/app', '1.2'); digests stay in the tag part."""
    if "@" in image:
        repository, digest = image.split("@", 1)
        return repository, "@" + digest
    last = image.rsplit("/", 1)[-1]
    if ":" in last:
        repository, tag = image.rsplit(":", 1)
        return repository, tag
    return image, ""


def join_image(repository: str, tag: str) -> str:
    repository = repository.strip()
    tag = tag.strip()
    if not tag:
        return repository
    return repository + (tag if tag.startswith("@") else ":" + tag)


def parse_memory(value) -> int:
    """Compose mem_limit ('512m', '2g', 1073741824) -> MiB, rounded down."""
    if value in (None, "", 0):
        return 0
    if isinstance(value, (int, float)):
        return int(value) // MEMORY_UNITS["m"]
    match = re.fullmatch(r"(\d+)\s*([bkmgBKMG]?)[bB]?", str(value).strip())
    if not match:
        raise PackageError(f"Unrecognised memory limit: {value}")
    return int(match.group(1)) * MEMORY_UNITS[(match.group(2) or "b").lower()] // MEMORY_UNITS["m"]


def parse_port(entry) -> PortMapping | None:
    if isinstance(entry, dict):
        published, target = entry.get("published"), entry.get("target")
        if published is None or target is None:
            return None
        return PortMapping(int(published), int(target), str(entry.get("protocol", "tcp")), entry.get("host_ip"))
    match = PORT.match(str(entry))
    if not match:
        return None
    return PortMapping(int(match["host"]), int(match["container"]), match["proto"] or "tcp", match["ip"])


def format_port(mapping: PortMapping) -> str:
    text = f"{mapping.host}:{mapping.container}"
    if mapping.ip:
        text = f"{mapping.ip}:{text}"
    if mapping.protocol and mapping.protocol != "tcp":
        text += f"/{mapping.protocol}"
    return text


def parse_volume(entry) -> Volume | None:
    if isinstance(entry, dict):
        if "source" not in entry or "target" not in entry:
            return None
        return Volume(str(entry["source"]), str(entry["target"]), "ro" if entry.get("read_only") else None)
    parts = str(entry).split(":")
    if len(parts) == 2:
        return Volume(parts[0], parts[1])
    if len(parts) == 3:
        return Volume(parts[0], parts[1], parts[2])
    return None


def format_volume(volume: Volume) -> str:
    text = f"{volume.host}:{volume.container}"
    return text + (f":{volume.mode}" if volume.mode else "")


def parse_environment(value) -> list[tuple[str, str]]:
    if not value:
        return []
    if isinstance(value, dict):
        return [(str(k), "" if v is None else str(v)) for k, v in value.items()]
    result = []
    for item in value:
        key, _, val = str(item).partition("=")
        result.append((key, val))
    return result


def main_service(compose: dict) -> str:
    services = compose.get("services") or {}
    proxy_host = ((services.get("app_proxy") or {}).get("environment") or {}).get("APP_HOST") if isinstance(services.get("app_proxy"), dict) else None
    if isinstance(proxy_host, str):
        for name in services:
            if name != "app_proxy" and (proxy_host == name or proxy_host.endswith(f"_{name}_1") or proxy_host == f"{name}"):
                return name
    for name in services:
        if name != "app_proxy":
            return name
    raise PackageError("The Compose file has no service besides app_proxy.")


def read_settings(files: dict) -> Settings:
    manifest = parse_yaml(files["umbrel-app.yml"]["content"], "manifest")
    compose = parse_yaml(files["docker-compose.yml"]["content"], "Compose file")
    services = compose.get("services") or {}
    name = main_service(compose)
    service = services[name] or {}
    proxy = services.get("app_proxy") if isinstance(services.get("app_proxy"), dict) else None
    web_port = None
    if proxy is not None:
        raw = (proxy.get("environment") or {}).get("APP_PORT")
        if isinstance(proxy.get("environment"), list):
            raw = next((v.partition("=")[2] for v in proxy["environment"] if str(v).startswith("APP_PORT=")), None)
        web_port = int(raw) if raw not in (None, "") and str(raw).isdigit() else None
    command = service.get("command", "")
    if isinstance(command, list):
        command = shlex.join(str(part) for part in command)
    cpu = service.get("cpu_shares")
    return Settings(
        app_id=str(manifest.get("id", "")), name=str(manifest.get("name", "")), version=str(manifest.get("version", "")),
        icon=manifest.get("icon"), dashboard_port=int(manifest.get("port", 0) or 0), path=str(manifest.get("path", "") or ""),
        web_port=web_port, service=name, image=str(service.get("image", "")),
        container_name=str(service.get("container_name", "") or ""),
        network="host" if service.get("network_mode") == "host" else "bridge",
        ports=[p for p in (parse_port(e) for e in service.get("ports") or []) if p],
        volumes=[v for v in (parse_volume(e) for e in service.get("volumes") or []) if v],
        environment=parse_environment(service.get("environment")),
        devices=[str(d) for d in service.get("devices") or []],
        command=str(command or ""), privileged=bool(service.get("privileged", False)),
        memory_mb=parse_memory(service.get("mem_limit")),
        cpu_shares=int(cpu) if isinstance(cpu, int) else None,
        restart=str(service.get("restart", "unless-stopped") or "no"),
        cap_add=[str(c) for c in service.get("cap_add") or []],
    )


def set_or_drop(mapping: dict, key: str, value, keep=lambda v: bool(v)):
    if keep(value):
        if key in mapping and mapping[key] == value:
            return  # unchanged: leave the original node so its quoting and comments survive
        mapping[key] = value
    elif key in mapping and not keep(mapping[key]):
        return  # already empty in the original ('path: ""'): leave it rather than show a pointless removal
    else:
        mapping.pop(key, None)


def write_settings(files: dict, settings: Settings) -> dict:
    """Return a copy of files with the manifest and Compose file updated from settings."""
    files = copy.deepcopy(files)
    manifest = parse_yaml_rt(files["umbrel-app.yml"]["content"], "manifest")
    compose = parse_yaml_rt(files["docker-compose.yml"]["content"], "Compose file")
    services = compose.setdefault("services", {})
    if settings.service not in services:
        raise PackageError(f"Service {settings.service} no longer exists in the Compose file.")
    service = services[settings.service] or {}
    services[settings.service] = service

    if not settings.name.strip():
        raise PackageError("The app needs a title.")
    manifest["name"] = settings.name.strip()
    if settings.version.strip():
        manifest["version"] = settings.version.strip()
    if not 1 <= settings.dashboard_port <= 65535:
        raise PackageError("The dashboard port must be between 1 and 65535.")
    manifest["port"] = settings.dashboard_port
    set_or_drop(manifest, "path", settings.path.strip())
    if settings.icon:
        manifest["icon"] = settings.icon

    if not settings.image.strip():
        raise PackageError("The container image cannot be empty.")
    service["image"] = settings.image.strip()
    set_or_drop(service, "container_name", settings.container_name.strip())
    if settings.network == "host":
        service["network_mode"] = "host"
    elif service.get("network_mode") == "host":
        service.pop("network_mode")
    set_or_drop(service, "ports", [format_port(p) for p in settings.ports])
    set_or_drop(service, "volumes", [format_volume(v) for v in settings.volumes])
    env = {k.strip(): v for k, v in settings.environment if k.strip()}
    if parse_environment(service.get("environment")) == [(k, v) for k, v in env.items()]:
        pass  # same variables as before: keep the original text, including unquoted numbers and comments
    elif isinstance(service.get("environment"), list):
        set_or_drop(service, "environment", [f"{k}={v}" for k, v in env.items()])
    else:
        set_or_drop(service, "environment", env)
    set_or_drop(service, "devices", [d.strip() for d in settings.devices if d.strip()])
    if settings.command.strip():
        try:
            parts = shlex.split(settings.command)
        except ValueError as exc:
            raise PackageError(f"Command could not be parsed: {exc}") from exc
        service["command"] = parts if len(parts) > 1 else settings.command.strip()
    else:
        service.pop("command", None)
    set_or_drop(service, "privileged", True if settings.privileged else None, keep=lambda v: v is True)
    set_or_drop(service, "mem_limit", f"{settings.memory_mb}m" if settings.memory_mb > 0 else None)
    set_or_drop(service, "cpu_shares", settings.cpu_shares, keep=lambda v: v is not None)
    if settings.restart not in RESTART_POLICIES:
        raise PackageError("Unknown restart policy.")
    if settings.restart == "no":
        service.pop("restart", None)
    else:
        service["restart"] = settings.restart
    set_or_drop(service, "cap_add", [c.strip() for c in settings.cap_add if c.strip()])

    proxy = services.get("app_proxy") if isinstance(services.get("app_proxy"), dict) else None
    if proxy is not None and settings.web_port is not None:
        if not 1 <= settings.web_port <= 65535:
            raise PackageError("The container web port must be between 1 and 65535.")
        environment = proxy.setdefault("environment", {})
        if isinstance(environment, list):
            proxy["environment"] = [v for v in environment if not str(v).startswith("APP_PORT=")] + [f"APP_PORT={settings.web_port}"]
        else:
            environment["APP_PORT"] = str(settings.web_port)

    files["umbrel-app.yml"]["content"] = dump_yaml_rt(manifest, files["umbrel-app.yml"]["content"])
    files["docker-compose.yml"]["content"] = dump_yaml_rt(compose, files["docker-compose.yml"]["content"])
    return files


# --- port conflicts --------------------------------------------------------------------------------

@dataclass
class Conflict:
    port: int
    owner: str
    kind: str   # "dashboard" or "published"


def requested_ports(files: dict) -> tuple[int, list[int]]:
    """The dashboard port and every published host port in the package."""
    manifest = parse_yaml(files["umbrel-app.yml"]["content"], "manifest")
    compose = parse_yaml(files["docker-compose.yml"]["content"], "Compose file")
    published = []
    for name, service in (compose.get("services") or {}).items():
        if name == "app_proxy" or not isinstance(service, dict):
            continue
        for entry in service.get("ports") or []:
            mapping = parse_port(entry)
            if mapping:
                published.append(mapping.host)
    return int(manifest.get("port", 0) or 0), published


def find_conflicts(files: dict, used: dict[int, str], own: set[int] = frozenset()) -> list[Conflict]:
    """used maps host port -> owner label as reported by the server; own are this app's current ports."""
    dashboard, published = requested_ports(files)
    conflicts = []
    seen = set()
    for kind, port in [("dashboard", dashboard)] + [("published", p) for p in published]:
        if port in used and port not in own and port not in seen:
            conflicts.append(Conflict(port, used[port], kind))
            seen.add(port)
    return conflicts


def suggest_ports(used: dict[int, str], wanted: int, count: int = 8, taken: set[int] = frozenset()) -> list[int]:
    """Free ports near the wanted one first, then the Umbrel-ish 18xxx range, never below 1024."""
    suggestions = []
    candidates = list(range(max(wanted, 1024) + 1, max(wanted, 1024) + 200)) + list(range(18990, 19990))
    for port in candidates:
        if port not in used and port not in taken and port not in suggestions and port <= 65535:
            suggestions.append(port)
        if len(suggestions) >= count:
            break
    return suggestions


def replace_port(files: dict, old: int, new: int) -> dict:
    """Move the dashboard port and/or published host ports from old to new."""
    files = copy.deepcopy(files)
    manifest = parse_yaml_rt(files["umbrel-app.yml"]["content"], "manifest")
    compose = parse_yaml_rt(files["docker-compose.yml"]["content"], "Compose file")
    changed = False
    if manifest.get("port") == old:
        manifest["port"] = new
        changed = True
    for name, service in (compose.get("services") or {}).items():
        if name == "app_proxy" or not isinstance(service, dict) or not service.get("ports"):
            continue
        rewritten = []
        for entry in service["ports"]:
            mapping = parse_port(entry)
            if mapping and mapping.host == old:
                mapping.host = new
                rewritten.append(format_port(mapping))
                changed = True
            else:
                rewritten.append(entry)
        service["ports"] = rewritten
    if changed:
        files["umbrel-app.yml"]["content"] = dump_yaml_rt(manifest, files["umbrel-app.yml"]["content"])
        files["docker-compose.yml"]["content"] = dump_yaml_rt(compose, files["docker-compose.yml"]["content"])
    return files
