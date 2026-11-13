// Attachments: saved by the engine, sent to Claude as blocks, found again in messages.
import fs from 'node:fs';
import path from 'node:path';
import { DASH_DIR } from '../common.mjs';

/** Attachments saved by the engine: ~/.claude-dashboard/files/<slug>/<timestamp>-<name>. */
export const FILES_DIR = path.join(DASH_DIR, 'files');
export function attachmentUrl(slug, file) {
  const dir = path.join(FILES_DIR, slug).toLowerCase();
  // Old conversations name the folder before the migration (`fichiers`, renamed `files`)
  const old = path.join(path.dirname(FILES_DIR), 'fichiers', slug).toLowerCase();
  const parent = path.dirname(path.resolve(file)).toLowerCase();
  return parent === dir || parent === old
    ? `/api/sessions/${slug}/files/${encodeURIComponent(path.basename(file))}` : null;
}

/** Content block for an attachment: image or PDF that Claude sees directly; the others stay a path. */
const IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export function attachmentBlock(p) {
  try {
    const size = fs.statSync(p.path).size;
    if (IMAGES.has(p.type) && size <= 5 * 1024 * 1024) {
      return [{ type: 'image', source: { type: 'base64', media_type: p.type, data: fs.readFileSync(p.path).toString('base64') } }];
    }
    if (p.type === 'application/pdf' && size <= 20 * 1024 * 1024) {
      return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(p.path).toString('base64') }, title: p.name }];
    }
  } catch { /* file gone: the cited path is enough */ }
  return [];
}

/**
 * Attachments cited in a message ("[attachment: path]"): removed from the text, returned for the page.
 * Backward compatibility: messages recorded by the French build cite them as "[pièce jointe : path]".
 */
export function extractAttachments(text, urlOf) {
  const attachments = [];
  const rest = text.replace(/\n?\[(?:attachment|pièce jointe) ?: ([^\]\n]+)\]/g, (_, file) => {
    const name = path.basename(file);
    const ext = path.extname(name).toLowerCase();
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' }[ext] || '';
    attachments.push({ name: name.replace(/^\d+-/, ''), type, url: urlOf(file) });
    return '';
  });
  return { text: rest, attachments };
}
