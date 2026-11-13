// Permission modes of a session (keys of MODES in driver/modes.mjs), in the order of Claude Code's Shift+Tab cycle,
// from the most permissive: options of the header's and the "New session" page's selectors.
import { esc } from './dom.js';
import { t } from '../i18n/index.js';

export const MODE_KEYS = ['all', 'auto', 'edits', 'ask', 'plan'];

/** Label of a mode ("⚡ allow everything"). */
export const modeLabel = m => t(`common.modes.${MODE_KEYS.includes(m) ? m : 'all'}`);

/** `<option>`s of a mode selector; auto greyed out when the session's model does not support it (`autoMode === false`). */
export function modeOptions(selected, autoMode) {
  return MODE_KEYS.map(m => {
    const off = m === 'auto' && autoMode === false && selected !== 'auto';
    return `<option value="${m}" ${m === (selected || 'all') ? 'selected' : ''} ${off ? 'disabled' : ''} title="${esc(t(`common.modes.${m}Title`))}">${esc(modeLabel(m))}${off ? ` ${esc(t('common.modes.unavailable'))}` : ''}</option>`;
  }).join('');
}
