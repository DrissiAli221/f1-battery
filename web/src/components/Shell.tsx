import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { href, type Route } from "../lib/router";

type NavKey = "findings" | "explorer" | "method" | "live";

const NAV: { key: NavKey; label: string; to: string }[] = [
  { key: "findings", label: "Findings", to: href.findings },
  { key: "explorer", label: "Explorer", to: href.sessions() },
  { key: "method", label: "Method log", to: href.method },
  { key: "live", label: "Live", to: href.live() },
];

function activeKey(route: Route): NavKey | null {
  switch (route.name) {
    case "findings":
      return "findings";
    case "sessions":
    case "session":
      return "explorer";
    case "method":
      return "method";
    case "live":
      return "live";
    default:
      return null;
  }
}

export function Wordmark() {
  return (
    <a href={href.landing} className="relative flex items-center gap-3" aria-label="Energy/26, home">
      <span className="slash h-5" aria-hidden="true">
        <i className="w-2 bg-brand" />
        <i className="w-1 bg-ink-head" />
      </span>
      <span className="font-display text-[17px] font-extrabold uppercase tracking-[0.04em] text-ink-head">
        Energy<span className="text-brand">/</span>26
      </span>
    </a>
  );
}

function Header({ route }: { route: Route }) {
  const [open, setOpen] = useState(false);
  const active = activeKey(route);
  useEffect(() => setOpen(false), [route]);
  const cta = route.name === "landing" ? { label: "Open the explorer", to: href.sessions() } : { label: "Sessions", to: href.sessions() };
  return (
    <header className="sticky top-0 z-40 h-header border-b border-line-2 bg-surface/90 backdrop-blur">
      <nav className="wrap relative flex h-full items-center justify-between" aria-label="Primary">
        <div className="livery hidden lg:flex" style={{ right: 260 }} aria-hidden="true">
          <i style={{ width: 22 }} />
          <i style={{ width: 8, opacity: 0.7 }} />
          <i style={{ width: 4, opacity: 0.5, marginLeft: 18 }} />
          <i style={{ width: 34, marginLeft: 26 }} />
          <i style={{ width: 12, opacity: 0.6 }} />
        </div>
        <Wordmark />
        <div className="hidden h-full items-stretch gap-2 md:flex">
          {NAV.map((n) => (
            <a
              key={n.key}
              href={n.to}
              aria-current={active === n.key ? "page" : undefined}
              className={`relative flex items-center px-3 text-[15px] transition-colors ${
                active === n.key ? "font-bold text-ink-head" : "font-medium text-ink-2 hover:text-ink-head"
              }`}
            >
              {n.label}
              {active === n.key && <span className="absolute inset-x-3 bottom-0 h-[3px] bg-brand" />}
            </a>
          ))}
        </div>
        <a href={cta.to} className="btn btn-secondary btn-sm relative hidden md:inline-flex">
          {cta.label}
        </a>
        <button
          type="button"
          className="relative grid h-10 w-10 place-items-center rounded-full shadow-[inset_0_0_0_2px_var(--line)] md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="menu-sheet"
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
          </svg>
        </button>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div
            id="menu-sheet"
            className="absolute inset-x-0 top-header border-b border-line bg-surface px-4 pb-6 pt-2 md:hidden"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {NAV.map((n) => (
              <a key={n.key} href={n.to} className="block border-b border-line py-4 font-display text-[18px] font-bold uppercase">
                {n.label}
              </a>
            ))}
            <a href={cta.to} className="btn btn-primary mt-6">
              {cta.label}
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-line-2 bg-surface">
      <div className="wrap py-16 md:py-20">
        <div className="mb-14 flex items-start gap-3 rounded-xs bg-warn px-5 py-4 text-[15px] font-semibold text-[var(--color-text-on-color-inverse)]">
          <svg className="mt-0.5 shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 3l10 18H2L12 3zM12 10v5M12 18v.5" />
          </svg>
          Estimates derived from public telemetry, not measured battery data.
        </div>
        <div className="grid gap-10 text-[14px] leading-relaxed text-ink-3 md:grid-cols-4">
          <div>
            <Wordmark />
            <p className="mt-4">Not affiliated with Formula 1, the FIA or FOM.</p>
          </div>
          <div>
            <p className="label mb-3">Data</p>
            <p>
              Timing and telemetry from{" "}
              <a className="prose-link" href="https://openf1.org" target="_blank" rel="noreferrer">
                OpenF1
              </a>{" "}
              (CC BY-NC-SA 4.0), non-commercial. The site serves derived values only.
            </p>
          </div>
          <div>
            <p className="label mb-3">Images</p>
            <p>
              Driver headshots and team logos load at runtime from the Formula 1 media CDN via OpenF1's{" "}
              <code className="num text-[13px]">headshot_url</code>; they remain the property of their owners.
            </p>
          </div>
          <div>
            <p className="label mb-3">Design</p>
            <p>
              UI based on PRNDL, an unofficial student-made F1 design system (Figma Community), used with permission.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* A button, not an anchor: "#main" would be read as a route by the hash router. */}
      <button
        type="button"
        onClick={() => document.getElementById("main")?.focus()}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xxs focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </button>
      <Header route={route} />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <Footer />
    </div>
  );
}
