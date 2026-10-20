import { useMemo } from "react";
import { useList, useRemote, url } from "../lib/api";
import { useQueryState } from "../lib/router";
import { trackStraights, lapLength } from "../lib/track";
import type { Outline, Straight } from "../lib/types";
import { TrackMap } from "../track/TrackMap";
import { useCircuit } from "../track/circuits";

/** DEV only: the track map on one circuit, for checking orientation and placement. ?circuit=39&rot=95 */
export function DevMapPage() {
  const [query] = useQueryState();
  const circuitKey = Number(query.get("circuit") ?? 39);
  const rot = query.get("rot");
  const outline = useRemote<Outline>(url(`/circuits/${circuitKey}/outline`));
  const straights = useList<Straight>(`/circuits/${circuitKey}/straights`);
  const circuit = useCircuit(circuitKey);
  const lap = outline.data ? lapLength(outline.data) : 0;
  const ts = useMemo(() => (straights.data && lap ? trackStraights(straights.data, lap) : []), [straights.data, lap]);
  if (!outline.data) return <div className="p-10">loading</div>;
  const tags = [
    { id: 1, code: "NOR", colour: "#F47600", d: lap * 0.1, on: true },
    { id: 2, code: "LEC", colour: "#ED1131", d: lap * 0.12 },
    { id: 3, code: "RUS", colour: "#00D7B6", d: lap * 0.5 },
    { id: 4, code: "VER", colour: "#4781D7", d: lap * 0.52 },
    { id: 5, code: "HAM", colour: "#ED1131", d: lap * 0.53 },
  ];
  const runs = [
    { d0: lap * 0.0, d1: lap * 0.1, colour: "var(--regime-deploy)" },
    { d0: lap * 0.1, d1: lap * 0.14, colour: "var(--regime-plateau)" },
    { d0: lap * 0.14, d1: lap * 0.16, colour: "var(--regime-brake)" },
    { d0: lap * 0.16, d1: lap * 0.3, colour: "var(--regime-deploy)" },
    { d0: lap * 0.3, d1: lap * 0.33, colour: "var(--regime-lift)" },
  ];
  return (
    <div className="mx-auto max-w-container px-gutter pt-24">
      <p className="mb-4 font-mono text-[12px] text-muted">
        circuit {circuitKey} · {circuit?.name ?? "no ref"} · rotation {circuit?.rotation ?? "n/a"} · {circuit?.corners.length ?? 0} corners · {circuit?.outline?.length ?? 0} ref points
      </p>
      <div className="h-[640px] rounded-l border border-line bg-surface-1">
        <TrackMap
          outline={outline.data}
          circuit={circuit}
          straights={ts}
          selected={ts[0]?.straight_id ?? null}
          onSelect={() => {}}
          runs={runs}
          tags={tags}
          ticks={[{ id: "t", d: lap * 0.08, lo: lap * 0.075, hi: lap * 0.086, colour: "#fff", on: true }]}
          rotation={rot !== null ? Number(rot) : undefined}
          straightLabels
        />
      </div>
    </div>
  );
}
