// Entry point of the Docker image (server mode, docs/server.md): keeps the page (server.mjs) running in the
// foreground of the container, its logs on the container output.
// The page starts the engine as a detached process, which outlives it: restarting the page (`node dash.mjs restart`,
// or a crash) does not cut the sessions, and this loop starts the page again. If the page was started by someone
// else (`node dash.mjs ensure` after a restart), the loop only waits for it to stop.
// tini (PID 1) reaps the processes left behind and forwards the stop signal of `docker stop`.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DASH_PORT || 4747);
const wait = ms => new Promise(r => setTimeout(r, ms));

async function pageAlive() {
  try { return (await fetch(`http://127.0.0.1:${PORT}/api/ping`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}

// Hosts accepted by ssh the first time (StrictHostKeyChecking accept-new) are written here: ~/.ssh is read-only
const dataDir = process.env.DASH_DIR || '/data';
fs.mkdirSync(path.join(dataDir, 'ssh'), { recursive: true });

let page = null;
const stop = () => { page?.kill('SIGTERM'); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

for (;;) {
  if (!(await pageAlive())) {
    page = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { cwd: ROOT, stdio: 'inherit' });
    const code = await new Promise(r => page.on('exit', r));
    page = null;
    console.log(`[start] page stopped (code ${code}), starting it again`);
  }
  await wait(2000);
}
