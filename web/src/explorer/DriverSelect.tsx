import { useEffect, useId, useRef, useState } from "react";
import { deepTeamColour, driverCode, driverName, headshotHd, teamColour } from "../lib/teams";
import type { Driver } from "../lib/types";

/** The driver's photo on the deep team colour (formula1.com headshot), or the code if it fails. */
function Face({ d, size }: { d: Driver; size: number }) {
  const [failed, setFailed] = useState(false);
  const src = headshotHd(d, size * 2);
  return (
    <span className="dsel__face" style={{ width: size, height: size, background: deepTeamColour(d.team_colour) }}>
      {src && !failed ? <img src={src} alt="" decoding="async" onError={() => setFailed(true)} /> : <span>{driverCode(d)}</span>}
    </span>
  );
}

/*
 * The header's driver picker, a broadcast input: surface-3, the team bar at its left edge, the
 * driver's photo, the code in Titillium and the name. It opens a list card on surface-3.
 * Arrow keys move through the list, Escape closes it and returns focus to the button.
 */
export function DriverSelect({
  drivers,
  value,
  onChange,
  enabled,
  label,
  allowNone = false,
  exclude = null,
  align = "right",
}: {
  drivers: Driver[];
  value: number | null;
  onChange: (n: number | null) => void;
  enabled: Set<number>;
  /** Accessible name, e.g. "Driver" or "Compare with". */
  label: string;
  allowNone?: boolean;
  exclude?: number | null;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = drivers.find((d) => d.driver_number === value) ?? null;

  const sorted = [...drivers]
    .filter((d) => d.driver_number !== exclude)
    .sort((a, b) => Number(enabled.has(b.driver_number)) - Number(enabled.has(a.driver_number)) || (a.team_name ?? "").localeCompare(b.team_name ?? "") || a.driver_number - b.driver_number);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    // Focus the selected option (or the first) when the list opens.
    const opts = list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    const sel = list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)');
    (sel ?? opts?.[0])?.focus({ preventScroll: true });
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const opts = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = opts.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = Math.min(opts.length - 1, i + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, i - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = opts.length - 1;
    else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      close(e.key === "Escape");
      return;
    }
    if (next === null) return;
    e.preventDefault();
    opts[next]?.focus();
  };

  const pick = (n: number | null) => {
    onChange(n);
    close();
  };

  return (
    <div ref={box} className="dsel" data-align={align} style={{ ["--team" as string]: current ? teamColour(current) : "var(--line-2)" }}>
      <span className="dsel__label label" aria-hidden="true">
        {label}
      </span>
      <button
        ref={button}
        type="button"
        className="dsel__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sr-only">{label}: </span>
        <i className="dsel__bar" aria-hidden="true" />
        {current ? (
          <>
            <Face d={current} size={36} />
            <span className="dsel__txt">
              <span className="dsel__code">{driverCode(current)}</span>
              <span className="dsel__name">{driverName(current)}</span>
            </span>
          </>
        ) : (
          <>
            <span className="dsel__face dsel__face--empty" style={{ width: 36, height: 36 }} aria-hidden="true">
              +
            </span>
            <span className="dsel__txt">
              <span className="dsel__code dsel__code--muted">{allowNone ? "None" : "Driver"}</span>
              <span className="dsel__name">{allowNone ? "add a driver" : "choose"}</span>
            </span>
          </>
        )}
        <svg className="dsel__chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <ul ref={list} id={`${id}-list`} className="dsel__list" role="listbox" aria-label={label} onKeyDown={onListKey} data-lenis-prevent>
          {allowNone && (
            <li role="presentation">
              <button type="button" role="option" aria-selected={value === null} className="dsel__opt" onClick={() => pick(null)}>
                <span className="dsel__obar" style={{ background: "var(--line-strong)" }} />
                <span className="dsel__none">No comparison</span>
              </button>
            </li>
          )}
          {sorted.map((d) => {
            const ok = enabled.has(d.driver_number);
            return (
              <li key={d.driver_number} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={value === d.driver_number}
                  disabled={!ok}
                  className="dsel__opt"
                  onClick={() => pick(d.driver_number)}
                >
                  <span className="dsel__obar" style={{ background: teamColour(d) }} />
                  <Face d={d} size={28} />
                  <span className="dsel__ocode">{driverCode(d)}</span>
                  <span className="dsel__meta">
                    {driverName(d)}
                    {!ok && <span className="dsel__why"> · no cut-off</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
