import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./env";

gsap.registerPlugin(ScrollTrigger);

/*
 * Halftone handoff between two stacked sections. The outgoing section (marked `data-dots`)
 * gets a bottom-aligned SVG layer of circles on a square grid; as the section scrolls out the
 * circles grow from nothing in a bottom-to-top wave (per-row order, a little per-dot
 * randomness) until neighbours merge and the layer is the next section's solid colour. The
 * same pixel-grid idea as the GSAP "section transition 03", with dots for cells so it matches
 * the site's halftone. Scrubbed by ScrollTrigger over the layer's own height.
 *
 * Attributes on the outgoing section:
 *   data-dots            enables; optional value = columns on desktop (default 48)
 *   data-dots-fill       fill colour; default the next sibling's background (then the parent's
 *                        next sibling, for a section that is last inside a page wrapper)
 *   data-dots-spread     wave overlap in rows (default 0: a clean row-by-row ramp)
 *   data-dots-height     layer height, any CSS length (default 64vh; "100%" covers the section)
 *   data-dots-start      ScrollTrigger start (default "bottom bottom+=20%"; a full-height hero
 *                        uses "bottom bottom" so nothing has grown at scroll 0)
 * Under reduced motion nothing is injected. Returns a function that removes everything.
 */
interface Config {
  columns: number;
  mobileColumns: number;
  spread: number;
  fillDuration: number;
  layerHeight: string;
  start: string;
  breakpoint: number;
}

/* spread 0 and a long fillDuration give the clean halftone ramp of the static header: every dot
 * in a row is the same size, and about half the rows are mid-growth at any moment, so the
 * picture is the printed ramp sliding upward. A spread of a few rows scatters it. */
const DEFAULTS: Config = { columns: 72, mobileColumns: 28, spread: 0, fillDuration: 0.6, layerHeight: "64vh", start: "bottom bottom+=20%", breakpoint: 768 };

const SVG = "http://www.w3.org/2000/svg";
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const transparent = (c: string) => c === "transparent" || /rgba\(0,\s*0,\s*0,\s*0\)/.test(c);
const int = (v: string | null | undefined, fb: number, min = 1) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isInteger(n) && n >= min ? n : fb;
};

function fillFor(section: Element): string {
  const own = section.getAttribute("data-dots-fill");
  if (own) return own;
  const cands = [section.nextElementSibling, section.parentElement?.nextElementSibling, document.body];
  for (const el of cands) {
    if (!el) continue;
    const bg = getComputedStyle(el).backgroundColor;
    if (!transparent(bg)) return bg;
  }
  return "#000";
}

function build(section: HTMLElement, cfg: Config): () => void {
  const cs = getComputedStyle(section);
  const undo: (() => void)[] = [];
  if (cs.position === "static") {
    section.style.position = "relative";
    undo.push(() => (section.style.position = ""));
  }
  if (!["hidden", "clip"].includes(cs.overflow)) {
    section.style.overflow = "clip";
    undo.push(() => (section.style.overflow = ""));
  }
  const mobile = window.matchMedia(`(max-width: ${cfg.breakpoint}px)`).matches;
  const columns = mobile ? int(section.getAttribute("data-dots-mobile"), cfg.mobileColumns) : int(section.getAttribute("data-dots"), cfg.columns);
  const spread = int(section.getAttribute("data-dots-spread"), cfg.spread, 0);
  const fill = fillFor(section);

  const layer = document.createElementNS(SVG, "svg");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("data-dots-layer", "");
  Object.assign(layer.style, { position: "absolute", left: "0", right: "0", bottom: "0", width: "100%", height: section.getAttribute("data-dots-height") || cfg.layerHeight, zIndex: "4", pointerEvents: "none", display: "block" });
  section.append(layer);

  const W = layer.clientWidth || section.clientWidth;
  const H = layer.clientHeight;
  const pitch = W / columns;
  const rows = Math.max(1, Math.ceil(H / pitch));
  layer.setAttribute("viewBox", `0 0 ${W} ${H}`);
  layer.setAttribute("preserveAspectRatio", "none");
  const rmax = pitch * 0.72; // past half the pitch, so neighbours merge into a solid

  const dots: SVGCircleElement[] = [];
  const delays: number[] = [];
  const maxDelay = Math.max(rows - 1 + spread, 1);
  const jitter = (i: number) => (spread > 0 ? hash(i) * spread : 0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      const d = document.createElementNS(SVG, "circle");
      d.setAttribute("cx", (c * pitch + pitch / 2).toFixed(1));
      d.setAttribute("cy", (H - (r * pitch + pitch / 2)).toFixed(1)); // row 0 at the bottom
      d.setAttribute("r", "0");
      d.setAttribute("fill", fill);
      layer.append(d);
      dots.push(d);
      delays.push((r + jitter(i)) / maxDelay);
    }
  }

  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: section, start: section.getAttribute("data-dots-start") || cfg.start, end: () => `+=${Math.max(layer.clientHeight, 1)}`, scrub: 1, invalidateOnRefresh: true },
  });
  tl.to(dots, { attr: { r: rmax }, duration: cfg.fillDuration, stagger: (i) => delays[i] }, 0);

  return () => {
    tl.scrollTrigger?.kill();
    tl.kill();
    layer.remove();
    undo.forEach((f) => f());
  };
}

export function dotsHandoff(scope: ParentNode | null = document, overrides: Partial<Config> = {}): () => void {
  if (!scope || prefersReducedMotion()) return () => {};
  const cfg = { ...DEFAULTS, ...overrides };
  const sections = Array.from(scope.querySelectorAll<HTMLElement>("[data-dots]"));
  const kills = new Map<HTMLElement, () => void>();
  const make = (s: HTMLElement) => {
    kills.get(s)?.();
    kills.set(s, build(s, cfg));
  };
  sections.forEach(make);
  // Rebuild on a width change (the grid is sized from the section), then let ScrollTrigger re-measure.
  let last = window.innerWidth;
  let t: number | undefined;
  const onResize = () => {
    if (window.innerWidth === last) return;
    last = window.innerWidth;
    window.clearTimeout(t);
    t = window.setTimeout(() => {
      sections.forEach(make);
      ScrollTrigger.refresh();
    }, 150);
  };
  window.addEventListener("resize", onResize);
  ScrollTrigger.refresh();
  return () => {
    window.removeEventListener("resize", onResize);
    window.clearTimeout(t);
    kills.forEach((k) => k());
  };
}
