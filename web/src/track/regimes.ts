import type { RegimeRun } from "../lib/track";

/** The four model regimes plus "other" (unlabelled bins): colour tokens and words, one place. */
export type RegimeKey = RegimeRun["label"];

export const REGIME_VAR: Record<RegimeKey, string> = {
  deploy: "var(--regime-deploy)",
  plateau: "var(--regime-plateau)",
  lift: "var(--regime-lift)",
  brake: "var(--regime-brake)",
  other: "var(--regime-other)",
};

export const REGIME_WORD: Record<RegimeKey, string> = {
  deploy: "deploying",
  plateau: "plateau",
  lift: "lifting",
  brake: "braking",
  other: "other",
};

export const REGIMES: Exclude<RegimeKey, "other">[] = ["deploy", "plateau", "lift", "brake"];
