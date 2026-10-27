#!/usr/bin/env node
/*
 * Circuit reference data for the view: the official corner numbers, the broadcast map
 * orientation, a high-resolution centreline and the event name, per circuit, from the
 * MultiViewer circuits API (https://api.multiviewer.app/api/v1/circuits/{key}/{year}). Its
 * x/y frame is the one OpenF1's `location` feed uses (the F1 live-timing position frame), so
 * the view can draw this centreline as the road and place model distances from the API
 * outline on it (src/lib/track.ts).
 *
 * Usage: node scripts/gen-circuits.mjs [year] [apiBase]
 * Reads the circuit keys from the project API's /sessions, writes
 * src/content/circuits/index.json (names, flags, rounds, corner count, a thinned silhouette)
 * and src/content/circuits/<key>.json (corners and the full centreline). Reference data, not
 * telemetry: committed, regenerated when a circuit changes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const year = process.argv[2] ?? "2026";
const api = process.argv[3] ?? "http://localhost:8080";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "content", "circuits");

// IOC code (what MultiViewer returns) to ISO 3166-1 alpha-2 (what flag CDNs use).
const ISO2 = {
  AUS: "au", CHN: "cn", JPN: "jp", BRN: "bh", KSA: "sa", USA: "us", CAN: "ca", MON: "mc", ESP: "es",
  AUT: "at", GBR: "gb", BEL: "be", HUN: "hu", NED: "nl", ITA: "it", AZE: "az", SGP: "sg", MEX: "mx",
  BRA: "br", QAT: "qa", UAE: "ae", MAS: "my", FRA: "fr", GER: "de", POR: "pt", RUS: "ru", TUR: "tr",
  VIE: "vn", RSA: "za", ARG: "ar", KOR: "kr", IND: "in",
};

// Grand Prix names by IOC code, for circuits whose MultiViewer record has no meeting name
// (its meeting fields come from whichever season it last indexed, so they are not used for
// rounds or sponsor titles).
const GP = {
  AUS: "Australian", CHN: "Chinese", JPN: "Japanese", BRN: "Bahrain", KSA: "Saudi Arabian", CAN: "Canadian",
  MON: "Monaco", ESP: "Spanish", AUT: "Austrian", GBR: "British", BEL: "Belgian", HUN: "Hungarian", NED: "Dutch",
  ITA: "Italian", AZE: "Azerbaijan", SGP: "Singapore", MEX: "Mexico City", BRA: "São Paulo", QAT: "Qatar", UAE: "Abu Dhabi",
};
// Circuits MultiViewer does not have for this season: names only, no corners or centreline.
// The view falls back to the API outline for these.
const EXTRA = {
  12: { name: "Kuala Lumpur", location: "Sepang", country: "Malaysia", ioc: "MAS", iso2: "my", meeting_name: null },
  153: { name: "Madring", location: "Madrid", country: "Spain", ioc: "ESP", iso2: "es", meeting_name: null },
};

const sessions = await (await fetch(`${api}/api/sessions?size=1000`)).json();
const keys = [...new Set(sessions.items.map((s) => s.circuit_key).filter((k) => k !== null))].sort((a, b) => a - b);
await mkdir(out, { recursive: true });
const index = {};
for (const key of keys) {
  const res = await fetch(`https://api.multiviewer.app/api/v1/circuits/${key}/${year}`, { headers: { "User-Agent": "f1-battery view (reference data)" } });
  if (!res.ok) {
    console.error(`circuit ${key}: ${res.status}${EXTRA[key] ? " (using the hand-written entry)" : ""}`);
    if (EXTRA[key]) index[key] = { circuit_key: key, ...EXTRA[key], rotation: null, corners: 0, source: null, silhouette: null };
    continue;
  }
  const c = await res.json();
  const pts = c.x.map((x, i) => [Math.round(x), Math.round(c.y[i])]);
  const corners = c.corners.map((k) => ({ n: k.number, x: Math.round(k.trackPosition.x), y: Math.round(k.trackPosition.y), angle: k.angle, len: k.length }));
  const meta = {
    circuit_key: key,
    name: c.circuitName,
    location: c.location,
    country: c.countryName,
    ioc: c.countryIocCode,
    iso2: ISO2[c.countryIocCode] ?? null,
    meeting_name: c.meetingName ?? (GP[c.countryIocCode] ? `${GP[c.countryIocCode]} Grand Prix` : null),
    rotation: c.rotation,
    corners: corners.length,
    source: `https://api.multiviewer.app/api/v1/circuits/${key}/${year}`,
  };
  index[key] = { ...meta, silhouette: pts.filter((_, i) => i % 4 === 0) };
  await writeFile(join(out, `${key}.json`), JSON.stringify({ ...meta, corners, outline: pts }));
  console.log(`circuit ${key}: ${c.circuitName}, ${corners.length} corners, ${pts.length} points, rotation ${c.rotation}`);
  await new Promise((r) => setTimeout(r, 400));
}
await writeFile(join(out, "index.json"), JSON.stringify(index));
