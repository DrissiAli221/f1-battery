// Builds web/src/content/findings.json from the outputs of
// model/f1battery_model/hypothesis_test.py (model/out/findings/), so the Findings and landing
// pages show the committed script's numbers rather than copied ones.
//
//   node web/scripts/gen-findings.mjs <run_id> <model_version>   (from the repo root, after the test has run)
//
// Only aggregates are written: odds ratios, counts, a 40-bin histogram of the permuted
// coefficients and the per-maker season table. No telemetry.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [runId, modelVersion] = process.argv.slice(2);
if (!runId || !modelVersion) {
  console.error("usage: node web/scripts/gen-findings.mjs <run_id> <model_version>");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "../../model/out/findings");
const out = resolve(here, "../src/content/findings.json");

const results = JSON.parse(readFileSync(resolve(dir, "results.json"), "utf8"));

function csv(name) {
  const [head, ...rows] = readFileSync(resolve(dir, name), "utf8").trim().split("\n");
  const cols = head.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i], v === "" ? null : isNaN(Number(v)) ? v : Number(v)])));
}

/** Reads a 1-D little-endian float64 .npy file. */
function npy(name) {
  const buf = readFileSync(resolve(dir, name));
  const headerLen = buf.readUInt16LE(8);
  const header = buf.subarray(10, 10 + headerLen).toString("latin1");
  if (!header.includes("'<f8'") || !header.includes("False")) throw new Error(`${name}: expected C-order <f8, got ${header}`);
  const data = buf.subarray(10 + headerLen);
  const view = new Float64Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return Array.from(view);
}

const round = (v, d = 4) => (v === null || v === undefined ? null : Number(v.toFixed(d)));

const point = csv("model_point.csv").map((r) => ({
  term: r.term,
  unit: r.unit,
  or: round(r.or_per_sd),
  lo: round(r.or_lo),
  hi: round(r.or_hi),
  p: r.p,
  sd: round(r.sd, 3),
}));

const perm = npy("perm_coefs.npy");
const bound = Math.max(...perm.map(Math.abs), Math.abs(results.permutation.observed)) * 1.02;
const BINS = 40;
const counts = new Array(BINS).fill(0);
for (const v of perm) counts[Math.min(BINS - 1, Math.floor(((v + bound) / (2 * bound)) * BINS))]++;

const runs = Object.fromEntries(Object.entries(results.runs).map(([k, v]) => [k, { or: round(v.or), lo: round(v.lo), hi: round(v.hi) }]));

const findings = {
  source: {
    script: "model/f1battery_model/hypothesis_test.py",
    run_id: runId,
    model_version: modelVersion,
  },
  verdict: results.verdict.verdict,
  min_sample_ok: results.verdict.min_sample_ok,
  perm_ok: results.verdict.perm_ok,
  per_run_pass: results.verdict.per_run,
  sample: {
    events_extracted: results.summary.events_before,
    non_events_extracted: results.summary.non_events_before,
    events_tested: results.summary.events_after,
    non_events_tested: results.summary.non_events_after,
    sessions_in_model: results.summary.sessions_in_model,
  },
  // OR per 1 SD *earlier* cut-off (the frozen direction), three runs over the median's CI.
  runs,
  // Full model at the point estimate; cut-off term is per 1 SD later cut-off here.
  terms: point,
  permutation: {
    observed: round(results.permutation.observed, 5),
    n: results.permutation.n_perm,
    p_two_sided: results.permutation.perm_p_two_sided,
    pct_abs: results.permutation.pct_abs,
    q95_abs: round(results.permutation.perm_abs_q95, 5),
    histogram: { lo: round(-bound, 5), hi: round(bound, 5), counts },
  },
  energy_terms_lr: {
    chi2: round(results.sens.lr_energy_vs_controls.stat, 3),
    df: results.sens.lr_energy_vs_controls.df,
    p: round(results.sens.lr_energy_vs_controls.p, 4),
  },
  makers: csv("maker_season.csv").map((r) => ({
    maker: r.maker,
    cells: r.cells,
    mean_offset_m: round(r.mean_offset_m, 1),
    sd_offset_m: round(r.sd_offset_m, 1),
    share_earliest: round(r.share_earliest, 3),
  })),
};

writeFileSync(out, JSON.stringify(findings, null, 2) + "\n");
console.log(`wrote ${out}`);
