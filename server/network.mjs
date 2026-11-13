// Access from the local network: private addresses, URL to open on the phone, device log.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DASH_DIR, SERVER_MODE } from '../common.mjs';

// --- Access from the local network (`dash.mjs network on|off`) --------------------------------
// No authentication for now: off by default; when on, only private addresses (the home wifi) get through,
// everything else is refused. The engine always stays on 127.0.0.1.

const NETWORK_FILE = path.join(DASH_DIR, 'network.json');
// Server mode: never (the page stays on 127.0.0.1, the gate on port 4749 is the only door)
export const LAN = !SERVER_MODE && (() => { try { return JSON.parse(fs.readFileSync(NETWORK_FILE, 'utf8')).lan === true; } catch { return false; } })();
export const rawIp = a => String(a || '').replace(/^::ffff:/, '');
export const isLocal = a => ['127.0.0.1', '::1'].includes(rawIp(a));
export const isPrivate = a => {
  const ip = rawIp(a);
  return isLocal(ip) || /^(10|127)\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    || /^169\.254\./.test(ip) || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip);
};
/** IPv4 addresses of the machine on the local network (the URL to open on the phone). */
export const lanAddresses = () => Object.entries(os.networkInterfaces())
  .filter(([name]) => !/vEthernet|WSL|Docker|VirtualBox|VMware|Hyper-V/i.test(name)) // virtual adapters: unreachable from the phone
  .flatMap(([, l]) => l).filter(i => i.family === 'IPv4' && !i.internal && isPrivate(i.address)).map(i => i.address);

/** First visit of each remote device, in ~/.claude-dashboard/network.log (to know who connects). */
const seenDevices = new Set();
export function logDevice(req, accepted) {
  const ip = rawIp(req.socket.remoteAddress);
  if (seenDevices.has(ip)) return;
  seenDevices.add(ip);
  const line = `${new Date().toISOString()} ${ip} ${accepted ? 'accepted' : 'refused'} ${req.method} ${req.url} ${req.headers['user-agent'] || ''}\n`;
  fs.appendFile(path.join(path.dirname(NETWORK_FILE), 'network.log'), line, () => {});
}
