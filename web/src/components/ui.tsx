import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Remote } from "../lib/api";

/** Uppercase eyebrow with the red double rule (PRNDL section heading). */
export function Eyebrow({ children, rule = true }: { children: ReactNode; rule?: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <span className="cap min-w-0">{children}</span>
      {rule && <span className="stripe-rule hidden max-w-[180px] sm:block" aria-hidden="true" />}
    </div>
  );
}

export function SectionHead({
  eyebrow,
  title,
  aside,
  full,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  aside?: ReactNode;
  /** Use the whole width for the title (when the head already sits in a narrow column). */
  full?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="mb-10 grid gap-6 md:mb-14 lg:grid-cols-12 lg:items-end">
      <div className={full ? "lg:col-span-12" : "lg:col-span-7"}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="h-section mt-4">{title}</h2>
        {children && <div className="mt-5 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">{children}</div>}
      </div>
      {aside && <div className="lg:col-span-5 lg:justify-self-end">{aside}</div>}
    </div>
  );
}

/** Fades content in once when it scrolls into view. Entrance only, no looping motion. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xs border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold text-ink-head">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-[56ch] text-[14px] text-ink-3">{children}</p>}
    </div>
  );
}

export function Loading({ label = "Loading", className = "h-40" }: { label?: string; className?: string }) {
  return (
    <div className={`grid place-items-center ${className}`} role="status">
      <span className="flex items-center gap-3 text-[14px] text-ink-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

export function ErrorNote({ error }: { error: Error }) {
  return (
    <Empty title="Could not load this data">
      {error.message} Check that the API is running and that VITE_API_BASE points at it.
    </Empty>
  );
}

/** Loading and error handling in one place, so callers only render the happy path. */
export function Async<T>({
  remote,
  children,
  loading,
}: {
  remote: Remote<T>;
  children: (data: T) => ReactNode;
  loading?: ReactNode;
}) {
  if (remote.error) return <ErrorNote error={remote.error} />;
  if (remote.data === null) return <>{loading ?? <Loading />}</>;
  return <>{children(remote.data)}</>;
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
