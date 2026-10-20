import type { CSSProperties, ReactNode } from "react";
import { flagUrl } from "../track/circuits";
import "../styles/system.css";

/*
 * The system primitives (DESIGN.md v3): surfaces, tabs, chips, pills, stats, flags. Pure
 * presentation; pages compose them. Every colour is a token, team colours arrive as a prop.
 */

/** A raised surface: the card. `inset` draws the deeper panel tone for areas inside a card. */
export function Card({ children, className = "", inset = false, as: As = "div", style }: { children: ReactNode; className?: string; inset?: boolean; as?: "div" | "section" | "article" | "aside"; style?: CSSProperties }) {
  return (
    <As className={`card ${inset ? "card--inset" : ""} ${className}`} style={style}>
      {children}
    </As>
  );
}

/** A card's header row: title left, actions or a value right. */
export function CardHead({ title, aside, className = "" }: { title: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={`card__head ${className}`}>
      <div className="card__title">{title}</div>
      {aside && <div className="card__aside">{aside}</div>}
    </div>
  );
}

/** Broadcast tabs: uppercase labels, the active one underlined in red. */
export function Tabs<T extends string>({ items, value, onChange, label = "View", className = "" }: { items: { key: T; label: ReactNode; count?: number | string }[]; value: T; onChange: (k: T) => void; label?: string; className?: string }) {
  return (
    <div className={`tabs ${className}`} role="tablist" aria-label={label}>
      {items.map((it) => (
        <button key={it.key} type="button" role="tab" aria-selected={it.key === value} className={`tab ${it.key === value ? "is-on" : ""}`} onClick={() => onChange(it.key)}>
          {it.label}
          {it.count !== undefined && <span className="tab__count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A small uppercase label (eyebrows, column heads, map captions). */
export function Label({ children, className = "", as: As = "span" }: { children: ReactNode; className?: string; as?: "span" | "p" | "div" | "th" }) {
  return <As className={`label ${className}`}>{children}</As>;
}

/** The team-colour driver chip: the code on the colour, as on the map. */
export function Chip({ code, colour, on = false, dim = false, className = "" }: { code: string; colour: string; on?: boolean; dim?: boolean; className?: string }) {
  return (
    <span className={`chip ${on ? "is-on" : ""} ${dim ? "is-dim" : ""} ${className}`} style={{ ["--team" as string]: colour }}>
      {code}
    </span>
  );
}

export type PillTone = "neutral" | "good" | "bad" | "warn" | "best" | "accent" | "live";

/** A status pill: pass/fail, green/neutralised, live, best. Tone carries meaning; the label says it too. */
export function Pill({ children, tone = "neutral", className = "", dot = false }: { children: ReactNode; tone?: PillTone; className?: string; dot?: boolean }) {
  return (
    <span className={`pill pill--${tone} ${className}`}>
      {dot && <i className="pill__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** A big number with its label and unit; estimates say so in the label. */
export function Stat({ value, label, unit, note, size = "md", className = "" }: { value: ReactNode; label: ReactNode; unit?: ReactNode; note?: ReactNode; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <div className={`stat stat--${size} ${className}`}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">
        {value}
        {unit && <span className="stat__unit">{unit}</span>}
      </div>
      {note && <div className="stat__note">{note}</div>}
    </div>
  );
}

/** A country flag (flagcdn.com, credited in the footer). Renders nothing without a code. */
export function Flag({ iso2, title, size = 40, className = "" }: { iso2: string | null | undefined; title?: string; size?: 20 | 40 | 80 | 160; className?: string }) {
  const src = flagUrl(iso2, size);
  if (!src) return null;
  return <img className={`flag ${className}`} src={src} srcSet={`${flagUrl(iso2, size === 160 ? 160 : size === 80 ? 160 : size === 40 ? 80 : 40)} 2x`} alt={title ?? ""} loading="lazy" decoding="async" />;
}

/** The team colour bar at a row's left edge. */
export function TeamBar({ colour, className = "" }: { colour: string; className?: string }) {
  return <i className={`teambar ${className}`} style={{ background: colour }} aria-hidden="true" />;
}

/** A hairline rule with optional centred text. */
export function Rule({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <div className={`rule ${className}`} role="presentation">
      {children && <span>{children}</span>}
    </div>
  );
}

/** Section header: a title with an optional label above and a short paragraph beside it. */
export function SectionHead({ label, title, children, aside, className = "" }: { label?: ReactNode; title: ReactNode; children?: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={`shead ${className}`}>
      <div className="shead__main">
        {label && <Label as="p" className="shead__label">{label}</Label>}
        <h2 className="shead__title">{title}</h2>
        {children && <div className="shead__copy">{children}</div>}
      </div>
      {aside && <div className="shead__aside">{aside}</div>}
    </div>
  );
}

/** A skeleton block while data loads: a shimmer on the surface tone. */
export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={`skel ${className}`} style={style} aria-hidden="true" />;
}
