import { useEffect, useRef, type DependencyList } from "react";
import { gsap } from "gsap";
import type { Store } from "../explorer/store";
import { prefersReducedMotion } from "../motion";

/*
 * The shared cursor's ease: a chart subscribes to the page's cursor store (metres along the
 * straight) and eases its own drawing toward each new value, without a React render per
 * frame. `place` is called with the eased distance; it writes attributes and text directly.
 */
export function useEasedCursor(store: Store<number | null>, place: (d: number) => void, deps: DependencyList) {
  const placeRef = useRef(place);
  placeRef.current = place;
  const shown = useRef({ d: store.get() ?? 0 });
  useEffect(() => {
    placeRef.current(shown.current.d);
    let tw: gsap.core.Tween | null = null;
    const unsub = store.subscribe(() => {
      const d = store.get();
      if (d === null) return;
      tw?.kill();
      if (prefersReducedMotion()) {
        shown.current.d = d;
        placeRef.current(d);
        return;
      }
      tw = gsap.to(shown.current, { d, duration: 0.45, ease: "expo.out", onUpdate: () => placeRef.current(shown.current.d) });
    });
    return () => {
      unsub();
      tw?.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ...deps]);
}

/** Keyboard on a distance slider: arrows step one 50 m bin, Home and End go to the ends. */
export function seekKey(e: React.KeyboardEvent, store: Store<number | null>, L: number, step = 50) {
  const cur = store.get() ?? 0;
  let next: number | null = null;
  if (e.key === "ArrowRight" || e.key === "ArrowUp") next = cur + step;
  else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = cur - step;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = L;
  if (next === null) return;
  e.preventDefault();
  store.set(Math.max(0, Math.min(L, next)));
}
