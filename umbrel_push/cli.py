"""Small CLI; all deploy logic remains reusable by a future GUI."""
from __future__ import annotations

import argparse
import getpass
import json
import sys
from pathlib import Path

from . import __version__
from .access import default_identity
from .package import app_id, diff, generate, read_package, validate, write_package
from .transport import SSHConnection


def parser():
    p = argparse.ArgumentParser(prog="umbrel-push", description="Push individual apps to Umbrel and edit installed packages.")
    p.add_argument("--version", action="version", version=__version__)
    p.add_argument("--host", help="Umbrel IP address or hostname")
    p.add_argument("--user", default="umbrel")
    p.add_argument("--ssh-port", type=int, default=22)
    p.add_argument("--identity", help="SSH private key path (never uploaded); defaults to ~/.ssh/umbrel-push-<host> when present")
    p.add_argument("--ask-sudo-password", action="store_true", help="Prompt securely; keep the sudo password in memory for this command")
    p.add_argument("--data-dir", default="/home/umbrel/umbrel")
    p.add_argument("--json", action="store_true", help="Machine-readable results for integrations")
    commands = p.add_subparsers(dest="command", required=True)
    create = commands.add_parser("init", help="Generate a generic web-app package")
    create.add_argument("directory", type=Path)
    create.add_argument("--id", required=True)
    create.add_argument("--name", required=True)
    create.add_argument("--image", required=True)
    create.add_argument("--container-port", required=True, type=int)
    create.add_argument("--port", required=True, type=int, help="Dashboard-facing port on Umbrel")
    create.add_argument("--data-path", help="Persistent directory INSIDE the container, e.g. /config")
    create.add_argument("--icon", help="HTTP(S) URL for a dashboard icon")
    check = commands.add_parser("validate", help="Validate a local package without connecting")
    check.add_argument("directory", type=Path)
    commands.add_parser("doctor", help="Read-only connection and compatibility check")
    commands.add_parser("list", help="List installed apps and modification notices")
    get = commands.add_parser("retrieve", help="Download editable installed files, version, and running image details")
    get.add_argument("app_id")
    get.add_argument("directory", type=Path)
    compare = commands.add_parser("diff", help="Show local YAML changes against the installed package (may display secrets)")
    compare.add_argument("directory", type=Path)
    push = commands.add_parser("push", help="Install a new app or apply edits to a retrieved app")
    push.add_argument("directory", type=Path)
    push.add_argument("--pull", action="store_true", help="Pull current images before applying; supports literal image references")
    push.add_argument("--dry-run", action="store_true", help="Read-only comparison; don't upload or pull")
    logs = commands.add_parser("logs", help="Read recent Umbrel lifecycle/container logs")
    logs.add_argument("app_id")
    return p


def emit(value, as_json=False):
    if as_json or not isinstance(value, str):
        print(json.dumps(value, indent=2, ensure_ascii=False))
    else:
        print(value)


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "init":
            files = generate(args.id, args.image, args.name, args.container_port, args.port, args.data_path, args.icon)
            write_package(args.directory, files)
            emit({"directory": str(args.directory.resolve()), "appId": args.id, "warnings": validate(files)[1]}, args.json)
            return 0
        if args.command == "validate":
            files, _ = read_package(args.directory)
            manifest, warnings = validate(files)
            emit({"valid": True, "appId": manifest["id"], "files": list(files), "warnings": warnings}, args.json)
            return 0
        if not args.host:
            raise ValueError("This command needs --host with your Umbrel's IP address or hostname.")
        # Without --identity, the dedicated key the desktop or Connect-Umbrel.ps1 created is used automatically.
        connection = SSHConnection(args.host, args.user, args.ssh_port, args.identity or default_identity(args.host), args.data_dir)
        if args.ask_sudo_password:
            connection.sudo_password = getpass.getpass("Umbrel sudo password (not saved): ")
        if args.command in ("doctor", "list"):
            emit(connection.request(args.command), args.json)
            return 0
        if args.command == "logs":
            emit(connection.request("logs", appId=app_id(args.app_id)), args.json)
            return 0
        if args.command == "retrieve":
            if args.directory.exists() and any(args.directory.iterdir()):
                raise ValueError("Retrieve needs an empty destination to protect your local edits.")
            result = connection.request("retrieve", appId=app_id(args.app_id))
            state = {k: result[k] for k in ("baseline", "origin", "images", "appId")}
            state["connection"] = connection.fingerprint
            write_package(args.directory, result["files"], state)
            emit({"directory": str(args.directory.resolve()), "appId": result["appId"],
                  "version": result["manifest"].get("version"), "origin": result["origin"], "images": result["images"]}, args.json)
            return 0
        files, state = read_package(args.directory)
        manifest, warnings = validate(files)
        identifier = manifest["id"]
        if state.get("appId", identifier) != identifier:
            raise ValueError("Don't rename the ID of a retrieved package. Create a new package for a separate installation.")
        if state.get("connection", connection.fingerprint) != connection.fingerprint:
            raise ValueError("This package was retrieved from another connection. Retrieve from this server before applying.")
        if args.command == "diff":
            current = connection.request("retrieve", appId=identifier)
            emit(diff(current["files"], files) or "No YAML changes.", args.json)
            return 0
        if args.dry_run:
            apps = connection.request("list")
            existing = next((a for a in apps if a["id"] == identifier), None)
            current = connection.request("retrieve", appId=identifier) if existing else None
            changed = [n for n, e in files.items() if not current or e != current["files"].get(n)]
            emit({"action": "apply" if existing else "install", "appId": identifier,
                  "changedFiles": changed, "pull": args.pull, "warnings": warnings,
                  "stale": bool(current and state.get("baseline") != current["baseline"]),
                  "note": "Read-only plan; server Compose validation occurs during push."}, args.json)
            return 0
        for warning in warnings:
            print(f"Notice: {warning}", file=sys.stderr)
        print(f"Applying {identifier}; image downloads can take a few minutes…", file=sys.stderr)
        result = connection.request("push", appId=identifier, files=files, baseline=state.get("baseline"), pull=args.pull)
        # Keep local source untouched: Umbrel may reformat and patch its installed copy.
        metadata = {"appId": identifier, "connection": connection.fingerprint, "baseline": result["baseline"],
                    "origin": result["origin"], "images": result["images"],
                    "modes": {n: e.get("mode", 0o644) for n, e in files.items()}}
        (args.directory / ".umbrel-push.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        emit({"appId": identifier, "version": result["manifest"]["version"], "dashboard": f"http://{args.host}/",
              "origin": result["origin"], "images": result["images"], "backup": result.get("backup")}, args.json)
        return 0
    except (ValueError, RuntimeError, OSError) as exc:
        if args.json:
            emit({"error": str(exc)}, True)
        else:
            print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
