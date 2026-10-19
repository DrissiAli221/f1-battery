import { useId, useLayoutEffect, useMemo, useRef } from "react";
import { gsap } from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { project } from "../lib/track";
import type { Outline } from "../lib/types";

gsap.registerPlugin(DrawSVGPlugin);

/**
 * Decorative red track curve for heroes and thumbnails: one outline, drawn in once. The glow
 * is a blurred copy underneath; no data is encoded.
 */
export function TrackArt({
  outline,
  width,
  height,
  stroke = 3,
  animate = true,
  colour = "var(--brand)",
  glow = true,
  className,
}: {
  outline: Outline;
  width: number;
  height: number;
  stroke?: number;
  animate?: boolean;
  colour?: string;
  glow?: boolean;
  className?: string;
}) {
  const T = useMemo(() => project(outline, width, height, { l: 8, r: 8, t: 8, b: 8 }), [outline, width, height]);
  const ref = useRef<SVGGElement>(null);
  const fid = `art-${useId().replace(/:/g, "")}`;
  useLayoutEffect(() => {
    if (!animate || !ref.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const paths = ref.current.querySelectorAll("path");
    const tw = gsap.fromTo(paths, { drawSVG: "0%" }, { drawSVG: "100%", duration: 2.2, ease: "power2.inOut" });
    return () => {
      tw.progress(1).kill();
    };
  }, [animate, T]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      {glow && (
        <defs>
          <filter id={fid} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation={stroke * 2.2} />
          </filter>
        </defs>
      )}
      <g ref={ref} fill="none" strokeLinejoin="round" strokeLinecap="round">
        {glow && <path d={T.pathD} stroke={colour} strokeWidth={stroke * 3} opacity={0.35} filter={`url(#${fid})`} />}
        <path d={T.pathD} stroke={colour} strokeWidth={stroke} />
      </g>
    </svg>
  );
}
