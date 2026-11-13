// Input of a session: continuous input queue of the query, immediate or queued sending, "!" commands.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { attachmentBlock } from './attachments.mjs';
import { truncate } from './events.mjs';

/** Input queue: each pushed message becomes a turn of the same session. */
export function inputQueue() {
  const items = [];
  let wake = null, closed = false;
  async function* read() {
    while (!closed) {
      if (!items.length) await new Promise(r => (wake = r));
      while (items.length) yield items.shift();
    }
  }
  return {
    iterable: read(),
    push(content) { // text, or blocks (text + images + documents)
      items.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
      wake?.(); wake = null;
    },
    close() { closed = true; wake?.(); wake = null; },
  };
}

/** Shell of the "!" commands: bash like Claude Code (Git Bash on Windows), otherwise the system shell. */
const BASH_WIN = [process.env.CLAUDE_CODE_GIT_BASH_PATH, 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find(p => p && fs.existsSync(p));
function shell(cmd) {
  if (process.platform !== 'win32') return [process.env.SHELL || '/bin/bash', ['-c', cmd]];
  return BASH_WIN ? [BASH_WIN, ['-c', cmd]] : ['cmd.exe', ['/d', '/s', '/c', cmd]];
}

/** Line citing an attachment in the message sent to Claude (parsed back by extractAttachments). */
const attachmentLine = p => `\n[attachment: ${p.path}]`;

/**
 * Returns `{ dispatch, flushQueue }`; sets the sending methods of the page on `s` (send, runCommand, stopCommand,
 * commandRunning, pushQueue, recallQueue, withdraw). The queue and the outputs of "!" commands are private here.
 */
export function attachInput(ctx) {
  const { s, cwd, input, newId, pushEvent, setStatus, count } = ctx;

  // Queued messages: written during a turn, they leave together at the end of the turn (or after a Stop).
  const queue = [];
  // Outputs of "!" commands: Claude receives them with the next message, as in the terminal.
  let commandsContext = '';
  function dispatch(text, attachments = []) {
    count({ exchanges: 1 });
    // Turn started without a message from the developer (wake-up of an agent or a shell, message from another session): Autopilot
    if (!s.devTurn) ctx.achievements.record('autopilot', ctx.achievements.stat('autonomous'));
    s.devTurn = false;
    ctx.startActivity();
    s.busy = true;
    setStatus('working');
    // Each attachment is cited by its path (Claude can read it again, the page finds it in the history);
    // images and PDFs are also sent as blocks, so that Claude sees them directly.
    const full = commandsContext + text + attachments.map(attachmentLine).join('');
    input.push(attachments.length ? [{ type: 'text', text: full }, ...attachments.flatMap(attachmentBlock)] : full);
    commandsContext = '';
  }
  function flushQueue() {
    if (!queue.length) return;
    const evs = queue.splice(0);
    for (const { toSend, ...ev } of evs) pushEvent({ ...ev, queued: false });
    dispatch(evs.map(ev => ev.text).join('\n\n'), evs.flatMap(ev => ev.toSend || []));
  }

  /**
   * @param {string} text
   * @param {'now'|'end'|'stop'} when during a turn: right away (Claude reads it at the next tool),
   *   at the end of the turn, or stopping the turn
   */
  /** @param {{name, type, path, url}[]} [attachments] attachments already saved on disk by the engine */
  s.send = (text, when = 'now', attachments = []) => {
    const shown = attachments.map(({ name, type, url }) => ({ name, type, url })); // what the page displays
    if (!s.busy || when === 'now') {
      pushEvent({ id: newId(), t: 'user', text, attachments: shown });
      return dispatch(text, attachments);
    }
    // Already a queued message: the new one is added to it (a single block, which will leave at once)
    const last = queue.at(-1);
    if (last) {
      last.text = `${last.text}\n\n${text}`;
      last.attachments = [...(last.attachments || []), ...shown];
      last.toSend = [...(last.toSend || []), ...attachments];
      const { toSend, ...ev } = last;
      pushEvent(ev);
    } else {
      const ev = { id: newId(), t: 'user', text, queued: true, attachments: shown };
      queue.push({ ...ev, toSend: attachments });
      pushEvent(ev);
    }
    if (when === 'stop') s.interrupt();
  };
  /** `!command`: started right away in the folder of the session, live output; Claude will see it with the next message. */
  let commandRunning = null;
  s.runCommand = cmd => {
    const ev = { id: newId(), t: 'command', cmd, output: '', running: true };
    pushEvent(ev);
    const [prog, args] = shell(cmd);
    const p = spawn(prog, args, { cwd, windowsHide: true, env: process.env });
    commandRunning = p;
    let out = '', err = '', planned = null;
    const update = () => { planned = null; pushEvent({ ...ev, output: truncate(out + err, 20_000) }); };
    const read = target => d => { if (target === 'out') out += d; else err += d; planned ??= setTimeout(update, 150); };
    p.stdout.on('data', read('out'));
    p.stderr.on('data', read('err'));
    const finish = code => {
      clearTimeout(planned);
      commandRunning = null;
      pushEvent({ ...ev, output: truncate(out + err, 20_000), running: false, code });
      commandsContext += `<bash-input>${cmd}</bash-input>\n<bash-stdout>${truncate(out, 30_000)}</bash-stdout><bash-stderr>${truncate(err, 10_000)}</bash-stderr>\n\n`;
    };
    p.on('error', e => { err += e.message; finish(-1); });
    p.on('close', code => finish(code));
  };
  s.stopCommand = () => { commandRunning?.kill(); return !!commandRunning; };
  s.commandRunning = () => !!commandRunning;

  /**
   * Messages already queued: "now" sends them during the turn (Claude reads them at the next tool), "stop"
   * interrupts the turn, the queue then leaves at its end (flushQueue). Like Ctrl+Enter / Ctrl+X Ctrl+S in the terminal.
   */
  s.pushQueue = when => {
    if (!queue.length) return false;
    if (when === 'stop' || !s.busy) { if (s.busy) s.interrupt(); else flushQueue(); return true; }
    const evs = queue.splice(0);
    for (const { toSend, ...ev } of evs) pushEvent({ ...ev, queued: false });
    const attachments = evs.flatMap(ev => ev.toSend || []);
    const full = evs.map(ev => ev.text).join('\n\n') + attachments.map(attachmentLine).join('');
    count({ exchanges: 1 });
    input.push(attachments.length ? [{ type: 'text', text: full }, ...attachments.flatMap(attachmentBlock)] : full);
    return true;
  };

  /** Up arrow in the page: all queued messages leave it to be edited again (text and attachments). */
  s.recallQueue = () => {
    const evs = queue.splice(0);
    for (const { toSend, ...ev } of evs) pushEvent({ ...ev, queued: false, recalled: true }); // disappears from the feed
    return evs.map(ev => ({ text: ev.text, attachments: ev.toSend || [] }));
  };
  s.withdraw = id => {
    const i = queue.findIndex(ev => ev.id === id);
    if (i < 0) return false;
    const [ev] = queue.splice(i, 1);
    pushEvent({ ...ev, queued: false, withdrawn: true });
    return true;
  };

  return { dispatch, flushQueue };
}
