/*
 * A small token bucket for the lazy index rows. The API allows 60 requests per minute per IP
 * in production (docs/api-contract.md); the sessions index can ask for a summary, a straight
 * list and a profile per row, so rows queue here instead of firing at once. A burst of 12
 * covers the first screen; after that one request every 1.2 s (50 a minute) leaves room for
 * the page's own requests. Keys already started are shared, never re-queued; failures are
 * dropped so a later visit can retry.
 */
const CAPACITY = 12;
const REFILL_MS = 1200;

let tokens = CAPACITY;
let last = Date.now();
let timer: number | null = null;
const queue: (() => void)[] = [];
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
  while (tokens > 0 && queue.length) {
    tokens--;
    queue.shift()!();
  }
  if (queue.length && timer === null) {
    timer = window.setTimeout(() => {
      timer = null;
      pump();
    }, REFILL_MS);
  }
}

export function limited<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = started.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = new Promise<T>((resolve, reject) => {
    queue.push(() => run().then(resolve, reject));
    pump();
  });
  started.set(key, p);
  p.catch(() => started.delete(key));
  return p;
}
