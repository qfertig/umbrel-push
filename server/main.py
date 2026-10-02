"""Local server for the web UI: python -m server.main [--demo] [--port 8765] [--no-browser]

Binds to 127.0.0.1 only. Every /api request needs the per-launch token, the Host header must be this
server, and a cross-site Origin is refused, so a web page in another tab cannot drive an authorized Umbrel.
"""
from __future__ import annotations

import argparse
import html
import json
import mimetypes
import os
import re
import secrets
import sys
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import editor
from .api import Service
from .editor import PackageError
from .errors import ApiError

DIST = Path(__file__).resolve().parents[1] / "web" / "dist"
TOKEN_HEADER = "X-Umbrel-Push-Token"
# A package can be up to 8 MiB of YAML plus an embedded icon, sent as JSON; the Umbrel-side worker allows 12 MiB
MAX_BODY = 14 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = "UmbrelPushLocal"
    sys_version = ""

    # -- plumbing
    @property
    def service(self) -> Service:
        return self.server.service

    def log_message(self, format, *args):  # keep the terminal quiet; errors go through ApiError
        return

    def allowed_hosts(self):
        port = self.server.server_address[1]
        return {f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}"}

    def host_ok(self) -> bool:
        if self.server.behind_proxy:  # the proxy decides which names reach this server; origin_ok still pins same-origin
            return bool(self.headers.get("Host"))
        return (self.headers.get("Host") or "") in self.allowed_hosts()

    def origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        if self.server.behind_proxy:
            return urlsplit(origin).netloc == (self.headers.get("Host") or "")
        return urlsplit(origin).netloc in self.allowed_hosts()

    def token_ok(self) -> bool:
        supplied = self.headers.get(TOKEN_HEADER) or ""
        return secrets.compare_digest(supplied, self.server.token)

    def send_json(self, status: int, body) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "Request is too large.", "too_large")
        if length == 0:
            return {}
        try:
            value = json.loads(self.rfile.read(length))
        except ValueError as exc:
            raise ApiError(400, "Request body is not valid JSON.", "invalid") from exc
        if not isinstance(value, dict):
            raise ApiError(400, "Request body must be a JSON object.", "invalid")
        return value

    # -- routing
    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def dispatch(self, method: str):
        path = unquote(urlsplit(self.path).path)
        if not self.host_ok():
            return self.send_json(HTTPStatus.FORBIDDEN, {"error": "Unexpected Host header.", "code": "host"})
        if not path.startswith("/api/"):
            if method != "GET":
                return self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Not allowed.", "code": "method"})
            return self.serve_static(path)
        if not self.origin_ok():
            return self.send_json(HTTPStatus.FORBIDDEN, {"error": "Cross-site requests are refused.", "code": "origin"})
        if not self.token_ok():
            return self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Missing or wrong session token. Reopen the link the server printed.", "code": "token"})
        try:
            self.send_json(HTTPStatus.OK, self.route(method, path))
        except ApiError as exc:
            self.send_json(exc.status, {"error": exc.message, "code": exc.code})
        except PackageError as exc:  # the core's own wording for a bad package or setting
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc), "code": "invalid"})
        except Exception as exc:  # an unexpected failure must not leave the browser waiting
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"Unexpected error: {exc}", "code": "internal"})

    def route(self, method: str, path: str):
        service = self.service
        if method == "GET" and path == "/api/state":
            return service.state()
        if method == "GET" and path == "/api/apps":
            return service.apps()
        if method == "GET" and path == "/api/usage":
            return service.usage()
        if method == "GET" and path == "/api/storage":
            refresh = parse_qs(urlsplit(self.path).query).get("refresh", ["0"])[0] == "1"
            return service.storage(refresh)
        match = re.fullmatch(r"/api/apps/([^/]+)/logs", path)
        if method == "GET" and match:
            return service.logs(match.group(1))
        match = re.fullmatch(r"/api/apps/([^/]+)/(start|stop|restart)", path)
        if method == "POST" and match:
            return service.lifecycle(match.group(1), match.group(2))
        match = re.fullmatch(r"/api/apps/([^/]+)/(retrieve|review|ports|push)", path)
        if method == "POST" and match:
            body = self.read_json()
            app_id, name = match.group(1), match.group(2)
            if name == "retrieve":
                return service.retrieve(app_id)
            if name == "review":
                return service.review(app_id, body.get("files"), body.get("baseline"))
            if name == "ports":
                return service.ports(app_id, body.get("files"))
            return service.push(app_id, body.get("files"), body.get("baseline"), bool(body.get("pull")))
        if method == "POST" and path.startswith("/api/package/"):
            return self.package_route(path.removeprefix("/api/package/"), self.read_json())
        if method == "GET" and path == "/api/images/tags":
            return service.image_tags(self.query("image"))
        if method == "GET" and path == "/api/images/search":
            return service.search_images(self.query("q"))
        if method == "POST" and path == "/api/icons/auto":
            return service.automatic_icon(str(self.read_json().get("image") or ""))
        if method == "POST" and path == "/api/icons/embed":
            return editor.embed_icon(self.read_json().get("data"))
        if method == "POST" and path == "/api/connect":
            body = self.read_json()
            return service.connect(str(body.get("host") or ""), str(body.get("user") or "umbrel"), body.get("port") or 22,
                                   str(body.get("password") or ""), bool(body.get("trust")))
        if method == "POST" and path == "/api/disconnect":
            return service.disconnect()
        raise ApiError(404, "No such endpoint.", "not_found")

    def query(self, name: str) -> str:
        return parse_qs(urlsplit(self.path).query).get(name, [""])[0]

    def package_route(self, name: str, body: dict):
        """Operations on a package that need no connection: the browser sends the files and gets new ones back."""
        if name == "settings":
            return editor.read_settings(body.get("files"))
        if name == "settings/write":
            return editor.write_settings(body.get("files"), body.get("settings"))
        if name == "validate":
            return editor.validate(body.get("files"))
        if name == "diff":
            return editor.diff(body.get("before") or {}, body.get("after"))
        if name == "port":
            return editor.replace_port(body.get("files"), body.get("old"), body.get("new"))
        if name == "generate":
            return editor.generate(body)
        raise ApiError(404, "No such endpoint.", "not_found")

    def serve_static(self, path: str):
        root = DIST.resolve()
        if not root.is_dir():
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "The web UI is not built. Run npm run build in web/, or use the Vite dev server.", "code": "no_build"})
        target = (root / path.lstrip("/")).resolve()
        if root not in target.parents and target != root or not target.is_file():
            target = root / "index.html"
        data = target.read_bytes()
        if target.name == "index.html" and self.server.behind_proxy:
            data = data.replace(b"</head>", self.server.page_settings() + b"</head>", 1)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store" if target.name == "index.html" else "max-age=3600")
        self.end_headers()
        self.wfile.write(data)


class PushServer(ThreadingHTTPServer):
    service: Service
    token: str
    behind_proxy = False
    default_host = ""

    def page_settings(self) -> bytes:
        """Meta tags the page reads in proxy mode, where there is no link fragment to carry the token."""
        tags = f'<meta name="umbrel-push-token" content="{html.escape(self.token)}">'
        if self.default_host:
            tags += f'<meta name="umbrel-push-default-host" content="{html.escape(self.default_host)}">'
        return tags.encode("utf-8")


def make_server(port: int = 0, demo: bool = False, token: str | None = None, behind_proxy: bool = False,
                default_host: str = "") -> PushServer:
    server = PushServer(("0.0.0.0" if behind_proxy else "127.0.0.1", port), Handler)
    server.service = Service(demo=demo)
    server.token = token or secrets.token_urlsafe(24)
    server.behind_proxy = behind_proxy
    server.default_host = default_host
    return server


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Umbrel Push local web server")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--demo", action="store_true", help="Serve sample apps; nothing connects to an Umbrel")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--token", help="Use a fixed session token (for the Vite dev server); the default is a random one per launch")
    parser.add_argument("--behind-proxy", action="store_true",
                        help="Listen on all interfaces and hand the token to the page. Only for running as an Umbrel app, "
                             "where Umbrel's login proxy is the only way in")
    parser.add_argument("--default-host", default=os.environ.get("UMBREL_PUSH_DEFAULT_HOST", ""),
                        help="Address to prefill in the Connect dialog (proxy mode)")
    args = parser.parse_args(argv)
    server = make_server(args.port, args.demo, args.token, args.behind_proxy, args.default_host)
    if args.behind_proxy:
        print(f"Umbrel Push is listening on port {server.server_address[1]} behind a proxy.", flush=True)
    else:
        url = f"http://127.0.0.1:{server.server_address[1]}/#token={server.token}"
        print(f"Umbrel Push is running at {url}", flush=True)
        print("Press Ctrl+C to stop.", flush=True)
        if not args.no_browser:
            webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.service.disconnect()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
