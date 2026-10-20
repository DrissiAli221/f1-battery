import type { ReactNode } from "react";

/**
 * A dashed hairline that fades out at both ends (ported from MonarcPulse's DashedLine).
 * Decorative; separates blocks where space alone is not enough.
 */
export function Rule({ vertical = false, className = "" }: { vertical?: boolean; className?: string }) {
  return <div className={`rule ${vertical ? "rule--v" : ""} ${className}`} aria-hidden="true" />;
}

/**
 * Section heading block: the heading left, a muted paragraph right, two columns from lg.
 * Spacing comes from the tokens (--head-top above, --head-gap between, --grid-top below via
 * the next block's own margin).
 */
export function SectionIntro({ title, children, id }: { title: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <div className="section-intro">
      <h2 id={id} className="section-intro__title">
        {title}
      </h2>
      {children && <p className="section-intro__text">{children}</p>}
    </div>
  );
}
