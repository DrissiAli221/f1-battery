import { Fragment, type ReactNode } from "react";

/*
 * The record (DESIGN.md "THE RECORD"): the landing's reading of web/src/content/method-log.json.
 * The log has no status field, so each entry's status and one-line summary are curated here
 * from its own "check" and "found" text, in the log's vocabulary:
 *
 *   pass              the pre-set check was met
 *   fail              the pre-set check was not met, and the failure stands as recorded
 *   not demonstrated  the effect the check looked for could not be shown with this data
 *   explained         no pass bar; the issue was traced to a cause and handled
 *
 * `crossed`: the first cut-off estimator (the hinge derate detector), demoted to experimental
 * after the reproduction check (D18, D19); the threshold crossing replaced it.
 */
export type Status = "pass" | "fail" | "not demonstrated" | "explained";

export const RECORD: Record<string, { status: Status; line: string; crossed?: boolean }> = {
  "phase-s-super-clip": {
    status: "fail",
    line: "Every super-clip candidate sat inside the smoothing window before braking; with a 1.5 s guard none repeated.",
  },
  "phase-s-taper": {
    status: "not demonstrated",
    line: "No slope break in the 290 to 345 kph envelope; the check was deferred to qualifying data.",
  },
  "phase3-differentiation": {
    status: "pass",
    line: "Savitzky-Golay with a 9-sample window had the lowest error on 150 scored synthetic straights and was kept.",
  },
  "phase3-hinge-detector": {
    status: "fail",
    crossed: true,
    line: "Monza reproduced within 5.2 m, but Singapore straight 3 flagged 27.5 % of laps against a 10 % limit; the threshold crossing replaced it.",
  },
  "drag-area-identifiability": {
    status: "not demonstrated",
    line: "Per-car drag area ran from −0.49 to 4.19 m² across Monza and Singapore; one session-wide value is used instead.",
  },
  "data-quality": {
    status: "explained",
    line: "Truncated, frozen and offset feeds traced to their causes; Kuala Lumpur refetched, the Hungary race excluded.",
  },
  "spot-checks": {
    status: "fail",
    line: "Three of four testable spot checks failed and one passed; none was edited afterwards.",
  },
  "frozen-hypothesis-test": {
    status: "fail",
    line: "The frozen bar was not met: odds ratio 0.92, interval 0.81 to 1.04, and the permutation control failed.",
  },
};

/**
 * Status colours for the marks (not the regime palette): pass in ink, fail in the accent, the
 * rest muted. Status words stay in ink or muted text: the accent is under 4.5:1 at 12 px.
 */
export const STATUS_VAR: Record<Status, string> = {
  pass: "var(--ink)",
  fail: "var(--accent)",
  "not demonstrated": "var(--muted)",
  explained: "var(--muted)",
};

/**
 * A number in Geist Mono with tabular figures. Mono gives the decimal point a full cell, which
 * reads as "0 . 5" at display sizes; the point's span pulls its neighbours back in.
 */
export function N({ children }: { children: string }) {
  const parts = children.split(/(\.)/);
  return (
    <span className="num">
      {parts.map((p, i) =>
        p === "." ? (
          <span key={i} className="num-pt">
            .
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  );
}

/** Wraps every number in a sentence in <N>. */
export function nums(text: string): ReactNode {
  return text.split(/([\u2212]?\d[\d,.]*\d|[\u2212]?\d)/g).map((p, i) => (i % 2 ? <N key={i}>{p}</N> : <Fragment key={i}>{p}</Fragment>));
}
