# Rules for AI agents working in this repo

Applies to Claude, Codex and any other agent. Read README.md and PLAN.md first.

## The point of this project

Ali builds this to understand it and defend it in interviews, not just to own
it. Agents write code, but:

- **Explain as you go.** Every non-trivial change ends with a short "what and
  why" note in the PR/commit message or your reply. Write it so a student can
  study from it.
- **Never decide architecture silently.** If a choice changes the design,
  propose it, and Ali records it in DECISIONS.md.
- **Stay inside the current phase** (PLAN.md). Don't start the next phase early.

## Truth rules

- **Never fabricate results, numbers or plots.** A finding is only one that a
  committed script reproduces from data.
- Battery/energy outputs are always labelled **estimates** with their
  assumptions. Never call them measured.
- Every FIA limit used in code comes from `docs/regulations.md`, with the
  issue number and article. No magic constants.
- HYPOTHESIS.md is frozen once dated. Don't edit it after Phase 4 output
  exists. Deviations go in DECISIONS.md, explained.
- Report failures plainly (a test that failed, a spike that didn't work).

## Data rules

- OpenF1 free tier: **≤3 req/s and ≤30 req/min**, non-commercial use only.
  Back off on 429/5xx. Cache responses locally.
- Raw and derived data are **never committed**. `data/` and any dumps are
  gitignored.
- Public outputs: aggregates or a recorded demo only (DECISIONS.md D5).
- Not affiliated with F1, FIA or FOM. Don't use their logos.

## Coordination

- **One agent per area at a time:** `ingest/` (Java), `model/` (Python),
  `api/` + view, `docs/`. Before editing, check that no other agent is working
  on the same area (ask Ali if unsure).
- Don't push, publish, deploy or create external accounts unless Ali
  explicitly authorizes that specific action.

## Study gates

At the end of each phase, Claude runs the gate in PLAN.md: Ali explains the
phase without notes, then gets "why" follow-up questions. Record pass or fail
with the date in DECISIONS.md. Phase work only goes on Ali's CV after its gate
is passed.
