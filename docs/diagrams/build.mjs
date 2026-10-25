// Builds the README banner and diagrams in the f1-battery theme (dark and light).
// Plain Node, no dependencies: `node docs/diagrams/build.mjs` writes <name>-dark.svg and <name>-light.svg here.
// Output is deterministic. No external references, scripts or foreignObject; fonts are named with fallbacks only.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SANS = "Geist, Archivo, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const P = {
  dark: {
    dark: true, g0: "#111110", g1: "#060606", ink: "#f4f4ef", mute: "#8a8a84", red: "#ff4d44", redDeep: "#e10600",
    hair: "rgba(255,255,255,0.08)", hair2: "rgba(255,255,255,0.16)", card: "#0e0e0d", cardTop: "#fff", sheen: 0.045,
    shadow: 0.55, dot: 0.9, bloom: 0.5, fillInk: 0.07,
  },
  light: {
    dark: false, g0: "#fbfbf8", g1: "#f4f4ef", ink: "#090909", mute: "#6b6b66", red: "#e10600", redDeep: "#e10600",
    hair: "rgba(0,0,0,0.10)", hair2: "rgba(0,0,0,0.20)", card: "#fcfcfa", cardTop: "#fff", sheen: 0,
    shadow: 0.08, dot: 0.75, bloom: 0.22, fillInk: 0.06,
  },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v) => Math.round(v * 100) / 100;
const mono = (c, size = 11, extra = "") => `font-family="${MONO}" font-size="${size}" letter-spacing="1.2" fill="${c}" ${extra}`;
const label = (P_, x, y, s, { c, size = 11, anchor = "start", extra = "" } = {}) =>
  `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" ${mono(c ?? P_.mute, size, extra)}>${esc(s.toUpperCase())}</text>`;
const sans = (P_, x, y, s, { c, size = 16, w = 700, anchor = "start", ls = 0 } = {}) =>
  `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-family="${SANS}" font-size="${size}" font-weight="${w}" letter-spacing="${ls}" fill="${c ?? P_.ink}">${esc(s)}</text>`;

function defs(Pl) {
  return `<defs>
    <radialGradient id="ground" cx="0.72" cy="0.3" r="0.95">
      <stop offset="0" stop-color="${Pl.g0}"/><stop offset="1" stop-color="${Pl.g1}"/>
    </radialGradient>
    <radialGradient id="bloom" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#e10600" stop-opacity="${Pl.bloom}"/>
      <stop offset="0.55" stop-color="#e10600" stop-opacity="${Pl.bloom * 0.35}"/>
      <stop offset="1" stop-color="#e10600" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${Pl.cardTop}" stop-opacity="${Pl.sheen}"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <filter id="card" x="-10%" y="-10%" width="120%" height="135%">
      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="${Pl.shadow * 0.8}"/>
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity="${Pl.shadow * 0.5}"/>
    </filter>
    <marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M1 1.2 L8.8 5 L1 8.8 Z" fill="${Pl.mute}"/>
    </marker>
    <marker id="arrowRed" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M1 1.2 L8.8 5 L1 8.8 Z" fill="${Pl.red}"/>
    </marker>
    <pattern id="dots" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.15" fill="${Pl.ink}" fill-opacity="0.32"/></pattern>
  </defs>`;
}

function frame(Pl, w, h, body, title, desc) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d">
  <title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
  ${defs(Pl)}
  <rect width="${w}" height="${h}" rx="20" fill="url(#ground)"/>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="19.5" fill="none" stroke="${Pl.hair}"/>
  ${body}
</svg>
`;
}

// Halftone screen: a dot grid whose radius fades elliptically to nothing before any edge.
function halftone(Pl, cx, cy, rx, ry, { step = 11, max = 4.4, color = "#e10600" } = {}) {
  let s = `<g fill="${color}" fill-opacity="${Pl.dot}">`;
  let row = 0;
  for (let y = cy - ry; y <= cy + ry; y += step * 0.866, row++) {
    for (let x = cx - rx + (row % 2 ? step / 2 : 0); x <= cx + rx; x += step) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d >= 1) continue;
      const r = max * Math.pow(1 - d, 1.25);
      if (r < 0.45) continue;
      s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}"/>`;
    }
  }
  return s + "</g>";
}

function card(Pl, x, y, w, h, { title, kind, subs = [], accent = false, dashed = false, r = 12 }) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${Pl.card}"${dashed ? "" : ' filter="url(#card)"'}/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#sheen)"/>
  <rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${r - 0.5}" fill="none" stroke="${dashed ? Pl.hair2 : Pl.hair}"${dashed ? ' stroke-dasharray="5 5"' : ""}/>`;
  if (accent) s += `<path d="M${x + 14} ${y + 0.5} H${x + 46}" stroke="${Pl.red}" stroke-width="2" stroke-linecap="round"/>`;
  s += label(Pl, x + 14, y + 24, kind, { size: 9.5 });
  s += sans(Pl, x + 14, y + 48, title, { size: 16 });
  subs.forEach((t, i) => (s += `<text x="${x + 14}" y="${y + 70 + i * 17}" ${mono(Pl.mute, 10.5, 'letter-spacing="0.2"').replace('letter-spacing="1.2" ', "")}>${esc(t)}</text>`));
  return s;
}

const arrow = (Pl, d, { red = false, dashed = false } = {}) =>
  `<path d="${d}" fill="none" stroke="${red ? Pl.red : Pl.mute}" stroke-width="1.5" ${dashed ? 'stroke-dasharray="5 5" ' : ""}marker-end="url(#${red ? "arrowRed" : "arrow"})"/>`;

// ---------- 1. banner ----------
function bannerBody(Pl) {
  const circuits = { 39: JSON.parse(readFileSync(join(here, "monza-silhouette.json"), "utf8")) };
  const pts = circuits[39].points; // Monza
  // Rotate the silhouette to the most landscape orientation (the site rotates, then lays circuits out landscape).
  let best = null;
  for (let a = 0; a < 180; a += 1) {
    const t = (a * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const q = pts.map(([x, y]) => [x * c - y * s, -(x * s + y * c)]);
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    const ratio = (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
    if (!best || ratio > best.ratio) best = { ratio, q };
  }
  const xs = best.q.map((p) => p[0]), ys = best.q.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const k = Math.min(380 / (Math.max(...xs) - x0), 190 / (Math.max(...ys) - y0));
  const ox = 790, oy = 105;
  const P2 = best.q.map(([x, y]) => [ox + (x - x0) * k, oy + (y - y0) * k]);
  const d = "M" + P2.map(([x, y]) => `${n(x)} ${n(y)}`).join(" L") + " Z";
  // The longest near-straight run of points is drawn in red: where a cut-off would be looked for.
  let bi = 0, bl = 0;
  for (let i = 0; i < P2.length; i++) {
    const a = P2[i], b = P2[(i + 6) % P2.length];
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
    let path = 0;
    for (let j = 0; j < 6; j++) { const u = P2[(i + j) % P2.length], v = P2[(i + j + 1) % P2.length]; path += Math.hypot(u[0] - v[0], u[1] - v[1]); }
    if (len / path > 0.995 && len > bl) { bl = len; bi = i; }
  }
  const seg = Array.from({ length: 7 }, (_, j) => P2[(bi + j) % P2.length]);
  const sd = "M" + seg.map(([x, y]) => `${n(x)} ${n(y)}`).join(" L");
  return `
  <ellipse cx="985" cy="200" rx="330" ry="260" fill="url(#bloom)"/>
  ${halftone(Pl, 985, 200, 300, 175)}
  <path d="${d}" fill="none" stroke="${Pl.g1}" stroke-opacity="0.55" stroke-width="9" stroke-linejoin="round"/>
  <path d="${d}" fill="none" stroke="${Pl.ink}" stroke-width="3" stroke-linejoin="round"/>
  <path d="${sd}" fill="none" stroke="${Pl.red}" stroke-width="4.5" stroke-linecap="round"/>
  <circle cx="${n(seg[6][0])}" cy="${n(seg[6][1])}" r="5" fill="${Pl.g1}" stroke="${Pl.red}" stroke-width="2"/>
  <path d="M0 62 H1280" stroke="${Pl.hair}"/>
  ${label(Pl, 56, 40, "2026 season · public telemetry · OpenF1", { size: 11 })}
  ${label(Pl, 1224, 40, "Monza · longest straight marked", { size: 11, anchor: "end" })}
  ${sans(Pl, 52, 175, "F1 BATTERY", { size: 92, w: 900, ls: -3 })}
  ${sans(Pl, 56, 225, "Where does electrical deployment end on a straight?", { size: 25, w: 600 })}
  ${sans(Pl, 56, 258, "Estimated from public speed, throttle and position telemetry,", { size: 16, w: 400, c: Pl.mute })}
  ${sans(Pl, 56, 280, "then tested against real overtakes.", { size: 16, w: 400, c: Pl.mute })}
  <rect x="56" y="318" width="270" height="30" rx="15" fill="none" stroke="${Pl.red}" stroke-opacity="0.7"/>
  ${label(Pl, 191, 338, "Estimates, not measurements", { c: Pl.red, size: 11, anchor: "middle" })}
  ${label(Pl, 346, 338, "Pre-registered · verdict: no detectable effect", { size: 10.5 })}`;
}

// ---------- 2. pipeline ----------
function pipelineBody(Pl) {
  const W = 150, G = 30, X0 = 25, Y = 110, H = 118;
  const main = [
    { kind: "Source", title: "OpenF1", subs: ["free tier", "3 req/s, 30/min", "non-commercial"] },
    { kind: "Java 21 · Spring", title: "Ingest", subs: ["local backup | API", "idempotent upsert", "resumable log"] },
    { kind: "Store", title: "Postgres 16", subs: ["+ TimescaleDB", "Flyway migrations", "127.0.0.1:55432"], accent: true },
    { kind: "Python", title: "Estimator", subs: ["alignment, regimes", "cut-off, bootstrap", "estimate --all"], accent: true },
    { kind: "Published", title: "Model run", subs: ["model_result", "versioned run_id", "proxy-0.1"] },
    { kind: "Spring Boot", title: "API", subs: ["read-only role", "ETag, rate limit", ":8080"] },
    { kind: "React 18 · Vite", title: "Web", subs: ["track maps, laps", "findings, method", ":5173"] },
  ];
  let s = label(Pl, 28, 40, "How the data moves · estimates only, no raw samples published", { size: 11 });
  s += `<path d="M0 62 H1280" stroke="${Pl.hair}"/>`;
  main.forEach((c, i) => {
    const x = X0 + i * (W + G);
    s += card(Pl, x, Y, W, H, c);
    if (i < main.length - 1) s += arrow(Pl, `M${x + W + 3} ${Y + H / 2} H${x + W + G - 3}`);
  });
  // optional replay lane
  const LY = 300;
  s += `<rect x="25" y="${LY}" width="1230" height="205" rx="16" fill="none" stroke="${Pl.hair2}" stroke-dasharray="6 6"/>`;
  s += label(Pl, 1230, LY + 28, "Optional · live replay (Phase 7) · Compose profile “replay”", { anchor: "end", size: 10.5 });
  const lane = [
    { kind: "Java", title: "Producer", subs: ["car_data + location", "paced, --speed 20", "key = driver"] },
    { kind: "Kafka 3.8 · KRaft", title: "telemetry.<key>", subs: ["3 partitions", "6 h retention", "127.0.0.1:9092"] },
    { kind: "Java", title: "Consumer", subs: ["5-sample window", "regime per driver", "≤ 1 state / 250 ms"] },
    { kind: "Kafka", title: "regime-state.<key>", subs: ["compacted", "1 partition", "no raw samples out"] },
    { kind: "Spring Boot · SSE", title: "GET /api/live/{key}", subs: ["flag API_REPLAY_ENABLED", "off by default", "→ web #/live"] },
  ];
  const lw = 196, lg = 48, lx0 = 50, ly = LY + 52, lh = 118;
  lane.forEach((c, i) => {
    const x = lx0 + i * (lw + lg);
    s += card(Pl, x, ly, lw, lh, { ...c, dashed: false });
    if (i < lane.length - 1) s += arrow(Pl, `M${x + lw + 3} ${ly + lh / 2} H${x + lw + lg - 3}`, { dashed: true });
  });
  // Postgres (index 2) down to producer; SSE up to API (index 5)
  const pgx = X0 + 2 * (W + G) + W / 2, apix = X0 + 5 * (W + G) + W / 2;
  s += arrow(Pl, `M${pgx} ${Y + H + 3} V${LY - 26} H${lx0 + lw / 2} V${ly - 3}`, { dashed: true });
  s += arrow(Pl, `M${lx0 + 4 * (lw + lg) + lw / 2} ${ly - 3} V${LY - 26} H${apix} V${Y + H + 3}`, { dashed: true });
  s += label(Pl, 28, 528, "Python and Java meet only at one versioned results table", { size: 10 });
  return s;
}

// ---------- 3. estimate ----------
function estimateBody(Pl) {
  const x0 = 110, x1 = 1170, yTop = 120, yBase = 330;
  const L = x1 - x0;
  const xc = x0 + L * 0.58;
  const v = (t) => 1 - Math.exp(-4.2 * t);                       // illustrative: rising, then flattening
  const vmax = v(1);
  const Y = (t) => yBase - ((v(t) / vmax) * (yBase - yTop - 10)) ;
  const pts = Array.from({ length: 81 }, (_, i) => i / 80);
  const curve = pts.map((t, i) => `${i ? "L" : "M"}${n(x0 + L * t)} ${n(Y(t))}`).join(" ");
  const upto = pts.filter((t) => t <= 0.58);
  const shade = "M" + upto.map((t) => `${n(x0 + L * t)} ${n(Y(t))}`).join(" L") + ` L${n(xc)} ${yBase} L${x0} ${yBase} Z`;
  const y250 = yBase - 0.43 * (yBase - yTop);
  const intervalY = 420;
  const lo = xc - 46, hi = xc + 54;
  const laps = [-38, -22, -15, -8, -3, 2, 7, 12, 21, 33, 46].map((d) => xc + d);
  let s = label(Pl, 28, 40, "What one estimate is · one straight, one car, one lap", { size: 11 });
  s += label(Pl, 1252, 40, "Illustrative shape, not data", { size: 11, anchor: "end", c: Pl.red });
  s += `<path d="M0 62 H1280" stroke="${Pl.hair}"/>`;
  // axes
  s += `<path d="M${x0} ${yBase} H${x1}" stroke="${Pl.hair2}"/><path d="M${x0} ${yTop - 10} V${yBase}" stroke="${Pl.hair2}"/>`;
  s += label(Pl, x0, yBase + 22, "0", { anchor: "middle" }) + label(Pl, x1, yBase + 22, "L m", { anchor: "middle" });
  s += label(Pl, (x0 + x1) / 2, yBase + 22, "Distance along the straight", { anchor: "middle" });
  s += label(Pl, x0 - 14, yTop, "Speed", { anchor: "end" });
  s += `<path d="M${x0} ${y250} H${x1}" stroke="${Pl.hair}" stroke-dasharray="3 6"/>` + label(Pl, x1 + 0, y250 - 8, "250 kph", { anchor: "end", size: 10 });
  // regimes
  s += `<path d="${shade}" fill="url(#dots)"/>`;
  s += `<path d="${shade}" fill="${Pl.ink}" fill-opacity="${Pl.fillInk}"/>`;
  s += `<path d="${curve}" fill="none" stroke="${Pl.ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += label(Pl, x0 + 60, yBase - 26, "Deploy regime", { c: Pl.ink, size: 11 });
  s += label(Pl, x0 + 60, yBase - 10, "speed still rising", { size: 10 });
  s += label(Pl, xc + (x1 - xc) / 2, yBase - 26, "Plateau", { c: Pl.ink, size: 11, anchor: "middle" });
  // cut-off
  s += `<path d="M${n(xc)} ${yTop - 20} V${yBase + 4}" stroke="${Pl.red}" stroke-width="2" stroke-dasharray="6 5"/>`;
  s += `<circle cx="${n(xc)}" cy="${n(Y(0.58))}" r="6" fill="${Pl.g1}" stroke="${Pl.red}" stroke-width="2.5"/>`;
  s += label(Pl, xc, yTop - 32, "Cut-off, m into straight", { c: Pl.red, anchor: "middle", size: 12 });
  s += `<text x="${n(xc + 16)}" y="${n(Y(0.58) + 36)}" font-family="${SANS}" font-size="13" fill="${Pl.mute}">first point above 250 kph where</text>
        <text x="${n(xc + 16)}" y="${n(Y(0.58) + 54)}" font-family="${SANS}" font-size="13" fill="${Pl.mute}">acceleration stays below 0.5 m/s² for four 0.25 s steps</text>`;
  // interval row
  s += `<path d="M${x0} ${intervalY + 26} H${x1}" stroke="${Pl.hair2}"/>`;
  s += `<path d="M${n(xc)} ${yBase + 4} V${intervalY}" stroke="${Pl.red}" stroke-opacity="0.35" stroke-dasharray="2 5"/>`;
  laps.forEach((x) => (s += `<circle cx="${n(x)}" cy="${intervalY}" r="3.4" fill="${Pl.ink}" fill-opacity="0.75"/>`));
  s += `<path d="M${lo} ${intervalY + 14} H${hi}" stroke="${Pl.red}" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M${lo} ${intervalY + 6} V${intervalY + 22} M${hi} ${intervalY + 6} V${intervalY + 22}" stroke="${Pl.red}" stroke-width="2"/>`;
  s += label(Pl, x0 - 14, intervalY + 4, "Laps", { anchor: "end" });
  s += label(Pl, x0 - 14, intervalY + 18, "Interval", { anchor: "end" });
  s += label(Pl, hi + 18, intervalY + 18, "95% bootstrap interval, lap-to-lap", { c: Pl.red, size: 11 });
  s += label(Pl, 28, 505, "An estimate under stated assumptions (mass, drag area, derate rate). Never a measurement of battery state.", { size: 10.5 });
  return s;
}

// ---------- 4. result ----------
function resultBody(Pl) {
  const rows = [
    { name: "Point run", note: "primary", or: 0.9173, lo: 0.807, hi: 1.0426, txt: "0.92 [0.81–1.04]", strong: true },
    { name: "Lower-edge run", note: "cut-off band, low", or: 0.8537, lo: 0.736, hi: 0.9902, txt: "0.85 [0.74–0.99]" },
    { name: "Upper-edge run", note: "cut-off band, high", or: 0.9382, lo: 0.8264, hi: 1.065, txt: "0.94 [0.83–1.07]" },
  ];
  const a = 0.6, b = 1.5, px0 = 330, px1 = 960;
  const X = (v) => px0 + ((v - a) / (b - a)) * (px1 - px0);
  const top = 120, rowH = 64;
  let s = label(Pl, 28, 40, "The pre-registered test · odds ratio per 1 SD earlier defender cut-off", { size: 11 });
  s += label(Pl, 1252, 40, "Frozen 2026-10-18 · model run proxy-0.1", { size: 11, anchor: "end" });
  s += `<path d="M0 62 H1280" stroke="${Pl.hair}"/>`;
  const bottom = top + rows.length * rowH + 10;
  for (let t = 0.6; t <= 1.5001; t += 0.1) {
    s += `<path d="M${n(X(t))} ${top - 22} V${bottom}" stroke="${Pl.hair}"/>` + label(Pl, X(t), bottom + 22, t.toFixed(1), { anchor: "middle", size: 10 });
  }
  s += `<path d="M${n(X(1))} ${top - 30} V${bottom}" stroke="${Pl.ink}" stroke-opacity="0.55" stroke-width="1.5"/>`;
  s += label(Pl, X(1), top - 38, "1 · no association", { anchor: "middle", c: Pl.ink, size: 10.5 });
  s += `<path d="M${n(X(1.3))} ${top - 30} V${bottom}" stroke="${Pl.red}" stroke-width="2" stroke-dasharray="7 5"/>`;
  s += label(Pl, X(1.3), top - 38, "1.3 · smallest effect that counts", { anchor: "middle", c: Pl.red, size: 10.5 });
  rows.forEach((r, i) => {
    const y = top + i * rowH + 26;
    s += sans(Pl, 28, y - 2, r.name, { size: 15, w: 650 }) + label(Pl, 28, y + 16, r.note, { size: 9.5 });
    s += `<path d="M${n(X(r.lo))} ${y} H${n(X(r.hi))}" stroke="${Pl.ink}" stroke-width="${r.strong ? 3.5 : 2.5}" stroke-linecap="round"/>`;
    s += `<path d="M${n(X(r.lo))} ${y - 8} V${y + 8} M${n(X(r.hi))} ${y - 8} V${y + 8}" stroke="${Pl.ink}" stroke-width="2"/>`;
    s += `<rect x="${n(X(r.or) - 7)}" y="${y - 7}" width="14" height="14" rx="3" transform="rotate(45 ${n(X(r.or))} ${y})" fill="${Pl.ink}" stroke="${Pl.g1}" stroke-width="2"/>`;
    s += `<text x="${px1 + 36}" y="${y + 5}" ${mono(Pl.ink, 14, 'letter-spacing="0.3"').replace('letter-spacing="1.2" ', "")}>${r.txt}</text>`;
  });
  s += label(Pl, (px0 + px1) / 2, bottom + 44, "Odds ratio, 95% interval · below 1 is the opposite of the proposed direction", { anchor: "middle", size: 10 });
  // verdict block
  const vy = 420;
  s += `<path d="M28 ${vy - 28} H1252" stroke="${Pl.hair}"/>`;
  s += sans(Pl, 28, vy + 36, "NO DETECTABLE EFFECT", { size: 46, w: 900, ls: -1 });
  s += label(Pl, 28, vy + 62, "364 passes vs 1,324 non-passes · 19 sessions", { c: Pl.ink, size: 12 });
  s += `<text x="1252" y="${vy + 18}" text-anchor="end" font-family="${SANS}" font-size="14" fill="${Pl.mute}">Permutation control: observed coefficient more extreme</text>
        <text x="1252" y="${vy + 38}" text-anchor="end" font-family="${SANS}" font-size="14" fill="${Pl.mute}">than 79.2% of shuffles, two-sided, 1,000 shuffles</text>`;
  s += label(Pl, 1252, vy + 66, "Permutation p 0.208 · control failed", { anchor: "end", c: Pl.red, size: 12 });
  s += label(Pl, 28, 520, "None detectable with this estimator and sample, not proof of absence. Pace difference and Overtake availability did predict passes.", { size: 10 });
  return s;
}

// ---------- 5. phases ----------
function phasesBody(Pl) {
  const ph = [
    { k: "Phase S", t: "Spike", o: "Feasibility check scored 1/3, so proxy mode: no state of charge.", st: "done" },
    { k: "Phase 1", t: "Ingestion", o: "Idempotent, resumable load of the 2026 sessions.", st: "built" },
    { k: "Phase 2", t: "Alignment", o: "Lap and distance per sample, quality report per session.", st: "built" },
    { k: "Phase 3", t: "Regimes", o: "Baseline physics. The reproduction check failed and was reported.", st: "built" },
    { k: "Phase 4", t: "Estimator", o: "Cut-off and relative deploy energy, 45 sessions.", st: "built" },
    { k: "Phase 5", t: "Findings", o: "Frozen test run as written: no detectable effect.", st: "result" },
    { k: "Phase 6", t: "API and view", o: "Read-only API and the React explorer.", st: "built" },
    { k: "Phase 7", t: "Replay", o: "Optional Kafka live replay.", st: "optional" },
  ];
  const W = 142, G = 13.4, X0 = 25, Y = 150, H = 205;
  let s = label(Pl, 28, 40, "The project record · built in order, each phase ends on a stated exit condition", { size: 11 });
  s += `<path d="M0 62 H1280" stroke="${Pl.hair}"/>`;
  s += `<path d="M${X0} ${Y - 28} H${1255}" stroke="${Pl.hair2}"/>`;
  const wrap = (txt, max) => {
    const out = []; let cur = "";
    for (const w of txt.split(" ")) { if ((cur + " " + w).trim().length > max) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
    return out.concat(cur ? [cur] : []);
  };
  ph.forEach((p, i) => {
    const x = X0 + i * (W + G);
    s += `<circle cx="${n(x + 14)}" cy="${Y - 28}" r="5" fill="${p.st === "result" ? Pl.red : Pl.ink}" ${p.st === "optional" ? `fill-opacity="0.25"` : ""}/>`;
    s += card(Pl, x, Y, W, H, { title: p.t, kind: p.k, dashed: p.st === "optional", accent: p.st === "result" });
    wrap(p.o, 19).forEach((l, j) => (s += `<text x="${x + 14}" y="${Y + 78 + j * 18}" font-family="${SANS}" font-size="13" fill="${Pl.mute}">${esc(l)}</text>`));
    s += label(Pl, x + 14, Y + H - 16, p.st, { size: 10, c: p.st === "result" ? Pl.red : Pl.ink });
  });
  // phase 1.5
  const ky = Y + H + 36;
  s += `<rect x="25" y="${ky}" width="1230" height="60" rx="12" fill="none" stroke="${Pl.hair2}" stroke-dasharray="6 6"/>`;
  s += label(Pl, 45, ky + 26, "Phase 1.5 · thin cloud deploy", { c: Pl.ink, size: 11 });
  s += `<text x="45" y="${ky + 46}" font-family="${SANS}" font-size="13" fill="${Pl.mute}">Planned: Oracle Cloud ARM instance for the database and jobs, plus a small AWS piece (private S3 backup).</text>`;
  s += label(Pl, 1235, ky + 36, "Not deployed yet", { anchor: "end", c: Pl.red, size: 11 });
  return s;
}

const out = {
  banner: [1280, 400, bannerBody, "F1 Battery", "Banner: the project name and pitch beside a Monza circuit outline over a red halftone bloom, with the tag estimates, not measurements."],
  pipeline: [1280, 545, pipelineBody, "Pipeline", "OpenF1 flows into a Java ingest job, PostgreSQL with TimescaleDB, a Python estimator, a versioned model run, a read-only Spring Boot API and a React web app. An optional Kafka replay lane streams regime state to the API over server-sent events."],
  estimate: [1280, 525, estimateBody, "What one estimate is", "Illustrative speed trace along one straight: speed rises through the deploy regime, flattens at a plateau, and a red cut-off marker sits where acceleration stays low, with a 95 percent lap-to-lap interval bar below."],
  result: [1280, 545, resultBody, "The pre-registered result", "Forest plot of three odds ratios per 1 SD earlier defender cut-off: 0.92 [0.81–1.04], 0.85 [0.74–0.99], 0.94 [0.83–1.07]. All intervals sit below the pre-registered 1.3 threshold. Verdict: no detectable effect. 364 passes against 1,324 non-passes in 19 sessions. Permutation p 0.208."],
  phases: [1280, 500, phasesBody, "Project phases", "Strip of phases S and 1 to 7 with one-line outcomes and status, plus the not-yet-deployed phase 1.5."],
};
for (const [name, [w, h, fn, title, desc]] of Object.entries(out))
  for (const mode of ["dark", "light"])
    writeFileSync(join(here, `${name}-${mode}.svg`), frame(P[mode], w, h, fn(P[mode]), title, desc));
console.log("wrote", Object.keys(out).length * 2, "svgs");
