// Event stream (SSE) to the pages: `update` (a session changed, '*' = the list), `feed` (a feed item) and
// `achievement` (achievement unlocked, level gained).

export const sseClients = new Set();

export function broadcast(slug) {
  for (const res of sseClients) res.write(`event: update\ndata: ${slug}\n\n`);
}
export function broadcastFeed(slug, ev) {
  const data = JSON.stringify({ slug, ev });
  for (const res of sseClients) res.write(`event: feed\ndata: ${data}\n\n`);
}
export function broadcastAchievement(ev) {
  const data = JSON.stringify(ev);
  for (const res of sseClients) res.write(`event: achievement\ndata: ${data}\n\n`);
}
