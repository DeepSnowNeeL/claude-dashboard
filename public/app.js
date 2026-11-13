// Dashboard page: list of the sessions, conversation in the center, state of the work on the right.
// Bootstrap: sets the language, mounts the components, wires the live stream and the routing by the address.
import { sessions, current, activity, serverMode } from './core/state.js';
import { $ } from './core/dom.js';
import { connectSse } from './core/sse.js';
import { onRoute } from './core/router.js';
import { t, setLanguage, resolveLanguage, language, translateDom } from './i18n/index.js';
import { readLanguageInfo } from './services/options.js';
import { loadList } from './services/projects.js';
import { loadUsage } from './components/usage.js';
import { mountPathMenu } from './components/path-menu.js';
import { mountCopy } from './components/copy.js';
import { mountPalette } from './components/explorer/palette.js';
import { mountSide } from './components/side/tabs.js';
import { mountHandles } from './components/handles.js';
import { mountTree, byStatus } from './components/tree/tree.js';
import { renderTracker } from './components/tracker/panel.js';
import { mountOptions } from './components/options.js';
import { mountAchievements } from './components/achievements.js';
import { loadProgress } from './services/progress.js';
import { mountMobile } from './components/mobile.js';
import { show, refresh, mountConversation, markNewsRead } from './components/conversation/conversation.js';
import { mountHeader } from './components/conversation/header.js';
import { mountFeed, addEvent } from './components/conversation/feed.js';
import { mountInput } from './components/conversation/input.js';
import { mountActivity } from './components/conversation/activity.js';
import { mountTabs } from './components/conversation/tabs.js';

// Interface language, before anything is drawn: the setting of the PC (options.json), `auto` follows the browser.
// The same call says whether the dashboard runs in server mode (no desktop actions).
const languageInfo = await readLanguageInfo().catch(() => ({}));
serverMode.set(!!languageInfo.serverMode);
setLanguage(resolveLanguage(languageInfo.setting || 'auto', navigator.language));
document.documentElement.lang = language();
translateDom(document);
document.title = t('common.appTitle');

// Electron app on Windows: after a native dialog, the keyboard does not come back to the page (deaf fields
// until an Alt+Tab). Each alert / confirm / prompt therefore gives the focus back to the window once closed.
if (window.desktop?.restoreFocus) {
  for (const name of ['alert', 'confirm', 'prompt']) {
    const native = window[name].bind(window);
    window[name] = (...args) => { const r = native(...args); window.desktop.restoreFocus(); return r; };
  }
}

mountPathMenu();
mountCopy(); // Ctrl+C: the formatting without the colors of the application
mountTree($('#list'));
mountMobile();
mountOptions();
const onAchievement = mountAchievements(); // level badge, 🏆 window, toasts
mountPalette(); // Ctrl+P
mountSide($('#right'), renderTracker);
mountHandles();
mountConversation(); // Ctrl+Tab
mountHeader(refresh);
mountFeed($('#center'));
mountInput($('#center'));
mountActivity();
mountTabs();

// PWA: installable as an app on the phone (https only, or localhost)
if (window.isSecureContext) navigator.serviceWorker?.register('/sw.js').catch(() => {});

connectSse({
  onAchievement,
  async onReopen() { await loadList(); loadProgress(); if (current() && !/^new(\?|$)/.test(current())) await show(current()); },
  async onUpdate(e) {
    await loadList();
    if (e.data === current()) { await refresh(); markNewsRead(false); }
  },
  onFeed(e) {
    const { slug, ev } = JSON.parse(e.data);
    if (slug !== current()) return;
    if (ev.t === 'activity') { activity.set(ev.activity); return; } // the indicator redraws through its effect
    addEvent(ev);
  },
});

setInterval(loadUsage, 120000);

loadUsage();
await loadList();
// At startup without an address: the first session of the list; afterwards, the address alone decides
await onRoute((starting => slug => { const target = starting ? (slug || [...sessions()].sort(byStatus)[0]?.slug || null) : slug; starting = false; return show(target); })(true));
