// The section rail is transparent while it sits in the flow (so the ground's depth gradient runs
// through it) and takes a solid ground only once it is pinned under the header. A 1px sentinel
// placed before each rail tells us when that happens; React never touches either node.
const SENTINEL = 'section-rail-sentinel';

function watch(rail: HTMLElement) {
  if (rail.dataset.railWatched) return;
  rail.dataset.railWatched = '1';
  const sentinel = document.createElement('div');
  sentinel.className = SENTINEL;
  sentinel.setAttribute('aria-hidden', 'true');
  rail.before(sentinel);
  const headerH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
  const io = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting || entry.boundingClientRect.top > headerH()) delete rail.dataset.stuck;
      else rail.dataset.stuck = '1';
    },
    { rootMargin: `-${headerH()}px 0px 0px 0px`, threshold: 0 }
  );
  io.observe(sentinel);
}

export function watchRails(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.section-rail').forEach(watch);
}

if (typeof window !== 'undefined') {
  const run = () => watchRails();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
}
