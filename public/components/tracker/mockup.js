// Row of a tracker mockup: Open button and previous versions.
import { esc } from '../../core/dom.js';
import { fileUrl } from '../../core/api.js';
import { t } from '../../i18n/index.js';

export function mockup(slug, m) {
  const versions = m.versions || [];
  return `<div class="mock-row"><b>${esc(m.title)}</b>
    <a class="btn on" href="${esc(fileUrl(slug, m.path))}" target="_blank">${t('tracker.mockup.open')}</a>
    ${versions.length ? `<span class="m">${t('tracker.mockup.previousVersions')}</span> ${versions.map(v => `<a class="btn" href="${esc(fileUrl(slug, v.path))}" target="_blank">${esc(v.label)}</a>`).join(' ')}` : ''}
  </div>`;
}
