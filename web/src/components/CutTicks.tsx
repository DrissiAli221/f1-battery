/*
 * An index row's straight before its speed profile exists: the distance axis of the main
 * straight with one tick per driver at his median cut-off (est.) and the session median drawn
 * taller. Estimates are drawn with their construction (DESIGN.md "Drawing rule"): the spread
 * of the drivers' ticks is the honest picture of the session. While the row loads, the axis
 * shimmers instead (the `.shimmer` skeleton), never an ellipsis.
 */
export function CutTicks({
  ticks,
  length,
  median,
  active = false,
  className = "",
}: {
  ticks: number[];
  length: number;
  median: number | null;
  active?: boolean;
  className?: string;
}) {
  const L = Math.max(1, length);
  const x = (m: number) => Math.max(0, Math.min(L, m));
  return (
    <svg
      className={`cutticks ${active ? "is-active" : ""} ${className}`}
      viewBox={`0 0 ${L} 32`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <line className="cutticks__axis" x1={0} x2={L} y1={30.5} y2={30.5} />
      {ticks.map((m, i) => (
        <line key={i} className="cutticks__t" x1={x(m)} x2={x(m)} y1={14} y2={30} />
      ))}
      {median !== null && <line className="cutticks__m" x1={x(median)} x2={x(median)} y1={2} y2={30} />}
    </svg>
  );
}
