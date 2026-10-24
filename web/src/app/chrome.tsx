import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';

export type SitePage = 'races' | 'replay' | 'findings' | 'method';

export function Mark() {
  return (
    <span className="wordmark-top" aria-hidden="true">
      F1
      <span className="wordmark-divider" />
      BATTERY
    </span>
  );
}

/** Grain and vignette: one fixed layer behind <main>'s content, before it in the DOM (z 0; <main> is z 1). */
export function Atmosphere() {
  return (
    <div className="atmosphere" aria-hidden="true">
      <div className="atmosphere-vignette" />
      <div className="atmosphere-grain" />
    </div>
  );
}

/**
 * The ground under <main>: it paints the page background (opaque, so the sticky footer stays hidden
 * until <main> scrolls away), then the atmosphere layer, then <main> itself. Pass the page's own
 * ground class (background) in `className`.
 */
export function PageGround({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`page-ground${className ? ` ${className}` : ''}`}>
      <Atmosphere />
      {children}
    </div>
  );
}

/**
 * The site header (wordmark, nav island, menu toggle). It owns the menu
 * state and the document-level input tracking: pointer-down outside closes the menu, Escape closes
 * it and returns focus to the toggle.
 */
export function SiteHeader({
  current,
  racesHref = '/#races',
  replayHref = '/replay.html',
  navId = `${current}-nav`,
}: {
  current: SitePage;
  racesHref?: string;
  replayHref?: string;
  navId?: string;
}) {
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  // The Escape handler reads the latest menu state through a ref, so it subscribes once.
  const menuOpen = useRef(menu);
  menuOpen.current = menu;
  useEffect(() => {
    const pointer = (e: PointerEvent) => {
      document.documentElement.dataset.input = 'pointer';
      if (!(e.target as Element).closest('.session-nav')) setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      document.documentElement.dataset.input = 'keyboard';
      if (e.key === 'Escape') {
        if (menuOpen.current) menuButton.current?.focus();
        setMenu(false);
      }
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key, true);
    };
  }, []);
  const link = (page: SitePage, href: string, label: string) =>
    current === page ? (
      <a href={href} aria-current="page" onClick={() => setMenu(false)}>
        {label}
      </a>
    ) : (
      <a href={href}>{label}</a>
    );
  return (
    <>
      <header
        className="site-header session-nav"
        onBlur={(e) => {
          if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setMenu(false);
        }}
      >
        <div className="masthead wrap project-header">
          <a className="project-wordmark" href="/" aria-label="F1 Battery home">
            <Mark />
          </a>
          <div className="nav-side">
            <button
              ref={menuButton}
              className="menu-toggle utility"
              aria-expanded={menu}
              aria-controls={navId}
              onClick={() => setMenu((v) => !v)}
            >
              Menu <span aria-hidden="true">{menu ? '×' : '+'}</span>
            </button>
            <nav id={navId} className={`nav-island ${menu ? 'is-open' : ''}`} aria-label="Main navigation">
              {link('races', racesHref, 'Races')}
              {link('replay', replayHref, 'Replay')}
              {link('findings', '/findings.html', 'Findings')}
              {link('method', '/method.html', 'Method')}
            </nav>
          </div>
        </div>
      </header>
    </>
  );
}

/** The site footer. `className` adds the page's own class; `notes` is the credits paragraph; the ref reaches the footer element. */
export const SiteFooter = forwardRef<
  HTMLElement,
  { className?: string; notes: ReactNode; top: { href: string; label: string } }
>(function SiteFooter({ className, notes, top }, ref) {
  return (
    <footer ref={ref} className={`session-footer${className ? ` ${className}` : ''}`}>
      <div className="wrap footer-inner">
        <a className="footer-mark" href="/" aria-label="F1 Battery home">
          <Mark />
        </a>
        <nav className="footer-route-links" aria-label="Footer navigation">
          <a href="/#races">Races</a>
          <a href="/replay.html">Replay</a>
          <a href="/findings.html">Findings</a>
          <a href="/method.html">Method</a>
        </nav>
        <div className="footer-bottom">
          <p>
            A private, non-commercial project.
            <br />
            Not affiliated with Formula 1, FIA or FOM.
          </p>
          <p>{notes}</p>
          <a href={top.href}>{top.label}</a>
        </div>
      </div>
    </footer>
  );
});
