# Server mode (Docker)

The dashboard (page server + engine + the Claude Code sessions) can run in a Docker container on a server. You reach
it from a browser, a phone or the Electron app ("Connect to a server…"), through your own HTTPS reverse proxy.

Inside the container nothing changes for the sessions: they are real Claude Code processes, using the Claude
subscription you log in with, working on the repositories cloned into the workspace.

## What runs where

| Port | What | Reachable from |
| --- | --- | --- |
| 4749 | The **gate**: login page, master password, approved devices, then the whole dashboard | your reverse proxy only |
| 4747 | The page server without login (used by `node dash.mjs` inside the container) | inside the container only |
| 4748 | The engine (sessions) | inside the container only |

Only 4749 is published. **Never publish 4747 or 4748**: they have no login.

The image sets `DASH_MODE=server`, `DASH_DIR=/data`, `DASH_WORKSPACE=/workspace`, runs as the non-root user `node`
(Claude Code refuses to skip permissions as root) and starts with `node docker/start.mjs`, which keeps the page running;
the engine is a separate process that survives a page restart (`docker exec dash node dash.mjs restart`).

## Build and run

```sh
git clone <this repository> claude-dashboard && cd claude-dashboard
mkdir workspace                               # your repositories go here (owned by your user, uid 1000)
echo 'DASH_PASSWORD=a-long-random-password' > .env
docker compose up -d --build
docker logs -f dash
```

Without compose:

```sh
docker build -t claude-dashboard .
docker run -d --name dash --restart unless-stopped \
  -p 127.0.0.1:4749:4749 \
  -e DASH_PASSWORD=a-long-random-password \
  -v dash-data:/data -v claude-login:/home/node/.claude \
  -v "$PWD/workspace:/workspace" -v ~/.ssh:/home/node/.ssh:ro \
  claude-dashboard
```

## Volumes

| Path in the container | Contents |
| --- | --- |
| `/data` | the dashboard data: sessions and their panels, options, access (password hash, devices), `gitconfig` (git identity), `ssh/known_hosts` |
| `/home/node/.claude` | Claude Code: login (`.credentials.json`), settings, `CLAUDE.md`, skills, conversation transcripts (needed to resume sessions) |
| `/workspace` | your cloned repositories; the "New session" page proposes its subfolders |
| `/home/node/.ssh` (read-only) | the SSH key used by git; hosts seen for the first time are accepted and remembered in `/data/ssh/known_hosts` |

The bind-mounted folders must be readable (and `workspace` writable) by uid 1000, the `node` user of the image. ssh
refuses a private key readable by others: keep `chmod 600` on it.

## First login of Claude Code

Once, after the first start:

```sh
docker exec -it dash claude auth login
```

It prints a URL: open it in your browser, log in with your Claude account, paste the code back. The login lives in
the `claude-login` volume and survives rebuilds. `claude` in the container is the CLI shipped with the Agent SDK, the
same version the sessions use.

Git identity for the commits made by the sessions:

```sh
docker exec dash git config --global user.name "Your Name"
docker exec dash git config --global user.email you@example.com
```

## Password

`DASH_PASSWORD` sets the master password at the first start, only if none is set yet: it never overwrites an existing
one. Afterwards change it from the page (⚙ Options → 🔒 Remote access, the current password is asked); changing it
logs every device out. Optional `DASH_HOSTS` (comma separated host names, e.g. `dash.example.com`): the gate then
answers only to these names (Host header). To reset a
forgotten password, remove the password from `/data/access.json` (or the whole file, which also forgets the devices)
and restart the container with a new `DASH_PASSWORD`.

## Approving devices

Logging in with the password is not enough: each new device (browser, phone, Electron app) then waits to be approved.
Its waiting screen shows a short code, e.g. `K7Q-2M`.

```sh
docker exec dash node dash.mjs devices                    # list: code, name, IP, date, state
docker exec dash node dash.mjs devices approve K7Q-2M     # let it in
docker exec dash node dash.mjs devices revoke K7Q-2M      # log it out for good
```

Once a device is approved, it can approve the next ones from ⚙ Options → 🔒 Remote access.

## Cloning repositories into the workspace

From the host (`./workspace` is mounted) or inside the container, which uses the mounted SSH key:

```sh
docker exec dash git clone git@gitlab.example.com:team/project.git /workspace/project
```

Then "New session" in the page: the folder defaults to `/workspace`, its repositories are proposed. Worktrees created
by the dashboard go next to the repository, in `/workspace` too.

## Reverse proxy

The proxy terminates HTTPS and forwards to port 4749, keeping the original `Host` header (the gate checks that the
`Origin` of every POST matches it). The page uses **Server-Sent Events** (`/api/events`, long-lived responses): the
proxy must not buffer responses and must not cut idle connections after a minute.

HTTPS is required in practice: the login cookie is `Secure`, browsers do not keep it over plain http (except on
localhost).

### Traefik (labels)

In `docker-compose.yml`, remove `ports`, join Traefik's network and add:

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.dash.rule=Host(`dash.example.com`)
      - traefik.http.routers.dash.entrypoints=websecure
      - traefik.http.routers.dash.tls.certresolver=letsencrypt
      - traefik.http.services.dash.loadbalancer.server.port=4749
```

Traefik streams SSE without buffering by default.

### Caddy

```
dash.example.com {
    reverse_proxy 127.0.0.1:4749 {
        flush_interval -1
    }
}
```

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name dash.example.com;
    # ssl_certificate ... ; ssl_certificate_key ... ;

    client_max_body_size 50m;            # attached files and photos

    location / {
        proxy_pass http://127.0.0.1:4749;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        # Server-Sent Events: no buffering, long-lived responses
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
}
```

## Connecting the Electron app

In the app's tray icon menu: **Connect to a server…**, enter `https://dash.example.com`. The app then stops using the
local dashboard (it does not start the local page and engine), shows the server in its window, where you log in and
get your device approved like any browser. The tray icon colour, the taskbar badge and the Windows notifications follow
the server's sessions (polled with the login cookie of the window). The actions on your computer (Windows explorer,
open with the default app, folder picker) are disabled: the files are on the server.

**Back to local mode** in the same menu returns to the dashboard of the PC. The server address is kept in
`~/.claude-dashboard/app.json`.

## Security notes

- **The gate is the only door.** Publish 4749 only, behind HTTPS; never 4747 or 4748, which have no login. The
  compose file publishes 4749 on 127.0.0.1 only: a proxy on another machine needs `"4749:4749"` plus a firewall.
- **Treat dashboard access as root on your repositories.** The sessions run any command Claude Code decides to run
  (or that you allow), inside the container, with your SSH key and your Claude subscription. Anyone with an approved
  device can read and push to every repository the key can reach.
- Use a long master password; 5 failures from an IP block it 15 minutes, each new block of the same IP lasts twice
  as long (24 hours at most). The proxy must pass the client IP in `X-Forwarded-For` (the dashboard reads the last
  value, the one your proxy sets), otherwise every attempt seems to come from the proxy.
- Prefer a deploy key or a dedicated SSH key, limited to the repositories the sessions need, to your personal key.
- Revoke devices you no longer use (`node dash.mjs devices revoke <code>`); changing the password logs everyone out.
- Desktop actions (explorer, VS Code, terminals for `/login` and MCP authentication) are refused in server mode:
  authenticate with `docker exec -it dash claude ...` instead.
