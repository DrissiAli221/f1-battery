import type { ReactNode } from "react";

/*
 * Buttons, ported from the owner's MonarcPulse site and restyled in our tokens. Square (the
 * radius rule), two cells: the label on the accent, the arrow on ink. On hover or keyboard
 * focus the arrow tile expands left across the label (a clip-path, 420 ms, MonarcPulse's
 * mechanism), so the button floods from red to ink and the label turns dark; the label steps
 * 4 px along x and a second arrow slides in: the cursor verb, along x. Under reduced motion
 * the flood is an instant colour change and nothing moves.
 */

function Arrow() {
  return (
    <svg className="cta__arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Cta({
  href,
  children,
  size = "md",
  className = "",
}: {
  href: string;
  children: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <a href={href} className={`cta cta--${size} ${className}`}>
      <span className="cta__clip">
        <span className="cta__fill" aria-hidden="true" />
        <span className="cta__cell" aria-hidden="true" />
        <span className="cta__label">{children}</span>
        <span className="cta__go" aria-hidden="true">
          <span className="cta__track">
            <Arrow />
            <Arrow />
          </span>
        </span>
      </span>
    </a>
  );
}

/** Outlined secondary: the outline floods with ink on hover and focus. */
export function CtaGhost({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} className={`cta-ghost ${className}`}>
      {children}
    </a>
  );
}
