# Guide for AI agents working in this repo

Applies to any agent. Read README.md and PLAN.md first.

## Working rules

- **Explain the why.** Every non-trivial change carries a short design note:
  in the commit message, in a `docs/` note for the phase, or in code comments
  where a maintainer would need them. Comments explain intent and trade-offs,
  not the obvious.
- **Never decide architecture silently.** A choice that changes the design is
  proposed first and recorded in DECISIONS.md once accepted.
- **Build in phase order** (PLAN.md). Each phase ends with its exit condition
  met, its design note written, and a review checkpoint.

## Truth rules

- **Never fabricate results, numbers or plots.** A finding is only one that a
  committed script reproduces from data.
- Battery/energy outputs are always labelled **estimates** with their
  assumptions. Never call them measured.
- Every FIA limit used in code comes from `docs/regulations.md`, with the
  issue number and article. No magic constants.
- HYPOTHESIS.md and docs/spot-checks.md are frozen once dated, before any
  Phase 4 output exists. Deviations go in DECISIONS.md, explained.
- Report failures plainly: a test that failed, a check that did not pass, a
  result that turned out to be an artifact. If a phase's own check fails,
  stop and report rather than quietly reducing scope.

## Data rules

- OpenF1 free tier: **≤3 req/s and ≤30 req/min**, non-commercial use only.
  Back off on 429/5xx. Cache responses locally.
- Raw and derived data are **never committed**. `data/` and any dumps are
  gitignored.
- Public outputs: derived aggregates only, never raw samples (DECISIONS.md
  D5, D9).
- Not affiliated with F1, FIA or FOM; the site says so. This is a personal,
  non-commercial project, and the owner decided (DECISIONS.md D31) that F1
  imagery, logos and typefaces may be used in the view. Credit sources in the
  footer. Driver headshots and team logos load at runtime from their source
  URLs; large images used as artwork live under `web/public/` as compressed
  WebP/JPG (no originals over 1 MB).

## Coordination

- **One agent per area at a time:** `ingest/` (Java), `model/` (Python),
  `api/` + view, `docs/`. Before editing, check that no other agent is working
  on the same area.
- Don't push, publish, deploy or create external accounts unless the project
  owner explicitly authorizes that specific action.
- `private/` is gitignored and out of scope for agents unless asked.
