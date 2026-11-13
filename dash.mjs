// Dashboard CLI. Never fails (exit code 0): a session must not be blocked by the dashboard.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DASH_DIR, applyLanguage } from './common.mjs';
import { migrateSession } from './migration.mjs';
import { t } from './public/i18n/index.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

applyLanguage();

const PORT = Number(process.env.DASH_PORT || 4747);
const BASE = `http://localhost:${PORT}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const wait = ms => new Promise(r => setTimeout(r, ms));

async function ping() {
  try {
    const r = await fetch(`${BASE}/api/ping`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensure() {
  if (await ping()) return true;
  spawn(process.execPath, [path.join(HERE, 'server.mjs')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 25; i++) {
    await wait(200);
    if (await ping()) return true;
  }
  return false;
}

async function call(method, slug, body) {
  if (!(await ensure())) throw new Error(t('server.cli.unreachable', { url: BASE }));
  const r = await fetch(`${BASE}/api/sessions/${slug}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const rep = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(rep.error || `HTTP ${r.status}`);
}

const displayName = d => (d.ticket ? `${d.ticket} · ${d.title}` : d.title);

// Backward compatibility: the French command names, flags and status values of the French build (terminal skill,
// scripts, habits) are still accepted
const OLD_COMMANDS = { reseau: 'network', 'restart-moteur': 'restart-engine', deplacer: 'move', statut: 'status' };
const OLD_FLAGS = { '--attendre': '--wait', '--forcer': '--force', '--differe': '--deferred', '--reprendre': '--resume', '--copie': '--copy' };
const OLD_STATUSES = { attend: 'waiting', 'en-cours': 'working', termine: 'done' };

const [rawCmd, ...rawArgs] = process.argv.slice(2);
const cmd = OLD_COMMANDS[rawCmd] || rawCmd;
const args = rawArgs.map(a => OLD_FLAGS[a] || a);
try {
  if (cmd === 'ensure') {
    console.log((await ensure()) ? t('server.cli.ready', { url: BASE }) : t('server.cli.cannotStart'));
  } else if (cmd === 'restart') {
    // The page alone: the sessions live in the engine, nothing is cut
    await fetch(`${BASE}/api/stop`, { method: 'POST' }).catch(() => {});
    for (let i = 0; i < 25 && (await ping()); i++) await wait(200);
    console.log((await ensure()) ? t('server.cli.pageRestarted', { url: BASE }) : t('server.cli.pageCannotRestartWarn'));
  } else if (cmd === 'network') {
    // Opens (on) or closes (off) the page to the local network, to try it from the phone; restarts the page alone
    if (!['on', 'off'].includes(args[0])) throw new Error(t('server.cli.networkUsage'));
    const file = path.join(DASH_DIR, 'network.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ lan: args[0] === 'on' }, null, 2));
    await fetch(`${BASE}/api/stop`, { method: 'POST' }).catch(() => {});
    for (let i = 0; i < 25 && (await ping()); i++) await wait(200);
    if (!(await ensure())) throw new Error(t('server.cli.pageCannotRestart'));
    const { addresses = [] } = await fetch(`${BASE}/api/network`).then(r => r.json()).catch(() => ({}));
    console.log(args[0] === 'off' ? t('server.cli.networkOff', { url: BASE })
      : t('server.cli.networkOn', { addresses: addresses.map(a => `  ${a}`).join('\n') || t('server.cli.noAddress'), port: PORT }));
  } else if (cmd === 'restart-engine') {
    // The engine cuts the sessions: it refuses while a turn, an agent or a command is running.
    // --wait: waits until everything is idle (30 min max); --force: cuts anyway.
    const force = args.includes('--force'), waitIdle = args.includes('--wait');
    if (!(await ensure())) throw new Error(t('server.cli.unreachable', { url: BASE }));
    // --deferred: from a session driven by the page, the engine stops as soon as the turn ends (its own included)
    if (args.includes('--deferred')) {
      const r = await fetch(`${BASE}/api/engine/stop?deferred=1`, { method: 'POST' }).then(x => x.json());
      console.log(t('server.cli.engineDeferred', { running: r.running?.length ? r.running.map(x => x.title || x.slug).join(', ') : '' }));
      process.exit(0);
    }
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`${BASE}/api/engine/stop${force ? '?force=1' : ''}`, { method: 'POST' });
      if (r.ok) break;
      const { running = [] } = await r.json().catch(() => ({}));
      const list = running.map(x => `${x.title || x.slug} (${x.what.join(', ')})`).join(' ; ');
      if (!waitIdle || attempt > 360) throw new Error(t('server.cli.engineBusy', { list }));
      if (attempt === 0) console.log(t('server.cli.waitingFor', { list }));
      await wait(5000);
    }
    await wait(500);
    // The page restarts the engine at the first call it relays to it
    await fetch(`${BASE}/api/sessions`).catch(() => {});
    for (let i = 0; i < 30; i++) { await wait(300); if ((await fetch(`${BASE}/api/ping`).then(r => r.json()).catch(() => ({}))).engine) break; }
    console.log(t('server.cli.engineRestarted'));
  } else if (cmd === 'move') {
    // Attaches a Claude Code session to another folder (started from the wrong project): transcript and
    // subagents copied into the projects folder of the new cwd, cwd rewritten; the old one is kept as .moved.
    const [sessionId, folder] = args.filter(a => !a.startsWith('--'));
    if (!sessionId || !folder || !fs.existsSync(folder)) throw new Error(t('server.cli.moveUsage'));
    const root = path.join(os.homedir(), '.claude', 'projects');
    const source = fs.readdirSync(root).map(d => path.join(root, d)).find(d => fs.existsSync(path.join(d, `${sessionId}.jsonl`)));
    if (!source) throw new Error(t('server.cli.sessionNotFound', { id: sessionId, path: root }));
    const transcript = path.join(source, `${sessionId}.jsonl`);
    if (Date.now() - fs.statSync(transcript).mtimeMs < 60_000 && !args.includes('--force')) {
      throw new Error(t('server.cli.sessionTooRecent'));
    }
    const newDir = path.resolve(folder);
    const target = path.join(root, newDir.replace(/[^a-zA-Z0-9]/g, '-'));
    if (path.resolve(target) === path.resolve(source)) throw new Error(t('server.cli.alreadyAttached'));
    fs.mkdirSync(target, { recursive: true });
    const rewrite = (from, to) => fs.writeFileSync(to, fs.readFileSync(from, 'utf8').split('\n').map(l => {
      if (!l.includes('"cwd"')) return l;
      try { const o = JSON.parse(l); if (typeof o.cwd === 'string') o.cwd = newDir; return JSON.stringify(o); } catch { return l; }
    }).join('\n'));
    rewrite(transcript, path.join(target, `${sessionId}.jsonl`));
    const extra = path.join(source, sessionId); // subagents/, tool-results/
    if (fs.existsSync(extra)) {
      fs.cpSync(extra, path.join(target, sessionId), { recursive: true });
      for (const f of fs.readdirSync(path.join(target, sessionId), { recursive: true })) {
        const p = path.join(target, sessionId, f);
        if (p.endsWith('.jsonl')) rewrite(p, p);
      }
      if (!args.includes('--copy')) fs.renameSync(extra, `${extra}.moved`);
    }
    if (!args.includes('--copy')) fs.renameSync(transcript, `${transcript}.moved`); // --copy: the original stays in place
    console.log(args.includes('--copy') ? t('server.cli.movedCopy', { id: sessionId, path: newDir })
      : t('server.cli.moved', { id: sessionId, path: newDir, old: `${transcript}.moved` }));
    if (args.includes('--resume')) {
      if (!(await ensure())) throw new Error(t('server.cli.unreachable', { url: BASE }));
      const r = await fetch(`${BASE}/api/sessions/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, cwd: newDir, title: path.basename(newDir) }),
      }).then(x => x.json());
      console.log(r.slug ? t('server.cli.resumed', { url: `${BASE}/#${r.slug}` }) : t('server.cli.resumeFailed', { error: r.error }));
    }
  } else if (cmd === 'push') {
    const file = args[0];
    // The terminal skill may still write the French keys of the French build (titre, etape, statut…): converted here
    const data = migrateSession(JSON.parse(fs.readFileSync(file, 'utf8')));
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    await call('POST', data.slug, data);
    console.log(`📋 ${displayName(data)} · ${data.step}${data.statusSummary ? ` · ${data.statusSummary}` : ''} → ${BASE}/#${data.slug}`);
  } else if (cmd === 'status') {
    const [slug, rawStatus, statusSummary] = args;
    const status = OLD_STATUSES[rawStatus] || rawStatus;
    await call('PATCH', slug, { status, statusSummary });
    console.log(`📋 ${slug} · ${status}${statusSummary ? ` · ${statusSummary}` : ''}`);
  } else if (cmd === 'devices') {
    // Devices of the remote access (server mode: approve them from inside the container). Through the page on
    // 127.0.0.1, which trusts the local machine.
    if (!(await ensure())) throw new Error(t('server.cli.unreachable', { url: BASE }));
    const [action, code] = args;
    if (!action) {
      const r = await fetch(`${BASE}/api/access`).then(x => x.json());
      if (r.error) throw new Error(r.error);
      const list = [...(r.devices || [])].sort((a, b) => a.approved - b.approved || String(b.created).localeCompare(String(a.created)));
      if (!list.length) { console.log(t('server.cli.devicesNone')); process.exit(0); }
      console.log(t('server.cli.devicesHeader'));
      for (const a of list) {
        console.log([String(a.code || a.id).padEnd(9), (a.approved ? t('server.cli.deviceApproved') : t('server.cli.devicePending')).padEnd(10),
          String(a.name || '').padEnd(25), String(a.ip || '').padEnd(16), String(a.created || '').slice(0, 16).replace('T', ' ')].join(' '));
      }
      if (list.some(a => !a.approved)) console.log(`
${t('server.cli.devicesHint')}`);
    } else if (['approve', 'revoke'].includes(action) && code) {
      const r = await fetch(`${BASE}/api/access/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const rep = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(rep.error || `HTTP ${r.status}`);
      console.log(t(action === 'approve' ? 'server.cli.deviceApprovedDone' : 'server.cli.deviceRevokedDone', { name: rep.device.name, code: rep.device.code || rep.device.id }));
    } else throw new Error(t('server.cli.devicesUsage'));
  } else if (cmd === 'rm') {
    await call('DELETE', args[0]);
    console.log(t('server.cli.removed', { slug: args[0] }));
  } else {
    console.log(t('server.cli.usage'));
  }
} catch (e) {
  console.log(t('server.cli.failed', { message: e.message }));
}
