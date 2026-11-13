// Engine session registry: their state (Tracker panel JSON) and their driven Claude process.
// A separate module so that sessions.mjs and board.mjs use it without importing each other.

/** slug → { data, receivedAt } */
export const sessions = new Map();
/** slug → live driven session (see driver.mjs) */
export const drivers = new Map();
