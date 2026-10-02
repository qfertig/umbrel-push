"""Local package editing. Never execute package scripts on the workstation."""
from __future__ import annotations

import difflib
import hashlib
import html
import io
import json
import re
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import yaml
from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError

MAX_FILE = 2 * 1024 * 1024
MAX_PACKAGE = 8 * 1024 * 1024
CORE_FILES = ("umbrel-app.yml", "docker-compose.yml")
ID = re.compile(r"[a-z0-9]+(?:[-_][a-z0-9]+)*\Z")
IMAGE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/:@-]*\Z")


class PackageError(ValueError):
    pass


def app_id(value: str) -> str:
    if len(value) > 80 or not ID.fullmatch(value):
        raise PackageError("Use an app ID of lowercase letters, numbers, hyphens, or underscores (max 80).")
    return value


def safe_name(name: str) -> str:
    path = PurePosixPath(name)
    if not name or "\\" in name or path.is_absolute() or any(p in ("..", ".") for p in name.split("/")):
        raise PackageError(f"Unsafe package path: {name}")
    if ":" in name or any(ord(c) < 32 for c in name):
        raise PackageError(f"Unsafe package path: {name}")
    # Only package source files, never live data, credentials, or Umbrel-generated files.
    if name in CORE_FILES or name == "exports.sh" or name == "torrc" or name.endswith(".template"):
        if "/" not in name:
            return name
    if len(path.parts) == 2 and path.parts[0] == "hooks" and re.fullmatch(r"(?:pre|post)-(?:install|start|stop|update|uninstall)", path.name):
        return name
    raise PackageError(f"Not an editable package source file: {name}")


def digest(files: dict[str, dict]) -> str:
    canonical = {k: {"content": v["content"], "mode": v.get("mode", 0o644)} for k, v in sorted(files.items())}
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def parse_yaml(text: str, label: str) -> dict:
    try:
        result = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise PackageError(f"Invalid {label}: {exc}") from exc
    if not isinstance(result, dict):
        raise PackageError(f"{label} must be a YAML mapping.")
    return result


def _round_trip(original: str = "") -> YAML:
    """A round-trip loader and dumper matched to the original's indentation, so unchanged lines stay byte-identical."""
    rt = YAML()
    rt.preserve_quotes = True
    rt.width = 4096
    lines = original.splitlines()
    step = next((len(b) - len(b.lstrip()) - (len(a) - len(a.lstrip()))
                 for a, b in zip(lines, lines[1:])
                 if a.rstrip().endswith(":") and not a.lstrip().startswith("#") and b.strip() and not b.lstrip().startswith("#")
                 and len(b) - len(b.lstrip()) > len(a) - len(a.lstrip())), 2)
    offset = next((len(b) - len(b.lstrip()) - (len(a) - len(a.lstrip()))
                   for a, b in zip(lines, lines[1:])
                   if a.rstrip().endswith(":") and b.lstrip().startswith("- ") and len(b) - len(b.lstrip()) >= len(a) - len(a.lstrip())), 0)
    rt.indent(mapping=max(step, 2), sequence=max(step, 2) + offset, offset=offset)
    return rt


def parse_yaml_rt(text: str, label: str):
    """Like parse_yaml but keeps comments, quoting and layout, for edits that should change only what was touched."""
    try:
        result = _round_trip(text).load(text)
    except YAMLError as exc:
        raise PackageError(f"Invalid {label}: {exc}") from exc
    if not isinstance(result, dict):
        raise PackageError(f"{label} must be a YAML mapping.")
    return result


def dump_yaml_rt(data, original: str) -> str:
    out = io.StringIO()
    _round_trip(original).dump(data, out)
    return _keep_original_whitespace(original, out.getvalue())


def _keep_original_whitespace(original: str, dumped: str) -> str:
    """The dumper strips trailing spaces; put them back on lines that differ from the original in nothing else."""
    old, new = original.split("\n"), dumped.split("\n")
    result = []
    for tag, a1, a2, b1, b2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if tag == "replace" and a2 - a1 == b2 - b1 and all(x.rstrip() == y.rstrip() for x, y in zip(old[a1:a2], new[b1:b2])):
            result.extend(old[a1:a2])
        else:
            result.extend(new[b1:b2])
    return "\n".join(result)


def validate(files: dict[str, dict]) -> tuple[dict, list[str]]:
    for name in CORE_FILES:
        if name not in files:
            raise PackageError(f"Missing {name}")
    total = 0
    for name, entry in files.items():
        safe_name(name)
        size = len(entry["content"].encode())
        if size > MAX_FILE:
            raise PackageError(f"{name} exceeds 2 MiB.")
        total += size
    if total > MAX_PACKAGE:
        raise PackageError("Package exceeds 8 MiB.")
    manifest = parse_yaml(files["umbrel-app.yml"]["content"], "manifest")
    compose = parse_yaml(files["docker-compose.yml"]["content"], "Compose file")
    app_id(manifest.get("id", ""))
    for field in ("name", "tagline", "category", "version", "description", "website", "support"):
        if not isinstance(manifest.get(field), str) or not manifest[field].strip():
            raise PackageError(f"Manifest {field} must be a nonempty string; quote numeric versions.")
    required = re.fullmatch(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?", str(manifest.get("manifestVersion")))
    version = tuple(int(part or 0) for part in required.groups()) if required else None
    if not version or not (0, 0, 0) < version <= (2, 0, 0):
        raise PackageError("Manifest requires an unsupported Umbrel version; this adapter targets 2.0.0.")
    if type(manifest.get("port")) is not int or not 1 <= manifest["port"] <= 65535:
        raise PackageError("Manifest port must be an integer between 1 and 65535.")
    if not isinstance(manifest.get("gallery"), list):
        raise PackageError("Manifest gallery must be an array (an empty array is fine).")
    services = compose.get("services")
    if not isinstance(services, dict) or not services:
        raise PackageError("Compose must contain services.")
    warnings = []
    for name, service in services.items():
        if not isinstance(service, dict):
            raise PackageError(f"Service {name} must be a mapping.")
        if name == "app_proxy":
            continue
        image = service.get("image")
        if not isinstance(image, str) or not image:
            raise PackageError(f"Service {name} needs an image. Build contexts are not uploaded by this version.")
        if service.get("build"):
            raise PackageError("Build contexts aren't supported yet. Build and publish/load the image first.")
        if image.endswith(":latest") or (":" not in image.rsplit("/", 1)[-1] and "@" not in image):
            warnings.append(f"{name}: floating image tag; pulling is an explicit operation, not an automatic update.")
        if service.get("privileged") or service.get("devices") or service.get("network_mode") == "host":
            warnings.append(f"{name}: requests host or device access; this needs app-specific configuration.")
        if service.get("ports"):
            warnings.append(f"{name}: publishes host ports in addition to any Umbrel gateway port.")
    if "app_proxy" not in services:
        warnings.append("No app_proxy declaration; verify that the manifest's dashboard URL reaches the app.")
    if manifest.get("dependencies"):
        warnings.append("Dependencies must already be installed and configured on Umbrel.")
    if any(n.startswith("hooks/") or n == "exports.sh" for n in files):
        warnings.append("Package contains shell code that Umbrel executes on the server.")
    return manifest, warnings


def read_package(directory: Path) -> tuple[dict, dict]:
    if not directory.is_dir():
        raise PackageError(f"Package directory does not exist: {directory}")
    state_path = directory / ".umbrel-push.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    files = {}
    candidates = list(directory.iterdir())
    hooks = directory / "hooks"
    if hooks.is_symlink():
        raise PackageError("Package hooks cannot be a symbolic link.")
    if hooks.is_dir():
        candidates += list(hooks.iterdir())
    for file in candidates:
        name = file.relative_to(directory).as_posix()
        try:
            safe_name(name)
        except PackageError:
            continue
        if file.is_symlink() or not file.is_file():
            raise PackageError(f"Package file must be a regular file: {name}")
        if file.stat().st_size > MAX_FILE:
            raise PackageError(f"Package file is too large: {name}")
        mode = state.get("modes", {}).get(name, 0o755 if name.startswith("hooks/") else 0o644)
        files[name] = {"content": file.read_text(encoding="utf-8"), "mode": mode}
    validate(files)
    return files, state


def write_package(directory: Path, files: dict, state: dict | None = None):
    validate(files)
    if directory.exists() and any(directory.iterdir()):
        raise PackageError("Choose an empty destination; existing local edits will not be overwritten.")
    directory.mkdir(parents=True, exist_ok=True)
    for name, entry in files.items():
        path = directory / safe_name(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(entry["content"], encoding="utf-8", newline="\n")
    if state is not None:
        state = {**state, "modes": {n: e.get("mode", 0o644) for n, e in files.items()}}
        (directory / ".umbrel-push.json").write_text(json.dumps(state, indent=2), encoding="utf-8")


def generate(identifier: str, image: str, name: str, internal_port: int, port: int,
             volume_target: str | None = None, icon: str | None = None) -> dict:
    app_id(identifier)
    if not IMAGE.fullmatch(image):
        raise PackageError("Enter a container image reference, such as nginx:latest.")
    if not 1 <= internal_port <= 65535:
        raise PackageError("The container web port must be between 1 and 65535.")
    if ":" not in image.rsplit("/", 1)[-1] and "@" not in image:
        image += ":latest"
    manifest = {"manifestVersion": 1, "id": identifier, "name": name, "tagline": "A custom app on your Umbrel",
                "category": "utilities", "version": "1.0.0", "port": port,
                "description": f"{name}, installed with Umbrel Push.", "developer": "Personal app",
                "website": "https://umbrel.com", "support": "Managed locally with Umbrel Push", "gallery": []}
    from .catalog import NO_ICON
    if icon and not icon.startswith(('https://', 'http://', 'data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,')):
        raise PackageError('Icon must be an HTTP(S) URL or an embedded PNG, JPEG, or WebP image.')
    manifest['icon'] = icon or NO_ICON
    service = {"image": image, "restart": "unless-stopped"}
    if volume_target:
        if not volume_target.startswith("/") or ":" in volume_target:
            raise PackageError("The container data path must be absolute, for example /config.")
        service["volumes"] = [f"${{APP_DATA_DIR}}/data:{volume_target}"]
    compose = {"services": {"app_proxy": {"environment": {
        "APP_HOST": f"{identifier}_server_1", "APP_PORT": str(internal_port)}}, "server": service}}
    result = {"umbrel-app.yml": {"content": yaml.safe_dump(manifest, sort_keys=False), "mode": 0o644},
              "docker-compose.yml": {"content": yaml.safe_dump(compose, sort_keys=False), "mode": 0o644}}
    validate(result)
    return result


def diff(before: dict, after: dict) -> str:
    chunks = []
    for name in sorted(set(before) | set(after)):
        old = before.get(name, {}).get("content", "")
        new = after.get(name, {}).get("content", "")
        chunks.extend(difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True),
                                         fromfile=f"installed/{name}", tofile=f"local/{name}"))
    return "".join(chunks)
