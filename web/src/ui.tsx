import type { ReactNode } from "react";
import type { Remote } from "./api";

export function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {note && <p className="note">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Shared loading/error handling so each panel only renders its happy path and its empty state. */
export function Async<T>({ remote, children }: { remote: Remote<T>; children: (data: T) => ReactNode }) {
  if (remote.error) {
    return (
      <Empty title="Could not load this data">
        {remote.error.message} Check that the API is running and that VITE_API_BASE points at it.
      </Empty>
    );
  }
  if (!remote.data) return <div className="loading" role="status">Loading</div>;
  return <>{children(remote.data)}</>;
}

export const fmt = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined ? "n/a" : v.toFixed(digits);

export const label = (d: { name_acronym: string | null; driver_number: number }): string =>
  d.name_acronym ?? `#${d.driver_number}`;
