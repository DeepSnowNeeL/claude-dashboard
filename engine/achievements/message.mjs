// Pure analysis of a developer message and its time: what counts for achievements.

const withoutAccents = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const norm = t => withoutAccents(String(t || '')).replace(/\s+/g, ' ').trim();

/**
 * @param {string} text message as sent
 * @param {object[]} [decisions] the session's `data.decisions` at send time ("N. …" lines)
 * @returns {{ short, thanks, perfect, huh, allCaps, lines: { n: number, follows?: boolean, explain?: boolean }[] }}
 */
export function analyzeMessage(text, decisions = []) {
  const t = String(text || '').trim();
  const letters = t.match(/\p{L}/gu) || [];
  const lines = [];
  for (const l of t.split(/\r?\n/)) {
    const m = l.match(/^\s*(\d+)\.\s+(.+)$/);
    const dec = m && decisions?.[Number(m[1]) - 1];
    if (!dec) continue;
    // French button text kept on purpose: the French UI still sends « Explique-moi plus en détail »
    if (/explique-moi plus en d[ée]tail|explain in more detail/i.test(m[2])) { lines.push({ n: Number(m[1]), explain: true }); continue; }
    const reco = (dec.choices || []).find(c => c.label === dec.recommendation);
    // The page strips an "N." Claude may have put at the start of the answer: same here
    const expected = norm(String(reco?.answer || '').replace(/^\d+\.\s*/, ''));
    lines.push({ n: Number(m[1]), follows: !!expected && norm(m[2]).startsWith(expected) });
  }
  return {
    short: t.length > 0 && t.length <= 3 && !t.startsWith('/') && !t.startsWith('!'),
    thanks: /(^|[^\p{L}])(merci|thanks|thx)([^\p{L}]|$)/iu.test(t),
    perfect: /parfait|perfect/.test(withoutAccents(t)),
    huh: t === '?',
    allCaps: letters.length >= 20 && letters.every(c => c === c.toUpperCase() && c !== c.toLowerCase()),
    lines,
  };
}

const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Moment of a message (local time): day, night (2 to 5 am), morning (5 to 7 am), weekend day (key of the Saturday),
 * holiday (December 25, January 1), eve (for the streak).
 */
export function momentOf(d = new Date()) {
  const h = d.getHours(), wd = d.getDay();
  const saturday = new Date(d); saturday.setDate(d.getDate() - (wd === 0 ? 1 : 0));
  const eve = new Date(d); eve.setDate(d.getDate() - 1);
  return {
    day: key(d), eve: key(eve),
    night: h >= 2 && h < 5 ? key(d) : null,
    morning: h >= 5 && h < 7 ? key(d) : null,
    weekend: wd === 6 ? { key: key(saturday), day: 'sat' } : wd === 0 ? { key: key(saturday), day: 'sun' } : null,
    holiday: (d.getMonth() === 11 && d.getDate() === 25) || (d.getMonth() === 0 && d.getDate() === 1),
  };
}
