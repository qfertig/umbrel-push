# Umbrel Push

Edit one installed app on your Umbrel, check exactly what will change, and push it, all from a web page that runs on your own computer. Change an image tag, a port, a volume or an environment variable without opening a terminal or rewriting the whole app.

Umbrel Push is an independent project. It is not made, endorsed or supported by Umbrel.

## What it does

- Lists your installed apps with state, memory and disk use, and starts, stops and restarts them.
- Opens an installed app's package in a settings form or a YAML editor. Both stay in sync.
- Lists the versions Docker Hub has for an app's image, newest first, so you can move to a newer tag in two clicks.
- Shows a diff against the installed copy before anything changes. Edits keep your comments, quoting and layout, so the diff shows only what you changed.
- Checks the ports you ask for against what is already in use, with suggestions.
- Pushes the change, saving a backup of the configuration first and restarting the app. It can pull newer images first.
- Creates a new app from a Docker image.

## What you need

- An Umbrel you can reach over SSH, with your Umbrel password. The password is used for `sudo` and for the first-time key setup. It stays in the server's memory until you disconnect and is never written to disk.
- Python 3.11 or newer and Node 20 or newer on the computer you run this on.
- OpenSSH on that computer (it is built into current Windows, macOS and Linux).

## Run it

Windows:

```powershell
.\Start-UmbrelPush.ps1
```

macOS and Linux:

```bash
./start-umbrel-push.sh
```

The first run installs two Python packages and builds the interface, which takes a minute. After that it starts straight away and opens your browser. Add `--demo` to try it with sample apps and no Umbrel. `--port` changes the port (default 8765), and `--no-browser` prints the link instead of opening it.

On first connect you enter your Umbrel's address and password. Umbrel Push creates a dedicated SSH key for that Umbrel, asks you to confirm the host key, and authorizes the key. After that it only needs the password again for `sudo` actions.

## Run it on your Umbrel instead

This repository is also an Umbrel community app store, so Umbrel Push can run on the Umbrel itself and be opened from any device, including a phone.

1. On your Umbrel, open the App Store, choose the three-dot menu, then Community App Stores, and add this repository's URL.
2. Install Umbrel Push from that store. Umbrel's own login protects it.
3. Open it and connect. The address is prefilled with the Umbrel itself; enter your Umbrel password once.

The container image is built by GitHub Actions (`.github/workflows/image.yml`) and published to `ghcr.io`. The package has to be set to public once, in the package's settings on GitHub, or Umbrel cannot pull it.

In this mode the server listens on all interfaces inside the container and gives the page its token directly. That is only safe because Umbrel's login proxy is the only way to reach it. Do not publish its port.

## Things worth knowing

- **Store apps can be overwritten.** If you edit an app that came from the Umbrel App Store or a community store, a later store update may replace your edit. The editor says so at the top.
- **Pushing a newer image can migrate data.** Restoring the saved configuration does not undo a data migration. The push confirmation says so when you pull images.
- **Only apps you touch are touched.** Reading and listing apps changes nothing. Start, stop, restart and push each ask first where they can interrupt an app.
- **Images pinned by digest** (`repo:tag@sha256:...`) show as `tag@sha256:...` in the tag box. Picking a version from the list replaces the whole tag, which drops the digest.

## Security

The server listens on `127.0.0.1` only. Every request needs a token that is new on each launch and travels in the link's fragment. Requests with a foreign Host header or a cross-site Origin are refused, so another web page in your browser cannot drive a connected Umbrel.

## Develop

```bash
python -m server.main --demo --no-browser --token dev
cd web && npm run dev          # then open http://localhost:5173/#token=dev
```

```bash
python -m unittest discover -s tests     # core and server
cd web && npm test                       # interface
cd web && npm run build                  # type-check and build
```

The Python core (`umbrel_push/`) handles SSH, host keys, package files and settings, and has a small command-line interface (`python -m umbrel_push --help`). `server/` is the local HTTP server. `web/` is the React and Tailwind interface.

## Not done yet

- Open and save a package as a file on disk.
- Keyboard shortcuts and a light theme (dark only for now).
- Removing an app. Uninstall from Umbrel's own interface.

## Licence

PolyForm Noncommercial 1.0.0, because the interface adapts parts of the umbrelOS web interface, which uses the same licence. You can use it at home and share it for free. You cannot sell it. See `LICENSE` and `NOTICE`.

Umbrel's logo, wordmark, dock icons and wallpapers are not part of this project and are not licensed by it. The wallpaper and icon here are original. The Inter typeface is used under the SIL Open Font License.
