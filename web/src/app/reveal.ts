// Once-only scroll reveals. Hidden state is set by JS (never static CSS), so content shows without JS.
// Elements opt in through [data-reveal] or the per-page selectors below. State lives in
// [data-reveal-state] (React never touches unknown attributes) and is removed after the transition,
// so a revealed element carries no leftover transform, delay or stacking context.
const PAGES: Record<string, string[]> = {
  'home-root': [
    '.race-grid>.race-choice',
    '.home-research>h2',
    '.home-research>.research-copy',
    '.home-intro h1',
    '.home-intro-bottom>p',
    '.home-scroll',
  ],
  'session-root': [
    '.session-controls',
    '.map-surface',
    '.driver-estimate',
    '.driver-tower',
    '.lap-panel',
    '.method-section',
    '.race-hero h1',
    '.race-venue',
    '.race-date',
    '.tower-rows>.tower-row',
  ],
  'findings-root': [
    '.finding-sample>div',
    '.run-figure',
    '.evidence-explanation',
    '.permutation-copy',
    '.permutation-chart',
    '.check-list>details',
    '.finding-more>details',
    '.finding-limits dl',
    '.finding-limit-note',
    '.finding-provenance>div',
    '.provenance-actions',
    '.finding-hero h1',
    '.finding-answer>*',
  ],
  'method-root': [
    '.method-process li',
    '.method-plate',
    '.estimator-copy',
    '.record-filters',
    '.method-timeline>li',
    '.method-boundaries>h2',
    '.method-boundaries>div',
    '.method-hero h1',
    '.method-hero-copy>*',
  ],
  'replay-root': [
    '.replay-controls',
    '.replay-stage',
    '.replay-context',
    '.replay-hero h1',
    '.replay-hero>div',
    '.replay-field-rows>button',
  ],
};
const SKEL = '.skel,.session-skeleton,.replay-skeleton';
const SKIP = '[aria-hidden="true"],.skel,.session-skeleton,.replay-skeleton,.switch-in';
const NO_TRANSFORM =
  '.pixel-button,.button-light,.race-halftone,.footer-inner,.home-screen,.finding-screen,.method-screen,.estimate-value';

function start() {
  const root = document.querySelector('[id$="-root"]');
  const sel = [...(PAGES[root?.id ?? ''] ?? []), '[data-reveal]'].join(',');
  const tracked = new WeakSet<Element>();
  let settled = false;
  for (const type of ['pointerdown', 'keydown', 'touchstart'])
    addEventListener(
      type,
      () => {
        settled = true;
      },
      { capture: true, passive: true, once: true }
    );

  const hashTarget = () => {
    if (!location.hash) return null;
    try {
      return document.getElementById(decodeURIComponent(location.hash.slice(1)));
    } catch {
      return null;
    }
  };
  const inView = (r: DOMRect) => r.top < innerHeight && r.bottom > 0;

  const io = new IntersectionObserver(
    (entries) => {
      const hits = entries
        .filter((e) => e.isIntersecting)
        .sort(
          (a, b) =>
            a.boundingClientRect.top - b.boundingClientRect.top ||
            a.boundingClientRect.left - b.boundingClientRect.left
        );
      hits.forEach((entry, i) => {
        const el = entry.target as HTMLElement;
        io.unobserve(el);
        const rank = Math.min(i, 8);
        el.style.setProperty('--reveal-i', String(rank));
        el.dataset.revealState = 'in';
        const kind = el.dataset.revealKind;
        const [dur, step] = kind === 'handoff' ? [200, 40] : kind === 'enter' ? [300, 50] : [360, 30];
        setTimeout(
          () => {
            delete el.dataset.revealState;
            delete el.dataset.revealKind;
            el.style.removeProperty('--reveal-i');
          },
          dur + rank * step + 80
        );
      });
    },
    // Reveal a quarter-viewport ahead of the fold so content is already in place when it scrolls into view.
    { rootMargin: '0px 0px 25% 0px', threshold: 0 }
  );

  let handoff = false;
  function register(el: HTMLElement) {
    if (tracked.has(el)) return;
    tracked.add(el);
    if (el.closest(SKIP)) return;
    const target = hashTarget();
    // Everything at or above a hash target must already be visible when the page scrolls there.
    if (
      target &&
      (el === target ||
        el.contains(target) ||
        target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
    )
      return;
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0) return; // already scrolled past (restored scroll position)
    if (settled && !handoff && inView(r)) return; // content swapped in by a user action appears at once
    if (el.dataset.reveal !== 'fade' && (el.matches(NO_TRANSFORM) || el.querySelector(NO_TRANSFORM)))
      el.dataset.reveal = 'fade';
    const kind = handoff ? 'handoff' : inView(r) && !settled ? 'enter' : 'scroll';
    el.dataset.revealKind = kind;
    el.dataset.revealState = 'wait';
    io.observe(el);
  }
  function scan(node: Node) {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(sel)) register(node);
    node.querySelectorAll<HTMLElement>(sel).forEach(register);
  }
  new MutationObserver((records) => {
    // Data arriving over a skeleton: the new content eases in instead of swapping in one frame.
    handoff = records.some((rec) =>
      [...rec.removedNodes].some((n) => n instanceof Element && (n.matches(SKEL) || !!n.querySelector(SKEL)))
    );
    for (const rec of records) rec.addedNodes.forEach(scan);
    handoff = false;
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document.body);
}

if ('IntersectionObserver' in window) start(); // reduced motion: CSS keeps opacity fades only
