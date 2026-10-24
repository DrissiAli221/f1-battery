import { useEffect, useState } from 'react';
import type { CircuitRef } from '../lib/track';
import index from '../content/circuits/index.json';

/** Circuit reference index: names, flags and silhouettes for every circuit in the data (D32). */
export interface CircuitMeta {
  circuit_key: number;
  name: string;
  location: string;
  country: string;
  ioc: string;
  iso2: string | null;
  meeting_name: string | null;
  rotation: number | null;
  corners: number;
  source: string | null;
  /** Every fourth centreline point, for small silhouettes; null when not available. */
  silhouette: [number, number][] | null;
}

const META = index as unknown as Record<string, CircuitMeta>;

export function circuitMeta(circuitKey: number | null | undefined): CircuitMeta | null {
  return circuitKey === null || circuitKey === undefined ? null : (META[String(circuitKey)] ?? null);
}

/** The event's name for headers: the Grand Prix when known, else the circuit's short name. */
export function eventName(
  circuitKey: number | null | undefined,
  fallback: string | null | undefined
): string {
  return circuitMeta(circuitKey)?.meeting_name ?? fallback ?? 'Session';
}

/** Flag image by ISO 3166-1 alpha-2 (flagcdn.com, free with a backlink; credited in the footer). */
export function flagUrl(iso2: string | null | undefined, w: 20 | 40 | 80 | 160 = 80): string | null {
  return iso2 ? `https://flagcdn.com/w${w}/${iso2}.png` : null;
}

// formula1.com race-hub header photographs (16x9), by circuit, for page heroes. Undocumented
// media paths; each one was checked to resolve on 2026-10-20. Missing circuits get no photo.
const PHOTO: Record<number, string> = {
  2: 'Great%20Britain',
  4: 'Hungary',
  7: 'Belgium',
  10: 'Australia',
  15: 'Spain',
  19: 'Austria',
  22: 'Monaco',
  23: 'Canada',
  39: 'Italy',
  46: 'Japan',
  49: 'China',
  55: 'Netherlands',
  61: 'Singapore',
  63: 'Bahrain',
  144: 'Azerbaijan',
  149: 'Saudi_Arabia',
  151: 'Miami',
};

// Race-day photographs from formula1.com (Getty / trackside), by circuit, preferred over the
// generic race-hub header when known. Checked to resolve on 2026-10-22.
const RACE_PHOTO: Record<number, string> = {
  61: 'fom-website/2026/Singapore/GettyImages-2299662779.webp', // Verstappen, race day, 11 Oct 2026
};

/** The best hero photograph for a circuit: a race-day shot when known, else the race-hub header. */
export function circuitHero(circuitKey: number | null | undefined, w = 2400): string | null {
  const r = circuitKey === null || circuitKey === undefined ? undefined : RACE_PHOTO[circuitKey];
  return r
    ? `https://media.formula1.com/image/upload/c_fill,w_${w}/q_auto/v1740000001/${r}`
    : circuitPhoto(circuitKey);
}

/** A photograph of the venue for hero use, or null. */
export function circuitPhoto(circuitKey: number | null | undefined): string | null {
  const n = circuitKey === null || circuitKey === undefined ? undefined : PHOTO[circuitKey];
  return n
    ? `https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Racehub%20header%20images%2016x9/${n}.webp`
    : null;
}

const FILES = import.meta.glob<{ default: CircuitRef }>('../content/circuits/*.json');

const cache = new Map<number, Promise<CircuitRef | null>>();

/** The full reference (corners and centreline) for a circuit, loaded once per key. */
export function loadCircuit(circuitKey: number): Promise<CircuitRef | null> {
  let p = cache.get(circuitKey);
  if (!p) {
    const loader = FILES[`../content/circuits/${circuitKey}.json`];
    const meta = circuitMeta(circuitKey);
    p = loader
      ? loader().then((m) => m.default)
      : Promise.resolve(meta ? { ...meta, corners: [], outline: null } : null);
    cache.set(circuitKey, p);
  }
  return p;
}

export function useCircuit(circuitKey: number | null | undefined): CircuitRef | null {
  const [ref, setRef] = useState<CircuitRef | null>(null);
  useEffect(() => {
    let live = true;
    setRef(null);
    if (circuitKey === null || circuitKey === undefined) return;
    loadCircuit(circuitKey).then((r) => {
      if (live) setRef(r);
    });
    return () => {
      live = false;
    };
  }, [circuitKey]);
  return ref;
}
