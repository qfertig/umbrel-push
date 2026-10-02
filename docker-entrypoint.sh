#!/bin/sh
# Docker creates a bind-mounted data folder owned by root, which the server (user 1000) cannot write to.
# Start as root, hand the folder to user 1000, then drop to that user before running the server.
set -e
if [ "$(id -u)" = "0" ]; then
    mkdir -p /data
    chown -R 1000:1000 /data
    exec gosu 1000:1000 "$@"
fi
exec "$@"
