import { useEffect, useRef, useState, type ReactNode } from "react";
import { href, type Route } from "../lib/router";
import { useRouteChange } from "../motion";
import { Cta } from "./Cta";
import { ReadoutSlot } from "./Readout";

type NavKey = "findings" | "explorer" | "method" | "live";

const NAV: { key: NavKey; label: string; to: string }[] = [
  { key: "findings", label: "Findings", to: href.findings },
  { key: "explorer", label: "Explorer", to: href.sessions() },
  { key: "method", label: "Method", to: href.method },
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
    <a href={href.landing} className="wordmark draw" aria-label="Energy/26, home">
      Energy<span className="text-accent">/</span>26
    </a>
  );
}

/*
 * Navbar, ported from the owner's MonarcPulse site (D29 addendum). Desktop (lg): fixed 64 px
 * bar, a 1200 px row; transparent over a hero (links white with mix-blend-difference) and
 * glass once the hero's bottom passes 64 px (HeroStage toggles `html.nav-clear` from a
 * ScrollTrigger); glass on every other route. Phones: a floating glass pill with a three-bar
 * button and a drop panel.
 */
function Header({ route }: { route: Route }) {
  const active = activeKey(route);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [route]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const links = NAV.map((n) => (
    <li key={n.key}>
      <a href={n.to} className="draw navlink" aria-current={active === n.key ? "page" : undefined}>
        {n.label}
      </a>
    </li>
  ));
  return (
    <header>
      <nav className="navd" aria-label="Primary">
        <div className="navd__row">
          <Wordmark />
          <div className="navd__right">
            <ul className="navd__links">{links}</ul>
            <Cta href={href.sessions()} size="sm">
              Open the explorer
            </Cta>
          </div>
        </div>
      </nav>
      <nav className="navm" aria-label="Primary, compact">
        <div className="navm__row">
          <Wordmark />
          <button
            ref={button}
            type="button"
            className={`navm__burger ${open ? "is-open" : ""}`}
            aria-expanded={open}
            aria-controls="navm-panel"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="sr-only">{open ? "Close the menu" : "Open the menu"}</span>
            <span className="navm__bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
        </div>
        <div id="navm-panel" className={`navm__panel ${open ? "is-open" : ""}`}>
          <ul className="navm__links">{links}</ul>
          <Cta href={href.sessions()} className="mt-6">
            Open the explorer
          </Cta>
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="finale">
      <div className="finale__in">
        <p className="finale__line">Estimates from public telemetry. Never measured battery data.</p>
        <ul className="finale__credits">
          <li>
            Timing and telemetry from{" "}
            <a className="link" href="https://openf1.org" target="_blank" rel="noreferrer">
              OpenF1
            </a>{" "}
            (CC BY-NC-SA 4.0), non-commercial. The site serves derived values only.
          </li>
          <li>Driver headshots and team logos load at runtime from their sources and remain their owners' property.</li>
          <li>Built on PRNDL, an unofficial student-made F1 design system, used with permission.</li>
          <li>Not affiliated with Formula 1, the FIA or FOM.</li>
        </ul>
      </div>
    </footer>
  );
}

export function Shell({ route, path, children }: { route: Route; path: string; children: ReactNode }) {
  const main = useRef<HTMLElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useRouteChange(path, main);
  return (
    <ReadoutSlot.Provider value={slot}>
      <div className="flex min-h-screen flex-col">
        {/* A button, not an anchor: "#main" would be read as a route by the hash router. */}
        <button type="button" onClick={() => main.current?.focus()} className="skip-link">
          Skip to content
        </button>
        <Header route={route} />
        <main id="main" ref={main} tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
        <Footer />
      </div>
      <div className="readout" ref={setSlot} />
      <div id="curtain" aria-hidden="true">
        <div className="curtain__panel" />
        <div className="curtain__line" />
      </div>
    </ReadoutSlot.Provider>
  );
}
