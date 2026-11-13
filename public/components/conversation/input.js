// The input: sending and send commands (buttons and keyboard), attachments, "/" command menu.
// The typed text is never rerendered by an effect; only the send buttons (#actions) are.
import { signal, effect } from '../../core/signals.js';
import { $, esc, toast } from '../../core/dom.js';
import { detail, attachments, view, agents, serverMode } from '../../core/state.js';
import { upload } from '../../core/api.js';
import { send, sendToAgent, interrupt, pushQueue, recallQueue } from '../../services/sessions.js';
import { commandsOf, openAuth } from '../../services/commands.js';
import { readDraft, writeDraft } from '../../services/draft.js';
import { saveInputDraft } from '../cards/decisions.js';
import { openMcp } from '../mcp.js';
import { openUsage } from '../usage-view.js';
import { hasQueued, commandRunning, feedBottom } from './feed.js';
import { t } from '../../i18n/index.js';

// The send buttons also depend on the typed text, which is not a signal: each change is signalled here
const actionsTick = signal(0);
const renderActions = () => actionsTick.update(n => n + 1);

/** The input grows with its text, up to half the height of the conversation; beyond that, it scrolls. */
function fitInput() {
  const z = $('#input'), center = $('#center');
  if (!z || !center) return;
  // Empty: base height (otherwise the help text, long on PC, would make it grow)
  if (!z.value) { z.style.height = ''; z.style.overflowY = ''; return; }
  const max = Math.max(60, Math.floor(center.clientHeight / 2));
  z.style.height = 'auto';
  const wanted = z.scrollHeight + (z.offsetHeight - z.clientHeight); // borders included
  z.style.height = `${Math.min(wanted, max)}px`;
  z.style.overflowY = wanted > max ? 'auto' : 'hidden';
}
addEventListener('resize', fitInput);

// --- Attachments: Ctrl+V (images, copied files) as attachments, drag and drop = path in the text ----

function addAttachments(files) {
  for (const f of files) {
    // A pasted image has no meaningful name: give it a timestamped one
    const file = f.name && f.name !== 'image.png' ? f : new File([f], `capture-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type });
    attachments().push({ id: Math.random().toString(36).slice(2), file, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null });
  }
  attachments.notify();
  renderAttachments();
  renderActions();
}

function renderAttachments() {
  const z = $('#attachments');
  if (!z) return;
  z.innerHTML = attachments().map(p => `<span class="attachment" title="${esc(p.file.name)}">
      ${p.preview ? `<img src="${p.preview}" alt="">` : '<span class="ic">📄</span>'}
      <span class="nm">${esc(p.file.name)}</span>
      <button class="x" data-remove-attachment="${p.id}" title="${t('conversation.input.remove')}">✕</button>
    </span>`).join('');
  z.querySelectorAll('[data-remove-attachment]').forEach(b => b.addEventListener('click', () => {
    const p = attachments().find(x => x.id === b.dataset.removeAttachment);
    if (p?.preview && !p.uploaded) URL.revokeObjectURL(p.preview);
    attachments.set(attachments().filter(x => x !== p));
    renderAttachments();
    renderActions();
  }));
}

/** Drag and drop: the browser does not give the original path; the file is saved and its path inserted. */
async function dropFiles(files) {
  const z = $('#input');
  if (!z || !detail()?.driven) return;
  for (const f of files) {
    try {
      const { path } = await upload(detail().slug, f);
      const link = /\s/.test(path) ? `"${path}"` : path;
      const pos = z.selectionStart ?? z.value.length;
      z.value = `${z.value.slice(0, pos)}${pos && !/\s$/.test(z.value.slice(0, pos)) ? ' ' : ''}${link} ${z.value.slice(pos)}`;
    } catch (e) { alert(`${f.name}: ${e.message}`); }
  }
  saveInputDraft();
  renderActions();
  z.focus();
}

// --- "/" commands: autocompletion of the session's commands and skills, /login and /logout handled here --------

let cmdMenu = { list: [], i: 0 };

async function updateCommandMenu() {
  const z = $('#input'), menu = $('#command-menu');
  if (!z || !menu || !detail()?.driven) return;
  const m = z.value.match(/^\/(\S*)$/); // "/" at the start of the input, before the first space
  if (!m) { menu.hidden = true; return; }
  const q = m[1].toLowerCase();
  const all = await commandsOf(detail().slug);
  if (!$('#input')?.value.startsWith('/')) return;
  const shown = all.filter(c => !q || c.name.toLowerCase().includes(q) || (c.aliases || []).some(a => a.toLowerCase().startsWith(q)))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name));
  cmdMenu = { list: shown, i: Math.min(cmdMenu.i, Math.max(shown.length - 1, 0)) };
  menu.innerHTML = shown.map((c, k) => `<div class="cmd-item ${k === cmdMenu.i ? 'on' : ''}" data-k="${k}">
      <b>/${esc(c.name)}</b>${c.argumentHint ? ` <span class="m">${esc(c.argumentHint)}</span>` : ''}${c.builtin ? '' : c.local ? ` <span class="cmd-type">${t('conversation.input.dashboard')}</span>` : ' <span class="cmd-type">skill</span>'}
      <div class="m">${esc(c.description || '')}</div></div>`).join('') || `<p class="m">${t('conversation.input.noCommand')}</p>`;
  menu.hidden = false;
  menu.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
function pickCommand(k) {
  const c = cmdMenu.list[k];
  if (!c) return;
  const z = $('#input');
  z.value = `/${c.name} `;
  $('#command-menu').hidden = true;
  renderActions();
  z.focus();
  saveInputDraft(); renderActions();
}

async function runCommand(what) {
  const d = detail();
  if (!d?.driven) return;
  if (what === 'stop') {
    if (d.busy || commandRunning()) await interrupt(d.slug).catch(err => alert(err.message));
    return;
  }
  const text = $('#input')?.value.trim() || '';
  // Subagent view: the message goes to it (the main session forwards it), text only
  const agent = viewedAgent();
  if (agent) {
    if (!text || sending) return;
    sending = true;
    try {
      await sendToAgent(d.slug, agent.key, text);
      if (detail()?.slug === d.slug && $('#input').value.trim() === text) {
        $('#input').value = '';
        writeDraft(d.slug, { text: '', sig: readDraft(d.slug).sig });
      }
      renderActions();
      feedBottom(true);
    } catch (e) { alert(e.message); }
    finally { sending = false; }
    return;
  }
  // /login and /logout: login goes through the browser, the dashboard opens it in a terminal
  const auth = text.match(/^\/(login|logout)\s*$/);
  if (auth && serverMode()) return alert(t('conversation.input.authServerMode'));
  if (auth) {
    try { await openAuth(auth[1]); } catch (e) { return alert(e.message); }
    $('#input').value = ''; saveInputDraft(); renderActions();
    return toast(auth[1] === 'login' ? t('conversation.input.loginOpened') : t('conversation.input.logoutOpened'));
  }
  // /mcp: the window of the session's MCP servers (in headless mode, Claude Code does not show it)
  if (/^\/mcp\s*$/.test(text)) {
    $('#input').value = ''; saveInputDraft(); renderActions();
    return openMcp(d);
  }
  // /usage: limits, session consumption and the dashboard's share (headless Claude Code does not show it)
  if (/^\/(usage|cost)\s*$/.test(text)) {
    $('#input').value = ''; saveInputDraft(); renderActions();
    return openUsage(d);
  }
  // Empty input and queued messages: Ctrl+Enter sends them right away, Ctrl+X Ctrl+S stops and sends them
  if (!text && !attachments().length) {
    if (['now', 'stop-send'].includes(what) && hasQueued()) {
      await pushQueue(d.slug, what === 'stop-send' ? 'stop' : 'now').catch(err => alert(err.message));
      feedBottom(true);
    }
    return;
  }
  // Enter pressed several times before the server answers: a single send
  if (sending) return;
  sending = true;
  const when = !d.busy || (text.startsWith('!') && !attachments().length) ? 'now' : what === 'stop-send' ? 'stop' : what;
  try {
    const sent = await Promise.all(attachments().map(p => p.uploaded || upload(d.slug, p.file)));
    // /tracker: the dashboard plugin skill is called /dashboard:tracker for Claude Code
    const body = text.replace(/^\/(tracker|suivi)(?=\s|$)/, '/dashboard:tracker'); // /suivi: its former French name
    await send(d.slug, { text: body, when, attachments: sent });
    attachments.set([]);
    renderAttachments();
    // What was typed during the send stays in the input
    if (detail()?.slug === d.slug && $('#input').value.trim() === text) {
      $('#input').value = '';
      writeDraft(d.slug, { text: '', sig: readDraft(d.slug).sig });
    }
    renderActions();
    feedBottom(true); // your send sticks back to the bottom right away, without waiting for the server echo
  } catch (e) { alert(e.message); }
  finally { sending = false; }
}
let sending = false;
const viewedAgent = () => (view() && agents().get(view())) || null;

function paintActions() {
  fitInput(); // every change of the text goes through here (typing, draft, shortcut, send)
  const zone = $('#actions');
  if (!zone || !detail()) return;
  if (!detail().driven) { zone.innerHTML = `<button class="btn on large" id="send">${t('conversation.input.copy')}</button>`; return attachCopy(); }
  const raw = $('#input')?.value.trim() || '';
  const hasText = !!raw || attachments().length > 0;
  const k = key => `<kbd>${key}</kbd>`;
  const enter = t('conversation.input.keys.enter'), escKey = t('conversation.input.keys.esc'), ctrlEnter = t('conversation.input.keys.ctrlEnter');
  const agent = viewedAgent();
  const z = $('#input');
  if (z) { z.dataset.help ??= z.placeholder; z.placeholder = agent ? t('conversation.input.toAgent', { name: agent.description || agent.type }) : z.dataset.help; }
  if (agent) {
    $('#input')?.classList.remove('mode-cmd');
    zone.innerHTML = `<button class="btn on large" data-cmd="end" ${raw ? '' : 'disabled'} title="${t('conversation.input.sendToAgentTitle')}">${t('conversation.input.sendToAgent')} ${k(enter)}</button>`;
    return zone.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => runCommand(b.dataset.cmd)));
  }
  // Command mode: "!command" runs right away in a shell, as in the terminal.
  $('#input')?.classList.toggle('mode-cmd', raw.startsWith('!'));
  if (raw.startsWith('!')) {
    zone.innerHTML = `${commandRunning() ? `<button class="btn stop" data-cmd="stop">${t('conversation.input.stopCommand')} ${k(escKey)}</button>` : ''}
      <button class="btn on large cmd" data-cmd="end" title="${t('conversation.input.runTitle')}">${t('conversation.input.run')} ${k(enter)}</button>`;
  } else zone.innerHTML = !detail().busy && commandRunning()
    ? `<button class="btn stop" data-cmd="stop">${t('conversation.input.stopCommand')} ${k(escKey)}</button>
       <button class="btn on large" data-cmd="end" ${hasText ? '' : 'disabled'}>${t('conversation.input.send')} ${k(enter)}</button>`
    : !detail().busy
    ? `<button class="btn on large" data-cmd="end" ${hasText ? '' : 'disabled'}>${t('conversation.input.send')} ${k(enter)}</button>`
    : `<button class="btn stop" data-cmd="stop" title="${t('conversation.input.stopTitle')}">${t('conversation.input.stop')} ${k(escKey)}</button>
       ${hasText ? `<button class="btn" data-cmd="stop-send" title="${t('conversation.input.stopSendTitle')}">${t('conversation.input.stopSend')} ${k('Ctrl+X Ctrl+S')}</button>
       <button class="btn" data-cmd="now" title="${t('conversation.input.sendNowTitle')}">${t('conversation.input.sendNow')} ${k(ctrlEnter)}</button>
       <button class="btn on large" data-cmd="end" title="${t('conversation.input.queueTitle')}">${t('conversation.input.queue')} ${k(enter)}</button>`
       : hasQueued() ? `<button class="btn" data-cmd="stop-send" title="${t('conversation.input.stopSendQueueTitle')}">${t('conversation.input.stopSendQueue')} ${k('Ctrl+X Ctrl+S')}</button>
       <button class="btn on" data-cmd="now" title="${t('conversation.input.sendQueueNowTitle')}">${t('conversation.input.sendQueueNow')} ${k(ctrlEnter)}</button>` : ''}`;
  zone.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => runCommand(b.dataset.cmd)));
}

/** Terminal session: the answer is copied for the console. */
function attachCopy() {
  $('#send').addEventListener('click', async () => {
    const text = $('#input').value.trim();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch { $('#input').select(); document.execCommand('copy'); }
    $('#send').textContent = t('conversation.input.copied');
    setTimeout(() => ($('#send').textContent = t('conversation.input.copy')), 1500);
  });
}

let chordX = 0; // time of the Ctrl+X waiting for its Ctrl+S

// --- Send commands: buttons depending on the situation, and the same on the keyboard -------------------
//   Enter: sends; during a turn, queues (sent at the end of the turn)
//   Ctrl+Enter: during a turn, sends right away (Claude reads it at the next tool)
//   Ctrl+X then Ctrl+S: stops the turn and sends
//   Esc, or Ctrl+C with no text selected: stops the turn
function onKey(e) {
  if (!detail()?.driven || !$('#input')) return;
  const z = $('#input');
  const inZone = document.activeElement === z;
  const selection = inZone ? z.selectionStart !== z.selectionEnd : !!String(getSelection()).length;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape' && !document.querySelector('.full')) { if (detail().busy || commandRunning()) { e.preventDefault(); runCommand('stop'); } return; }
  if (ctrl && e.key.toLowerCase() === 'c' && !selection && (detail().busy || commandRunning())) { e.preventDefault(); runCommand('stop'); return; }
  if (ctrl && e.key.toLowerCase() === 'x' && !selection) { e.preventDefault(); chordX = Date.now(); return; }
  if (ctrl && e.key.toLowerCase() === 's' && Date.now() - chordX < 1500) { e.preventDefault(); chordX = 0; runCommand('stop-send'); return; }
  if (inZone && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); runCommand(ctrl ? 'now' : 'end'); }
  // Up arrow, cursor at the very start: queued messages come back into the input to be edited
  if (inZone && e.key === 'ArrowUp' && !e.shiftKey && !ctrl && z.selectionStart === 0 && z.selectionEnd === 0
      && hasQueued()) { e.preventDefault(); recallMessages(); }
}

async function recallMessages() {
  const z = $('#input');
  let messages = [];
  try { ({ messages } = await recallQueue(detail().slug)); } catch (err) { return alert(err.message); }
  if (!messages.length) return;
  const recalled = messages.map(m => m.text).filter(Boolean).join('\n\n');
  z.value = recalled + (z.value.trim() ? `\n\n${z.value}` : '');
  // Attachments already saved: they will go again as they are, without uploading the file again
  for (const p of messages.flatMap(m => m.attachments)) {
    attachments().push({ id: Math.random().toString(36).slice(2), file: { name: p.name }, uploaded: p, preview: p.type?.startsWith('image/') ? p.url : null });
  }
  attachments.notify();
  renderAttachments();
  saveInputDraft();
  renderActions();
  z.setSelectionRange(recalled.length, recalled.length);
}

/** Wires the input the center has just rendered (#input, "/" menu, attachments, shortcuts). */
export function attachInput(d) {
  const driven = d.driven;
  $('#input').addEventListener('input', () => { saveInputDraft(); renderActions(); updateCommandMenu(); });
  // "/" command menu open: it takes the arrows, Tab, Enter and Esc before the send shortcuts
  $('#input').addEventListener('keydown', e => {
    const menu = $('#command-menu');
    if (!menu || menu.hidden || !cmdMenu.list.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { cmdMenu.i = (cmdMenu.i + (e.key === 'ArrowDown' ? 1 : -1) + cmdMenu.list.length) % cmdMenu.list.length; updateCommandMenu(); }
    else if (e.key === 'Enter' && !e.shiftKey && $('#input').value.trim() === `/${cmdMenu.list[cmdMenu.i].name}`) { menu.hidden = true; return; } // command already complete: Enter sends it
    else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) pickCommand(cmdMenu.i);
    else if (e.key === 'Escape') menu.hidden = true;
    else return;
    e.preventDefault(); e.stopPropagation();
  });
  $('#command-menu')?.addEventListener('mousedown', e => { const it = e.target.closest('[data-k]'); if (it) { e.preventDefault(); pickCommand(+it.dataset.k); } });
  attachments.set([]);
  if (driven) {
    // 📎 and 📷 (mobile): as in the Claude app, the chosen file or the photo taken becomes an attachment
    for (const [button, field] of [['#attach', '#attach-file'], ['#take-photo', '#attach-photo']]) {
      $(button)?.addEventListener('click', () => $(field).click());
      $(field)?.addEventListener('change', e => { addAttachments([...e.target.files]); e.target.value = ''; $('#input').focus(); });
    }
    // Ctrl+V: copied images and files become attachments (pasted text is pasted normally)
    $('#input').addEventListener('paste', e => {
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length) return;
      if (!e.clipboardData.getData('text/plain')) e.preventDefault();
      addAttachments(files);
    });
    const center = $('#center');
    center.ondragover = e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); center.classList.add('drop-target'); } };
    center.ondragleave = e => { if (!center.contains(e.relatedTarget)) center.classList.remove('drop-target'); };
    center.ondrop = e => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      center.classList.remove('drop-target');
      dropFiles([...e.dataTransfer.files]);
    };
  }
  document.querySelectorAll('[data-shortcut]').forEach(b => b.addEventListener('click', () => {
    const z = $('#input');
    z.value = z.value.trim() ? `${z.value.replace(/\s+$/, '')}\n${b.dataset.shortcut}` : b.dataset.shortcut;
    saveInputDraft();
    renderActions();
    z.focus();
  }));
  renderActions();
}

/**
 * Mounts the input on `el` (#center, which stays in place): send keyboard shortcuts, send buttons by effect,
 * recall of queued messages ("edit" of a queued message).
 */
export function mountInput(el) {
  document.addEventListener('keydown', onKey);
  el.addEventListener('recall-queue', () => recallMessages());
  document.addEventListener('input-changed', () => renderActions()); // a decision choice put text in the input
  // Read first: #actions may be missing at this point
  effect(() => { detail(); attachments(); actionsTick(); hasQueued(); commandRunning(); view(); agents(); paintActions(); });
}
