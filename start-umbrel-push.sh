#!/usr/bin/env sh
# Installs what is missing, builds the interface once, and starts Umbrel Push in your browser.
# Needs Python 3.11 or newer and Node 20 or newer. Pass --demo to try it without an Umbrel.
set -eu
cd "$(dirname "$0")"

if ! python3 -c 'import yaml, ruamel.yaml' 2>/dev/null; then
    echo 'Installing Python packages...'
    python3 -m pip install --quiet 'PyYAML>=6.0.2,<7' 'ruamel.yaml>=0.18,<0.19'
fi

if [ ! -f web/dist/index.html ]; then
    echo 'Building the interface (first run only)...'
    (cd web && npm install && npm run build)
fi

exec python3 -m server.main "$@"
