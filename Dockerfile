# Claude dashboard, server mode (docs/server.md): the page, the engine and the Claude Code sessions in one container.
# Only port 4749 (the gate: login + approved devices) is meant to be reached, behind your own HTTPS reverse proxy.
FROM node:24-bookworm-slim

# git and ssh for the repositories, ripgrep for the text search of the explorer, tini as PID 1 (reaps the detached
# engine and the session processes)
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ripgrep ca-certificates tini procps less \
 && rm -rf /var/lib/apt/lists/*

# Electron is a dependency (desktop app) but is never used here: its binary is not downloaded
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .

# - `claude` on the PATH: the native Claude Code CLI shipped with the Agent SDK (package of this platform, glibc)
# - repositories of the workspace may belong to another uid (bind mount): git must not refuse them
# - ~/.ssh is mounted read-only: hosts seen for the first time are accepted and remembered in the data volume
RUN cli="$(ls -d /app/node_modules/@anthropic-ai/claude-agent-sdk-linux-*/claude | grep -v musl | head -n 1)" \
 && test -x "$cli" \
 && ln -s "$cli" /usr/local/bin/claude \
 && git config --system --add safe.directory '*' \
 && printf 'Host *\n    StrictHostKeyChecking accept-new\n    UserKnownHostsFile /data/ssh/known_hosts ~/.ssh/known_hosts\n' > /etc/ssh/ssh_config.d/dash.conf \
 && mkdir -p /data/ssh /workspace /home/node/.claude /home/node/.ssh \
 && chown -R node:node /data /workspace /home/node

# CLAUDE_CONFIG_DIR: Claude Code login and settings (.credentials.json, .claude.json) in one folder, kept in a volume.
# GIT_CONFIG_GLOBAL: git identity (git config --global ...) kept in the data volume.
ENV DASH_MODE=server \
    DASH_DIR=/data \
    DASH_WORKSPACE=/workspace \
    DASH_RG=/usr/bin/rg \
    CLAUDE_CONFIG_DIR=/home/node/.claude \
    GIT_CONFIG_GLOBAL=/data/gitconfig

# Claude Code refuses to skip permissions as root
USER node
VOLUME ["/data", "/home/node/.claude", "/workspace"]
EXPOSE 4749

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4747/api/ping').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["node", "docker/start.mjs"]
