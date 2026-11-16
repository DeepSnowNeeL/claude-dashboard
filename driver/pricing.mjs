// API-equivalent cost of the calls of a subagent: the SDK only gives the cost of a whole turn (total_cost_usd), so
// each call is priced from its usage and its model. Prices in $ per million tokens (Anthropic API, November 2026);
// cache write 1.25× input at 5 min, 2× at 1 h; cache read 0.1× input unless the model has its own price.
const PRICES = [
  [/fable|mythos/, { input: 10, output: 50, read: 0.25 }],
  [/opus-5-5/, { input: 4, output: 20, read: 0.2 }],
  [/opus-(5|4-[5-9])/, { input: 5, output: 25 }],
  [/opus/, { input: 15, output: 75 }],
  [/sonnet-5/, { input: 2, output: 10, read: 0.2 }],
  [/sonnet/, { input: 3, output: 15 }],
  [/haiku-5/, { input: 0.1, output: 0.5 }],
  [/haiku-4/, { input: 1, output: 5 }],
  [/haiku/, { input: 0.8, output: 4 }],
];
const priceOf = model => PRICES.find(([re]) => re.test(String(model || '')))?.[1];

/** Tokens and cost of one call (API usage): `{ input, cacheWrite, cacheRead, output, cost }`; cost null if the model is unknown. */
export function callUsage(model, u) {
  const p = priceOf(model);
  const write1h = u?.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write = u?.cache_creation_input_tokens || 0;
  const x = { input: u?.input_tokens || 0, cacheWrite: write, cacheRead: u?.cache_read_input_tokens || 0, output: u?.output_tokens || 0 };
  x.cost = p ? (x.input * p.input + (write - write1h) * p.input * 1.25 + write1h * p.input * 2
    + x.cacheRead * (p.read ?? p.input * 0.1) + x.output * p.output) / 1e6 : null;
  return x;
}

/**
 * Consumption of an agent, call by call: one answer comes as several messages (one per block) carrying the same id and
 * a usage that grows, so each id counts once with its last usage. Returns the totals `{ input, cacheWrite, cacheRead,
 * output, cost }`; `calls` (id → usage of the call) is kept by the caller.
 */
export function addCall(calls, id, model, usage) {
  if (usage) calls.set(id || `#${calls.size}`, callUsage(model, usage));
  const total = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 };
  for (const c of calls.values()) for (const k of Object.keys(total)) total[k] += c[k] || 0;
  return total;
}
