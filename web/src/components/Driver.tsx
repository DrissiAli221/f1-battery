import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { deepTeamColour, driverCode, driverName, headshot, teamColour, teamLogo } from "../lib/teams";
import type { Driver } from "../lib/types";

type DriverLike = Pick<Driver, "driver_number" | "name_acronym" | "team_colour" | "headshot_url" | "team_name"> &
  Partial<Pick<Driver, "first_name" | "last_name" | "full_name">>;

/** Circular headshot on the team colour; the three-letter code shows if the image fails. */
export function Avatar({ d, size = 36 }: { d: DriverLike; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = headshot(d.headshot_url, size > 60 ? "2col-retina" : size > 46 ? "2col" : "1col");
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full"
      style={{ width: size, height: size, background: deepTeamColour(d.team_colour), boxShadow: `inset 0 0 0 2px ${teamColour(d)}` }}
    >
      {(failed || !src) && (
        <span className="font-display text-[10px] font-bold text-white/70">{driverCode(d)}</span>
      )}
      {src && !failed && (
        <img src={src} alt="" decoding="async" className="absolute inset-0 h-full w-full object-cover object-top" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

export function TeamLogo({ team, size = 20 }: { team: string | null | undefined; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = teamLogo(team);
  if (!src || failed) return null;
  return <img src={src} alt="" width={size} height={size} loading="lazy" className="shrink-0 object-contain" onError={() => setFailed(true)} />;
}

/** PRNDL team-filled driver card with the headshot bleeding off the right edge. */
export function DriverCard({
  d,
  role,
  stat,
  action,
}: {
  d: Driver;
  role: "Selected" | "Compare";
  stat?: { label: string; value: ReactNode };
  action?: ReactNode;
}) {
  const bg = deepTeamColour(d.team_colour);
  const [failed, setFailed] = useState(false);
  const src = headshot(d.headshot_url, "2col-retina");
  return (
    <div className="relative h-[176px] overflow-hidden rounded-xs md:h-[196px]" style={{ background: bg }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(115deg, rgba(255,255,255,.09), transparent 45%)" }} />
      {src && !failed && (
        <img
          src={src}
          alt=""
          className="pointer-events-none absolute -right-2 bottom-0 h-[160px] w-[160px] object-cover object-top md:h-[184px] md:w-[184px]"
          onError={() => setFailed(true)}
        />
      )}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-[62%]" style={{ background: `linear-gradient(90deg, ${bg} 0%, transparent 50%)` }} />
      <div className="relative flex h-full flex-col p-4 text-white md:p-5">
        <div className="flex items-center gap-2">
          <span className={`badge ${role === "Selected" ? "badge-pink" : "badge-line"}`}>{role}</span>
          <span className="num text-[13px] font-semibold text-white/80">{d.driver_number}</span>
          <TeamLogo team={d.team_name} size={18} />
        </div>
        <div className="mt-2 font-display text-[28px] font-extrabold uppercase leading-none md:text-[32px]">{driverCode(d)}</div>
        <div className="mt-1 text-[13px] leading-tight text-white/85">
          {driverName(d)}
          <br />
          {d.team_name}
        </div>
        <div className="mt-auto flex items-end justify-between gap-3">
          {stat && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-white/75">{stat.label}</div>
              <div className="num text-[22px] font-medium leading-none">{stat.value}</div>
            </div>
          )}
          {action}
        </div>
      </div>
    </div>
  );
}

/**
 * Pill button that opens a grid of drivers. Drivers outside `enabled` are listed but greyed
 * (no model results), so the user sees why someone is missing.
 */
export function DriverPicker({
  drivers,
  value,
  onChange,
  enabled,
  label,
  allowNone,
  exclude,
  children,
}: {
  drivers: Driver[];
  value: number | null;
  onChange: (n: number | null) => void;
  enabled: Set<number>;
  label: string;
  allowNone?: boolean;
  exclude?: number | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const sorted = [...drivers].sort(
    (a, b) => (a.team_name ?? "").localeCompare(b.team_name ?? "") || a.driver_number - b.driver_number,
  );
  return (
    <div ref={box} className="relative">
      <button type="button" className="sel-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {children}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={label}
            className="absolute right-0 z-30 mt-3 w-[min(92vw,560px)] rounded-s border border-line bg-surface p-3 shadow-2xl shadow-black/50"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {allowNone && (
                <button
                  type="button"
                  role="option"
                  aria-selected={value === null}
                  className="flex h-12 items-center gap-3 rounded-xxs px-3 text-left text-[14px] font-semibold text-ink-2 hover:bg-white/5 aria-selected:bg-white/10"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  No comparison
                </button>
              )}
              {sorted
                .filter((d) => d.driver_number !== exclude)
                .map((d) => {
                  const ok = enabled.has(d.driver_number);
                  return (
                    <button
                      key={d.driver_number}
                      type="button"
                      role="option"
                      aria-selected={value === d.driver_number}
                      disabled={!ok}
                      title={ok ? undefined : "No model results for this driver in this session"}
                      className="flex h-12 items-center gap-3 rounded-xxs px-2 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35 aria-selected:bg-white/10"
                      onClick={() => {
                        onChange(d.driver_number);
                        setOpen(false);
                      }}
                    >
                      <span className="h-7 w-1 shrink-0 rounded-full" style={{ background: teamColour(d) }} />
                      <Avatar d={d} size={30} />
                      <span className="min-w-0">
                        <span className="block font-display text-[13px] font-bold uppercase leading-tight text-ink-head">{driverCode(d)}</span>
                        <span className="block truncate text-[12px] leading-tight text-ink-3">{d.team_name}</span>
                      </span>
                    </button>
                  );
                })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
