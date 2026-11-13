// Answer draft of a session (text of the input and signature of the decisions), kept in the browser.
import { read, write } from '../core/storage.js';

const draftKey = slug => `draft:${slug}`;
export function readDraft(slug) {
  return read(draftKey(slug), null) || { text: '', sig: {} };
}
export function writeDraft(slug, b) { write(draftKey(slug), b); }

export function splitDraft(text) {
  const lines = new Map(), free = [];
  for (const l of text.split('\n')) {
    if (/^NaN\. /.test(l)) continue; // leftovers of an old numbering bug
    const m = l.match(/^(\d+)\. /);
    if (m) lines.set(Number(m[1]), l); else free.push(l);
  }
  return { lines, free };
}
export function joinDraft({ lines, free }) {
  const nums = [...lines.keys()].sort((a, b) => a - b).map(n => lines.get(n));
  const rest = free.join('\n').replace(/^\n+|\n+$/g, '');
  return [...nums, ...(rest ? ['', rest] : [])].join('\n');
}

/** Removes the lines of decisions that disappeared or changed; nothing is prefilled, a line only comes when a choice is clicked. */
export function syncDraft(slug, decisions) {
  const b = readDraft(slug);
  const parts = splitDraft(b.text);
  const ids = new Map((decisions || []).map((x, i) => [i + 1, x])); // numbered by position: the id may be a text
  for (const n of [...parts.lines.keys()]) {
    if (!ids.has(n) || b.sig[n] !== ids.get(n).question) parts.lines.delete(n);
  }
  b.text = joinDraft(parts);
  b.sig = Object.fromEntries([...ids].map(([n, x]) => [n, x.question]));
  writeDraft(slug, b);
  return b.text;
}
