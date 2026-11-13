// Live stream. Reconnection after a restart of the page or the engine: everything is reloaded (events may have
// been missed). If the relay answers an error while the engine restarts (502), the browser gives up on the stream
// for good: we recreate it ourselves, every 2 s, until it holds.

/**
 * Opens `/api/events`; `onUpdate` / `onFeed` / `onAchievement` receive the raw event, `onReopen` after each reconnection,
 * `onRestarting` when the page or the engine is about to stop (restart, update).
 */
export function connectSse({ onUpdate, onFeed, onAchievement, onReopen, onRestarting }) {
  let opened = false;
  const connect = () => {
    const sse = new EventSource('/api/events');
    sse.addEventListener('open', async () => { if (opened) await onReopen(); opened = true; });
    sse.addEventListener('error', () => { if (sse.readyState === EventSource.CLOSED) setTimeout(connect, 2000); });
    sse.addEventListener('update', onUpdate);
    sse.addEventListener('feed', onFeed);
    if (onAchievement) sse.addEventListener('achievement', onAchievement); // achievement unlocked, level gained
    if (onRestarting) sse.addEventListener('restarting', onRestarting);
  };
  connect();
}
