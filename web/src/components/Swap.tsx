import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { gsap } from "gsap";
import { prefersReducedMotion } from "../motion";

/*
 * Content that changes in place (a new straight in the panel, a new chart) settles in rather
 * than snapping: when `swapKey` changes, the box starts a little faded, 3 px low and slightly
 * blurred and eases to rest in 240 ms. It starts from partly visible, not from nothing, so the
 * swap reads as one element changing rather than a blank frame; the blur hides the moment the
 * old content becomes the new. The first render does not animate. WAAPI, so it runs off the
 * main thread and a fast run of picks simply restarts it from the current look.
 */
export function Swap({ swapKey, children, className = "" }: { swapKey: string | number | null; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(swapKey);
  useLayoutEffect(() => {
    if (last.current === swapKey) return;
    last.current = swapKey;
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const reduced = prefersReducedMotion();
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      reduced
        ? [{ opacity: 0.5 }, { opacity: 1 }]
        : [
            { opacity: 0.35, transform: "translateY(3px)", filter: "blur(3px)" },
            { opacity: 1, transform: "none", filter: "blur(0)" },
          ],
      { duration: reduced ? 160 : 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }, [swapKey]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/*
 * A number that rolls to its new value (300 ms, ease-out) instead of jumping; whole numbers,
 * formatted by `format`. Reduced motion shows the new value at once.
 */
export function RollingNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || prefersReducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    // On the app's one clock (gsap.ticker), like every other tween here.
    const o = { v: start };
    const tw = gsap.to(o, {
      v: value,
      duration: 0.3,
      ease: "power3.out",
      onUpdate: () => {
        from.current = o.v;
        setShown(o.v);
      },
    });
    return () => {
      tw.kill();
    };
  }, [value]);
  // Tabular figures, so the digits do not shuffle sideways while they roll.
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{format(Math.round(shown))}</span>;
}
