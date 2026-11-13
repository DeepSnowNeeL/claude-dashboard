// Rendering of a feed event (message, Claude text, card, command, end of turn, error…) and of a tool line.
// What touches the input goes through DOM events it listens to (input-changed, recall-queue).
import { $, esc, markdown, pathLinks, toast } from '../../core/dom.js';
import { current, detail } from '../../core/state.js';
import { send, release } from '../../services/sessions.js';
import { syncDraft } from '../../services/draft.js';
import { decisionCards, attachDecisions, highlight } from '../cards/decisions.js';
import { questionCard, attachQuestion } from '../cards/question.js';
import { permissionCard, attachPermission } from '../cards/permission.js';
import { agentCard, attachAgent } from '../cards/agent.js';
import { parseSessionMessage, fillSessionMessage } from '../cards/session-message.js';
import { t } from '../../i18n/index.js';

/** Attachments of a message: image thumbnails (click = full size), a link for the others. */
function messageAttachments(attachments) {
  if (!attachments?.length) return '';
  return `<div class="attachments-msg">${attachments.map(p => p.url && p.type?.startsWith('image/')
    ? `<a href="${esc(p.url)}" target="_blank" title="${esc(p.name)}"><img src="${esc(p.url)}" alt="${esc(p.name)}"></a>`
    : `<a class="attachment-doc" ${p.url ? `href="${esc(p.url)}" target="_blank"` : ''}>📄 ${esc(p.name)}</a>`).join('')}</div>`;
}

/** Copies to the clipboard; outside a secure context (wifi over http), through a hidden text area. */
async function copy(text, button) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const z = Object.assign(document.createElement('textarea'), { value: text });
    z.style.cssText = 'position:fixed;opacity:0';
    document.body.append(z); z.select(); document.execCommand('copy'); z.remove();
  }
  button.textContent = '✓';
  setTimeout(() => { button.textContent = '⧉'; }, 1200);
}

/** Element of an event (null if it is not shown); `activeDecisionsId`: id of the decisions still unanswered. */
export function eventHtml(ev, activeDecisionsId) {
  const el = document.createElement('div');
  el.dataset.id = ev.id;
  const peer = ev.t === 'user' && parseSessionMessage(ev.text);
  if (peer) fillSessionMessage(el, ev, peer);
  else if (ev.t === 'user' && ev.fromParent) { el.className = 'msg instruction md'; el.innerHTML = `<div class="m">${t('conversation.event.fromParent')}</div>${markdown(ev.text)}`; }
  else if (ev.t === 'user') {
    if (ev.recalled) { el.hidden = true; return el; } // put back in the input to be edited
    el.className = `msg user md${ev.queued ? ' queued' : ''}${ev.withdrawn ? ' withdrawn' : ''}`;
    el.innerHTML = markdown(ev.text) + messageAttachments(ev.attachments) + (ev.queued ? `<div class="queue-state m">${t('conversation.event.queued')} · <button class="link" data-edit>${t('conversation.event.edit')}</button></div>`
      : ev.withdrawn ? `<div class="queue-state m">${t('conversation.event.withdrawn')}</div>` : '');
    // Like the up arrow: the message leaves the queue and comes back into the input
    el.querySelector('[data-edit]')?.addEventListener('click', e => { e.currentTarget.dispatchEvent(new CustomEvent('recall-queue', { bubbles: true })); $('#input')?.focus(); });
  }
  else if (ev.t === 'text') {
    el.className = 'msg claude answer md';
    el.innerHTML = `<button class="copy" title="${t('conversation.event.copyAnswer')}">⧉</button>${markdown(ev.text)}`;
    el.querySelector('.copy').addEventListener('click', e => copy(ev.text, e.currentTarget));
  }
  else if (ev.t === 'agent') {
    el.className = 'msg claude';
    el.innerHTML = agentCard(ev);
    attachAgent(el, ev);
  } else if (ev.t === 'command') {
    el.className = 'msg cmd';
    el.innerHTML = `<div class="cmdl"><b>!</b> ${esc(ev.cmd)}<span class="m">${ev.running ? t('conversation.event.commandRunning') : ev.code === 0 || ev.code === undefined ? t('conversation.event.commandSeen') : t('conversation.event.commandExit', { code: esc(ev.code) })}${ev.running ? '' : ` · <button class="link" data-send-cmd>${t('conversation.event.sendNow')}</button>`}</span></div>
      ${ev.output ? `<pre class="code">${esc(ev.output)}</pre>` : ''}`;
    // Without waiting for your next message: the output goes with this short message (the engine attaches it)
    el.querySelector('[data-send-cmd]')?.addEventListener('click', async e => {
      e.target.disabled = true;
      await send(current(), { text: t('conversation.event.lookAtOutput', { cmd: ev.cmd }), when: detail()?.busy ? 'end' : 'now' })
        .catch(err => { e.target.disabled = false; alert(err.message); });
    });
  }
  else if (ev.t === 'decisions') {
    const active = activeDecisionsId === ev.id;
    el.className = 'msg claude';
    el.innerHTML = decisionCards(ev.decisions, current(), active);
    if (active) setTimeout(() => { $('#input').value = syncDraft(current(), ev.decisions); attachDecisions(el); highlight(); document.dispatchEvent(new CustomEvent('input-changed')); });
  } else if (ev.t === 'question') { el.className = 'msg claude'; el.innerHTML = questionCard(ev); attachQuestion(el, ev); }
  else if (ev.t === 'permission') { el.className = 'msg claude'; el.innerHTML = permissionCard(ev); attachPermission(el, ev); }
  else if (ev.t === 'end') { el.className = 'end m'; el.textContent = `${ev.ok ? t('conversation.event.turnDone') : t('conversation.event.turnInterrupted')}${ev.duration ? ` · ${Math.round(ev.duration / 1000)} s` : ''}${ev.cost ? ` · ~${ev.cost.toFixed(2)} $ ${t('conversation.event.estimate')}` : ''}`; }
  else if (ev.t === 'error') {
    el.className = 'msg err';
    el.textContent = `⚠ ${ev.text}`;
    // Conversation held by a background Claude Code: stop it (claude stop) to resume it here
    if (ev.backgroundId) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = t('conversation.event.stopOther');
      b.title = t('conversation.event.stopOtherTitle', { id: ev.backgroundId });
      b.onclick = async () => {
        b.disabled = true;
        try { await release(current(), ev.backgroundId); b.textContent = t('conversation.event.stoppedResend'); toast(t('conversation.event.stoppedToast')); }
        catch (err) { b.disabled = false; alert(err.message); }
      };
      el.append(document.createElement('br'), b);
    }
  }
  else if (ev.t === 'auto') { el.className = `end m auto${ev.level ? ` alert-${ev.level}` : ''}`; el.textContent = ev.text; } // level: plan alert (orange, red)
  else if (ev.t === 'cleared') { el.className = 'end m cleared'; el.textContent = `🧹 ${ev.text}`; }
  else return null;
  return el;
}

/**
 * A tool line: name and summary, state (running, ok, error); expanded, the full call and the result.
 * The detail is built only when opened (a turn often has dozens of tools).
 */
export function fillTool(l, ev, force) {
  l._ev = ev;
  const state = ev.result === undefined ? '<span class="st m">…</span>' : ev.error ? '<span class="st ko">✗</span>' : '<span class="st ok">✓</span>';
  const open = l.open;
  l.innerHTML = `<summary>${state} <b>${esc(ev.name)}</b> ${pathLinks(esc(ev.summary))}</summary>${open || force ? toolDetail(ev) : ''}`;
  if (open) l.open = true;
}
function toolDetail(ev) {
  const e = ev.input || {};
  const block = (title, text) => `<div class="m">${title}</div><pre class="code">${esc(text)}</pre>`;
  let call;
  if (e.command) call = block(t('conversation.event.tool.command'), e.command) + (e.description ? `<div class="m">${esc(e.description)}</div>` : '');
  else if (e.old_string !== undefined) call = `<div class="m">${esc(e.file_path || '')}</div>` + block(t('conversation.event.tool.before'), e.old_string) + block(t('conversation.event.tool.after'), e.new_string ?? '');
  else if (e.content !== undefined && e.file_path) call = block(esc(t('conversation.event.tool.written', { path: e.file_path })), e.content);
  else call = block(t('conversation.event.tool.call'), JSON.stringify(e, null, 2));
  const res = ev.result === undefined ? `<div class="m">${t('conversation.event.tool.waiting')}</div>`
    : block(ev.error ? t('conversation.event.tool.error') : t('conversation.event.tool.result'), ev.result || t('conversation.event.tool.empty'));
  return `<div class="tool-detail">${call}${res}</div>`;
}
