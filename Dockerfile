# Umbrel Push as a container, for running it as an app on an Umbrel.
# Build:  docker build -t umbrel-push .
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.13-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-client gosu \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "PyYAML>=6.0.2,<7" "ruamel.yaml>=0.18,<0.19"
# SSH needs a passwd entry for the user it runs as. Umbrel's own user is 1000, so the data folder matches.
RUN useradd --uid 1000 --create-home --home-dir /data push
WORKDIR /app
COPY umbrel_push umbrel_push
COPY server server
COPY --from=web /web/dist web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV HOME=/data
EXPOSE 8765
# Starts as root only to fix the data folder's owner, then runs the server as user 1000 (see the script).
ENTRYPOINT ["docker-entrypoint.sh"]
# Only ever reachable through Umbrel's login proxy. Do not publish this port to the network.
CMD ["python", "-m", "server.main", "--behind-proxy", "--port", "8765"]
