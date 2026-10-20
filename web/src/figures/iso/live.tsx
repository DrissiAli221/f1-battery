/*
 * The anatomy kit's live hooks (kit/react/live.tsx), adapted to this site: the frame loop runs
 * on gsap.ticker, the site's one clock (DESIGN.md "Motion language"), instead of its own
 * requestAnimationFrame loop. Everything else is the kit's: off-screen stop through
 * IntersectionObserver, the reduced-motion check, the readout writer and the easing helpers.
 */
import * as React from "react";
import { gsap } from "gsap";

const STILLNESS = "(prefers-reduced-motion: reduce)";
const MARGIN = "120px 0px";
const LONGEST_FRAME = 1 / 30;

export const asksForStillness = () => typeof window !== "undefined" && window.matchMedia(STILLNESS).matches;

export function useInView<T extends Element>(ref: React.RefObject<T | null>) {
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => setInView(Boolean(entries[entries.length - 1]?.isIntersecting)), { rootMargin: MARGIN });
    io.observe(node);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

export function Stage({ className, children }: { className: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  return (
    <div ref={ref} className={className} data-inview={inView ? "" : undefined}>
      {children}
    </div>
  );
}

export function useReadout<T extends Element>() {
  const anchor = React.useRef<T>(null);
  const say = React.useCallback((text: string) => {
    const slot = anchor.current?.closest(".iso-plate")?.querySelector("[data-readout]");
    if (slot && slot.textContent !== text) slot.textContent = text;
  }, []);
  return { anchor, say };
}

/**
 * Runs `tick(dt, calm)` on gsap.ticker while `running` and while it returns true. Returns
 * `kick()` to restart it after it settled. The callback is removed from the ticker whenever it
 * stops, so an idle or off-screen figure costs nothing per frame.
 */
export function useLoop(tick: (dt: number, calm: boolean) => boolean, running: boolean) {
  const latest = React.useRef(tick);
  latest.current = tick;
  const on = React.useRef<null | ((time: number) => void)>(null);
  const stop = React.useCallback(() => {
    if (on.current) gsap.ticker.remove(on.current);
    on.current = null;
  }, []);
  const kick = React.useCallback(() => {
    if (on.current) return;
    let last = 0;
    const step = (time: number) => {
      const dt = last ? Math.min(time - last, LONGEST_FRAME) : 1 / 60;
      last = time;
      if (!latest.current(dt, asksForStillness())) stop();
    };
    on.current = step;
    gsap.ticker.add(step);
  }, [stop]);
  React.useEffect(() => {
    if (running) kick();
    else stop();
    return stop;
  }, [running, kick, stop]);
  return kick;
}

export function follow(current: number, target: number, dt: number, seconds: number, calm = false) {
  if (calm) return target;
  const next = current + (target - current) * (1 - Math.exp(-dt / seconds));
  return Math.abs(target - next) < 1e-3 ? target : next;
}
