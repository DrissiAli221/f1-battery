import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "../components/Driver";
import { driverCode, driverName, teamColour } from "../lib/teams";
import type { Driver } from "../lib/types";

/*
 * The header's driver picker: the headshot on its team-colour ring and the three-letter code
 * (Orbitron, its one use on this page besides tower positions). It opens a plain list on
 * ground-2 with one hairline: no popover chrome. Arrow keys move through the list, Escape
 * closes it and returns focus to the button.
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
    <div ref={box} className="xp-pick" data-align={align}>
      <button
        ref={button}
        type="button"
        className="xp-pick__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sr-only">{label}: </span>
        {current ? (
          <>
            <Avatar d={current} size={44} />
            <span className="xp-pick__txt">
              <span className="xp-pick__code">{driverCode(current)}</span>
              <span className="xp-pick__name">{driverName(current)}</span>
            </span>
          </>
        ) : (
          <>
            <span className="xp-pick__empty" aria-hidden="true" />
            <span className="xp-pick__txt">
              <span className="xp-pick__add">Compare</span>
              <span className="xp-pick__name">add a driver</span>
            </span>
          </>
        )}
        <svg className="xp-pick__chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <ul ref={list} id={`${id}-list`} className="xp-pick__list" role="listbox" aria-label={label} onKeyDown={onListKey} data-lenis-prevent>
          {allowNone && (
            <li role="presentation">
              <button type="button" role="option" aria-selected={value === null} className="xp-pick__opt" onClick={() => pick(null)}>
                <span className="xp-pick__bar" style={{ background: "var(--line-strong)" }} />
                <span className="xp-pick__none">No comparison</span>
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
                  className="xp-pick__opt"
                  onClick={() => pick(d.driver_number)}
                >
                  <span className="xp-pick__bar" style={{ background: teamColour(d) }} />
                  <Avatar d={d} size={28} />
                  <span className="xp-pick__code xp-pick__code--s">{driverCode(d)}</span>
                  <span className="xp-pick__meta">
                    {driverName(d)}
                    {!ok && <span className="xp-pick__why">, no cut-off</span>}
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
