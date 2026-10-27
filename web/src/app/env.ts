export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Touch-first device: no idle creep, no pointer nudge. */
export const isTouch = () => matchMedia('(hover: none), (pointer: coarse)').matches;
