/*
 * A small token bucket for the lazy index rows. The API allows 60 requests per minute per IP
 * in production (docs/api-contract.md); an index row asks for a summary, the circuit's
 * straights and outline (shared per circuit) and a profile, so rows queue here instead of
 * firing at once. A burst of 20 covers the first screens (the landing's season list, or the
 * first weekends of the sessions page); after that one request every 1.5 s, so the first
 * minute stays at 60 at most and the steady 40 a minute leaves room for the page's own
 * requests. A 429 empties the bucket for 10 s. Keys already started are shared, never
 * re-queued; failures are dropped so a later visit can retry.
 */
const CAPACITY = 20;
const REFILL_MS = 1500;

let tokens = CAPACITY;
let last = Date.now();
let timer: number | null = null;
/** Numbers first (summaries, straights, outlines), then the drawings (profiles). */
const queue: (() => void)[] = [];
const later: (() => void)[] = [];
const started = new Map<string, Promise<unknown>>();

function refill() {
  const now = Date.now();
  const add = Math.floor((now - last) / REFILL_MS);
  if (add <= 0) return;
  tokens = Math.min(CAPACITY, tokens + add);
  last = tokens === CAPACITY ? now : last + add * REFILL_MS;
}

function pump() {
  refill();
  while (tokens > 0 && (queue.length || later.length)) {
    tokens--;
    (queue.shift() ?? later.shift())!();
  }
  if ((queue.length || later.length) && timer === null) {
    timer = window.setTimeout(() => {
      timer = null;
      pump();
    }, REFILL_MS);
  }
}

/**
 * Runs `run` when a token is free. `low` requests (a row's drawing) wait behind every queued
 * normal one (a row's numbers), so each row prints its number before any row draws its trace.
 */
export function limited<T>(key: string, run: () => Promise<T>, low = false): Promise<T> {
  const hit = started.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = new Promise<T>((resolve, reject) => {
    (low ? later : queue).push(() => run().then(resolve, reject));
    pump();
  });
  started.set(key, p);
  p.catch((e: unknown) => {
    started.delete(key);
    if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 429) {
      tokens = 0;
      last = Date.now() + 10_000 - REFILL_MS;
    }
  });
  return p;
}
