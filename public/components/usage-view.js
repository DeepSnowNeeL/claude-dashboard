// /usage window: what /usage, /cost and /context of the CLI show (limits, cost per model, what consumes over
// 24 h and 7 days, context occupancy), plus the dashboard share and its comparison with the terminal over
// 7 days (computed by server/consumption.mjs).
import { esc, formatWhen, skeleton, toast } from '../core/dom.js';
import { readUsage, readSessionConsumption, readComparison, readUsageCli } from '../services/usage.js';
import { send } from '../services/sessions.js';
import { t, locale } from '../i18n/index.js';

const nb = n => Math.round(n || 0).toLocaleString(locale());
const short = n => (n >= 1e6 ? `${(n / 1e6).toLocaleString(locale(), { maximumFractionDigits: 1 })} M` : n >= 1e4 ? `${Math.round(n / 1e3).toLocaleString(locale())} k` : nb(n));
const pc = (x, d = 1) => `${((x || 0) * 100).toLocaleString(locale(), { maximumFractionDigits: d })} %`;
const bar = x => `<div class="gauge-bar"><div style="width:${Math.min(Math.max((x || 0) * 100, 0), 100)}%"></div></div>`;
const WEIGHTS = { input: 1, cacheRead: 0.1, output: 5 }; // cache write: 1.25 or 2 depending on the cache, counted on the server side

function subscriptionHtml(u) {
  if (!u) return `<p class="m">${t('usage.view.limitsUnavailable')}</p>`;
  const account = [u.email, u.organization && !(u.email && u.organization.includes(u.email)) ? u.organization : ''].filter(Boolean).join(' · ');
  const x = u.extra;
  const money = v => (v / 10 ** (x?.decimals ?? 2)).toLocaleString(locale(), { style: 'currency', currency: x?.currency || 'EUR' });
  return `<div class="m">${esc(String(u.plan || '').toUpperCase())}${account ? ` · ${esc(account)}` : ''}</div>
    ${(u.limits || []).map(l => `<div class="gauge ${(Number(l.percent) || 0) >= 90 ? 'critical' : (Number(l.percent) || 0) >= 80 ? 'warning' : ''}">
      <span class="gl">${esc(l.label)}</span>${bar((Number(l.percent) || 0) / 100)}<b>${esc(l.percent ?? '?')} %</b>
      <span class="reset" title="${l.reset ? esc(new Date(l.reset).toLocaleString(locale())) : ''}">${l.reset ? esc(formatWhen(l.reset, true)) : ''}</span></div>`).join('')}
    ${x ? `<div class="m">${x.active ? t('usage.view.extraOn', { used: money(x.used), limit: money(x.limit) }) : t(x.reason === 'out_of_credits' ? 'usage.view.extraOffNoCredits' : 'usage.view.extraOff')}</div>` : ''}`;
}

function sessionHtml(c) {
  if (!c) return `<p class="m">${t('usage.view.noRequestYet')}</p>`;
  const tk = c.tokens;
  const rows = [
    [t('usage.view.rows.input'), tk.input, tk.input * WEIGHTS.input],
    [t('usage.view.rows.cacheWrite'), tk.cacheWrite, null],
    [t('usage.view.rows.cacheRead'), tk.cacheRead, tk.cacheRead * WEIGHTS.cacheRead],
    [t('usage.view.rows.output'), tk.output, tk.output * WEIGHTS.output],
  ];
  const cacheWrite = c.weight - rows.reduce((n, l) => n + (l[2] || 0), 0);
  rows[1][2] = cacheWrite;
  const fixed = c.dash.fixedWeight, calls = c.dash.callWeight;
  const detail = Object.entries(c.dash.callDetail || {}).map(([n, v]) => `${v.calls} × <code>${esc(n)}</code> (≈ ${nb(v.tokens)} tokens)`).join(', ');
  return `<div class="u-figures">
      <div><b>${nb(c.prompts)}</b><span>${t('usage.view.messagesSent')}</span></div>
      <div><b>${nb(c.requests)}</b><span>${t('usage.view.apiRequests')}</span></div>
      <div><b>${short(c.weight)}</b><span>${t('usage.view.equivalentTokens')}</span></div>
      <div><b>${short((tk.input + tk.cacheWrite + tk.cacheRead) / Math.max(c.requests, 1))}</b><span>${t('usage.view.avgContext')}</span></div>
    </div>
    <table class="u-table"><tr><th></th><th>tokens</th><th>${t('usage.view.weight')}</th><th></th></tr>
      ${rows.map(([l, n, p]) => `<tr><td>${l}</td><td>${short(n)}</td><td>${short(p)}</td><td class="u-share">${bar(p / c.weight)}<span>${pc(p / c.weight, 0)}</span></td></tr>`).join('')}
    </table>
    ${c.subagents ? `<p class="m">${t('usage.view.subagents', { n: c.subagents, weight: short(c.subagentWeight), share: pc(c.subagentWeight / c.weight, 0) })}</p>` : ''}
    ${c.rebuilds ? `<p class="m">${t('usage.view.rebuilds', { n: c.rebuilds })}</p>` : ''}
    <h4>${t('usage.view.dashShare')}</h4>
    ${c.dashboard || c.dash.calls ? `<div class="u-dash"><b>${pc(c.dash.share)}</b>${bar(c.dash.share)}</div>
      <ul class="u-list">
        <li>${t('usage.view.dashInstructions', { tokens: nb(c.dash.instructions + c.dash.tools), weight: short(fixed), share: pc(fixed / c.weight) })}</li>
        <li>${t('usage.view.dashCalls', { detail: detail || t('usage.view.none'), weight: short(calls), share: pc(calls / c.weight) })}</li>
      </ul>` : `<p class="m">${t('usage.view.outsideDashboard')}</p>`}`;
}

function comparisonHtml(g) {
  const a = g.dashboard, b = g.terminal;
  if (!a && !b) return `<p class="m">${t('usage.view.noSession7Days')}</p>`;
  const col = (x, f) => (x ? f(x) : '–');
  const models = x => Object.entries(x.models || {}).filter(([m, v]) => v >= 0.01 && m !== '<synthetic>').sort((p, q) => q[1] - p[1])
    .map(([m, v]) => `${esc(m.replace(/^claude-/, ''))} ${pc(v, 0)}`).join(', ');
  const rows = [
    [t('usage.view.comp.sessions'), x => nb(x.sessions)],
    [t('usage.view.comp.messagesSent'), x => nb(x.prompts)],
    [t('usage.view.comp.requestsPerMessage'), x => x.requestsPerPrompt.toLocaleString(locale())],
    [t('usage.view.comp.avgContext'), x => `${short(x.avgContext)} tokens`],
    [t('usage.view.comp.outputPerRequest'), x => `${nb(x.outputPerRequest)} tokens`],
    [t('usage.view.comp.cacheRebuilt'), x => pc(x.rebuildShare)],
    [`<b>${t('usage.view.comp.perMessage')}</b>`, x => `<b>${short(x.perPrompt)}</b>`],
    [t('usage.view.comp.dashShare'), x => pc(x.dashShare)],
    [t('usage.view.comp.models'), models],
  ];
  // Reading: gap per message, and what explains it (context size, number of requests), the panel apart
  let reading = '';
  if (a && b) {
    const gap = a.perPrompt / b.perPrompt - 1;
    reading = `<p class="u-read">${t('usage.view.reading', {
      gap: pc(Math.abs(gap), 0), more: gap >= 0 ? 1 : 0,
      ctxA: short(a.avgContext), ctxB: short(b.avgContext),
      reqA: a.requestsPerPrompt.toLocaleString(locale()), reqB: b.requestsPerPrompt.toLocaleString(locale()), panel: pc(a.dashShare),
    })}</p>`;
  }
  return `<table class="u-table u-comp"><tr><th></th><th>${t('usage.view.comp.dashboard')}</th><th>${t('usage.view.comp.terminal')}</th></tr>
      ${rows.map(([l, f]) => `<tr><td>${l}</td><td>${col(a, f)}</td><td>${col(b, f)}</td></tr>`).join('')}
    </table>${reading}`;
}

// --- Like the CLI: /cost (cost per model), /context (context occupancy), /usage (what consumes) ----------

const dollars = n => (n || 0).toLocaleString(locale(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 });
const duration = ms => { const s = Math.round((ms || 0) / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s`; };

function costHtml(s) {
  if (!s) return `<p class="m">${t('usage.view.costUnavailable')}</p>`;
  const models = Object.entries(s.model_usage || {});
  return `<div class="u-figures">
      <div><b>${dollars(s.total_cost_usd)}</b><span>${t('usage.view.cost.estimated')}</span></div>
      <div><b>${duration(s.total_api_duration_ms)}</b><span>${t('usage.view.cost.apiDuration')}</span></div>
      <div><b>${duration(s.total_duration_ms)}</b><span>${t('usage.view.cost.processDuration')}</span></div>
      <div><b><span class="u-plus">+${nb(s.total_lines_added)}</span> <span class="u-minus">−${nb(s.total_lines_removed)}</span></b><span>${t('usage.view.cost.linesOfCode')}</span></div>
    </div>
    ${models.length ? `<table class="u-table"><tr><th>${t('usage.view.cost.model')}</th><th>${t('usage.view.cost.input')}</th><th>${t('usage.view.cost.output')}</th><th>${t('usage.view.cost.cacheRead')}</th><th>${t('usage.view.cost.cacheWritten')}</th><th>${t('usage.view.cost.cost')}</th></tr>
      ${models.map(([m, u]) => `<tr><td>${esc(m.replace(/^claude-/, ''))}</td><td>${short(u.inputTokens)}</td><td>${short(u.outputTokens)}</td><td>${short(u.cacheReadInputTokens)}</td><td>${short(u.cacheCreationInputTokens)}</td><td><b>${dollars(u.costUSD)}</b></td></tr>`).join('')}
    </table>` : ''}
    <p class="m">${t('usage.view.cost.note')}</p>`;
}

// Colors of the context categories (SDK id)
const CTX_COLORS = { system_prompt: '#a1a1aa', system_tools: '#71717a', mcp_tools: '#06b6d4', mcp_instructions: '#10b981', custom_agents: '#8b5cf6', memory_files: '#f59e0b', skills: '#eab308', slash_commands: '#f97316', messages: '#3b82f6' };
const ctxColor = c => CTX_COLORS[c.id] || (c.kind === 'free' ? 'transparent' : c.kind === 'buffer' ? '#52525b' : '#94a3b8');
// SDK category names (English) → key of the translated name
const CTX_NAMES = { 'System prompt': 'systemPrompt', 'System tools': 'systemTools', 'MCP tools': 'mcpTools', 'MCP server instructions': 'mcpInstructions', 'Custom agents': 'customAgents', 'Memory files': 'memoryFiles', Skills: 'skills', 'Slash commands': 'slashCommands', Messages: 'messages', 'Free space': 'freeSpace', 'Autocompact buffer': 'autocompactBuffer' };
const ctxName = n => { const base = String(n).replace(/ \(deferred\)$/, ''); return (CTX_NAMES[base] ? t(`usage.view.ctx.${CTX_NAMES[base]}`) : base) + (base !== n ? t('usage.view.ctx.deferred') : ''); };

function contextHtml(c) {
  if (!c) return `<p class="m">${t('usage.view.ctx.unavailable')}</p>`;
  const max = c.rawMaxTokens || c.maxTokens || 1;
  const cats = (c.categories || []).filter(x => x.kind !== 'deferred');
  const deferred = (c.categories || []).filter(x => x.kind === 'deferred');
  const byServer = {};
  for (const tl of c.mcpTools || []) { const s = (byServer[tl.serverName] ??= { tokens: 0, tools: 0, loaded: 0 }); s.tokens += tl.tokens; s.tools++; if (tl.isLoaded) s.loaded++; }
  const skills = [...(c.skills?.skillFrontmatter || [])].sort((a, b) => b.tokens - a.tokens);
  const mb = c.messageBreakdown;
  const list = (title, lines) => lines.length ? `<details><summary>${title}</summary><table class="u-table">${lines.join('')}</table></details>` : '';
  return `<div class="u-ctx-head"><b>${short(c.totalTokens)}</b> / ${short(max)} tokens · ${esc(String(c.percentage ?? Math.round(c.totalTokens / max * 100)))} %${c.model ? ` · ${esc(c.model.replace(/^claude-/, ''))}` : ''}${c.isAutoCompactEnabled && c.autoCompactThreshold ? ` · ${t('usage.view.ctx.autoCompactAt', { n: short(c.autoCompactThreshold) })}` : ''}</div>
    <div class="u-ctx-bar">${cats.filter(x => x.kind !== 'free').map(x => `<i style="width:${x.tokens / max * 100}%;background:${ctxColor(x)}" title="${esc(ctxName(x.name))} : ${nb(x.tokens)} tokens"></i>`).join('')}</div>
    <table class="u-table">${cats.map(x => `<tr><td><span class="u-dot" style="background:${ctxColor(x)}"></span>${esc(ctxName(x.name))}</td><td>${nb(x.tokens)}</td><td>${pc(x.tokens / max)}</td></tr>`).join('')}
      ${deferred.map(x => `<tr class="u-differs"><td><span class="u-dot"></span>${esc(ctxName(x.name))}</td><td>${nb(x.tokens)}</td><td>${t('usage.view.ctx.outOfContext')}</td></tr>`).join('')}</table>
    ${list(t('usage.view.ctx.memoryFilesList', { n: (c.memoryFiles || []).length }), (c.memoryFiles || []).map(f => `<tr><td><code>${esc(f.path)}</code> <span class="m">${esc(f.type)}</span></td><td>${nb(f.tokens)}</td></tr>`))}
    ${list(t('usage.view.ctx.skillsList', { n: c.skills?.includedSkills ?? skills.length, tokens: nb(c.skills?.tokens) }), skills.map(s => `<tr><td>${esc(s.name)} <span class="m">${esc(s.pluginName || s.source || '')}</span></td><td>${nb(s.tokens)}</td></tr>`))}
    ${list(t('usage.view.ctx.mcpToolsList', { n: Object.keys(byServer).length }), Object.entries(byServer).sort((a, b) => b[1].tokens - a[1].tokens).map(([n, s]) => `<tr><td>${esc(n)} <span class="m">${t('usage.view.ctx.loaded', { loaded: s.loaded, tools: s.tools })}</span></td><td>${nb(s.tokens)}</td></tr>`))}
    ${list(t('usage.view.ctx.agentsList', { n: (c.agents || []).length }), (c.agents || []).map(a => `<tr><td>${esc(a.agentType)} <span class="m">${esc(a.source || '')}</span></td><td>${nb(a.tokens)}</td></tr>`))}
    ${mb ? list(t('usage.view.ctx.messagesByType'), [[t('usage.view.ctx.toolCalls'), mb.toolCallTokens], [t('usage.view.ctx.toolResults'), mb.toolResultTokens], [t('usage.view.ctx.attachments'), mb.attachmentTokens], [t('usage.view.ctx.claudeAnswers'), mb.assistantMessageTokens], [t('usage.view.ctx.yourMessages'), mb.userMessageTokens]].filter(([, n]) => n).map(([l, n]) => `<tr><td>${l}</td><td>${nb(n)}</td></tr>`)) : ''}`;
}

// Behaviors of the CLI /usage (SDK keys) → translated label
const behavior = k => { const v = t(`usage.view.behaviors.${k}`); return v === `usage.view.behaviors.${k}` ? k : v; };
/** A window (24 h or 7 days) of the CLI /usage: recommendations, behaviors, split by source. */
function windowHtml(f, canFix) {
  if (!f) return `<p class="m">${t('usage.view.nothingInPeriod')}</p>`;
  const bars = (title, l) => l?.length ? `<div class="u-split"><h5>${title}</h5>${l.map(x => `<div class="gauge"><span class="gl" title="${esc(x.name)}">${esc(x.name)}</span>${bar(x.pct / 100)}<b>${x.pct} %</b><span></span></div>`).join('')}</div>` : '';
  return `<p class="m">${t('usage.view.requestsSessions', { requests: nb(f.request_count), sessions: nb(f.session_count) })}</p>
    ${f.recommendations?.length ? `<ul class="u-reco">${f.recommendations.map(r => `<li><b>${r.pct} %</b> <span class="m">${esc(behavior(r.key))}</span> · ${esc(r.title)}${r.detail ? ` <span class="m">(${esc(r.detail)})</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${f.fix?.messages?.length && canFix ? `<button class="btn" data-fix>${t('usage.view.askToFix', { what: f.fix.keys.map(k => esc(behavior(k))).join(', ') })}</button>` : ''}
    <div class="u-split-grid">
      ${bars(t('usage.view.behaviorsTitle'), (f.behaviors || []).map(b => ({ name: behavior(b.key), pct: b.pct })))}
      ${bars(t('usage.view.agents'), f.agents)}${bars('Skills', f.skills)}${bars('Plugins', f.plugins)}${bars(t('usage.view.mcpServers'), f.mcp_servers)}
    </div>`;
}

/** /usage: the window is drawn right away as skeletons, each part arrives when it is ready. */
export function openUsage(d) {
  document.querySelector('.modal-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal usage-view" role="dialog" tabindex="-1"><button class="close-x" title="${t('common.closeEsc')}">×</button>
    <h3>${t('usage.view.title')} <span class="m">· ${esc(d.title || d.slug)}</span></h3>
    <section><h4>${t('usage.view.subscription')}</h4><div class="u-sub">${skeleton('lines', 3)}</div></section>
    <section><h4>${t('usage.view.sessionCost')}</h4><div class="u-cost">${skeleton('lines', 4)}</div></section>
    <section><h4>${t('usage.view.whatConsumes')} <span class="u-toggle"><button class="btn on" data-window="day">24 h</button><button class="btn" data-window="week">${t('usage.view.sevenDays')}</button></span></h4>
      <div class="u-usage">${skeleton('lines', 6)}<p class="m">${t('usage.view.analysing')}</p></div></section>
    <section><h4>${t('usage.view.sessionContext')}</h4><div class="u-ctx">${skeleton('lines', 5)}</div></section>
    <section><h4>${t('usage.view.sessionTokens')}</h4><div class="u-session">${skeleton('lines', 5)}</div></section>
    <section><h4>${t('usage.view.last7Days')}</h4><div class="u-comp-z">${skeleton('lines', 6)}<p class="m">${t('usage.view.readingHistory')}</p></div></section>
    <p class="m u-method">${t('usage.view.method')}</p>
  </div>`;
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  backdrop.querySelector('.close-x').onclick = close;
  document.body.append(backdrop);
  backdrop.querySelector('.modal').focus();
  const fill = (sel, promise, render) => promise.then(v => render(v), e => `<p class="m">${esc(e.message)}</p>`).then(html => { const z = backdrop.querySelector(sel); if (z) z.innerHTML = html; });
  fill('.u-sub', readUsage(), subscriptionHtml);
  fill('.u-session', d.sessionId ? readSessionConsumption(d.sessionId) : Promise.resolve(null), sessionHtml);
  fill('.u-comp-z', readComparison(), comparisonHtml);
  // /usage and /context of the CLI: a single request to the engine (it resumes the paused session)
  // 404: engine older than this window (it restarts when all the sessions are idle)
  const cli = !d.driven ? Promise.reject(new Error(t('usage.view.terminalSession')))
    : readUsageCli(d.slug).catch(e => { throw /404/.test(e.message) ? new Error(t('usage.view.engineRestartNeeded')) : e; });
  fill('.u-cost', cli.then(u => u.session), costHtml);
  fill('.u-ctx', cli.then(u => u.context), contextHtml);
  let win = 'day', behaviors = null;
  const paintUsage = () => { const z = backdrop.querySelector('.u-usage'); if (z) z.innerHTML = behaviors ? windowHtml(behaviors[win], !!d.driven) : `<p class="m">${t('usage.view.splitUnavailable')}</p>`; };
  cli.then(u => { behaviors = u.behaviors; paintUsage(); }, e => { const z = backdrop.querySelector('.u-usage'); if (z) z.innerHTML = `<p class="m">${esc(e.message)}</p>`; });
  backdrop.querySelectorAll('[data-window]').forEach(b => b.addEventListener('click', () => {
    win = b.dataset.window;
    backdrop.querySelectorAll('[data-window]').forEach(x => x.classList.toggle('on', x === b));
    if (behaviors) paintUsage();
  }));
  // "Fix" of the CLI: its messages go to the session, in order, at the end of the current turn
  backdrop.addEventListener('click', async e => {
    if (!e.target.closest('[data-fix]')) return;
    const messages = behaviors?.[win]?.fix?.messages || [];
    try { for (const text of messages) await send(d.slug, { text, when: 'end' }); } catch (err) { return alert(err.message); }
    close();
    toast(t('usage.view.fixSent'));
  });
}
