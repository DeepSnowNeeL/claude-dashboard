// Background shell (Bash run_in_background, Monitor): window with its output.
import { formatWhen, shortDuration } from '../../core/dom.js';
import { current } from '../../core/state.js';
import { stopShell, readShellOutput } from '../../services/sessions.js';
import { t } from '../../i18n/index.js';

/** Output of a background shell, reread every 2 s while it runs; "Stop" kills it (stopTask). */
export async function openShell(key) {
  document.querySelector('.modal-backdrop')?.remove();
  const slug = current();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal shell-view" role="dialog"><button class="close-x" title="${t('conversation.shell.close')}">×</button>
    <h3>🐚 <span class="sh-title"></span></h3><div class="m sh-state"></div><code class="sh-cmd"></code><pre class="code sh-output">…</pre>
    <div class="bar"><span class="m sh-file"></span><button class="btn stop" hidden>${t('conversation.shell.stop')}</button></div></div>`;
  let timer = null;
  const close = () => { clearTimeout(timer); backdrop.remove(); };
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  backdrop.querySelector('.close-x').onclick = close;
  document.body.append(backdrop);
  const stop = backdrop.querySelector('.stop');
  stop.onclick = () => stopShell(slug, key).catch(err => alert(err.message));
  const states = ['working', 'completed', 'failed', 'stopped'];
  const read = async () => {
    if (!backdrop.isConnected) return;
    let r;
    try { r = await readShellOutput(slug, key); } catch (e) { backdrop.querySelector('.sh-output').textContent = e.message; return; }
    backdrop.querySelector('.sh-title').textContent = r.description || r.command || t('conversation.shell.command');
    const state = states.includes(r.state) ? t(`conversation.shell.states.${r.state}`) : r.state;
    backdrop.querySelector('.sh-state').textContent = t('conversation.shell.status', { state, when: formatWhen(new Date(r.start).toISOString()), duration: shortDuration((r.end || Date.now()) - r.start) });
    backdrop.querySelector('.sh-cmd').textContent = r.command || '';
    const pre = backdrop.querySelector('.sh-output');
    const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
    pre.textContent = r.output || (r.file ? t('conversation.shell.nothingYet') : t('conversation.shell.noOutputYet'));
    if (atBottom) pre.scrollTop = pre.scrollHeight; // follows the end, unless scrolled up to read
    backdrop.querySelector('.sh-file').textContent = r.file || '';
    stop.hidden = r.state !== 'working';
    if (r.state === 'working') timer = setTimeout(read, 2000);
  };
  read();
}
