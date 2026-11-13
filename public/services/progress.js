// Levels, XP and achievements: reading the progress computed by the engine, and "all seen".
import { api } from '../core/api.js';
import { progress } from '../core/state.js';

export async function loadProgress() {
  try { progress.set(await api('/api/progress')); } catch { /* engine restarting: we keep what is displayed */ }
}
export async function markAchievementsSeen() {
  await api('/api/progress/seen', {}).catch(() => {});
  await loadProgress();
}
