// Calls to the page server (JSON), file uploads and the URLs of a session's files.

export async function api(url, body) {
  const r = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** Stores a file on the engine side; returns { name, type, path, url }. */
export async function upload(slug, file) {
  const r = await fetch(`/api/sessions/${slug}/files?name=${encodeURIComponent(file.name || 'image.png')}&type=${encodeURIComponent(file.type || '')}`, { method: 'POST', headers: { 'x-dash': '1' }, body: file }); // x-dash: a raw body the server accepts (not JSON)
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// A '.' or '..' segment would be resolved by the browser and leave /f/ (another route of the page): neutralised
export const fileUrl = (slug, path) =>
  `/f/${slug}/` + String(path).replace(/\\/g, '/').split('/').map(s => (s === '.' || s === '..' ? '_' : encodeURIComponent(s))).join('/');
