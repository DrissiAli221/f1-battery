# f1-battery

F1 does not publish battery (ERS) data in 2026. This project estimates each
car's energy management from public telemetry, then tests one pre-registered
question against real overtakes.

Status: **Phase S (feasibility spike)**, not started. See [PLAN.md](PLAN.md).

## Why this exists

The 2026 cars split power roughly between combustion and electric, and energy
management (deployment, harvesting, "super-clipping") decides races. But F1
chose not to publish ERS or active-aero data
([FastF1 maintainer, 2026-03-14](https://github.com/theOehrly/Fast-F1/discussions/861)).
The FIA rules do say exactly how much electric power a car may use at each
speed (Section C, Article C5.2.8). So the hidden state is partly constrained by
known rules, and that's what makes estimating it worth trying.

Several small per-race estimators already exist (see DECISIONS.md D1). What
this project adds is a season-wide engineered pipeline and a pre-registered
test against an observable outcome (overtakes).

## Honest framing

Everything this project produces is an **estimate under stated assumptions**
(engine power, mass, drag), never a measurement. There is no ground truth. If
the feasibility spike shows the state can't be separated from noise, the
output is renamed an "energy-management proxy" (see DECISIONS.md).

## Files

| File | Purpose |
|---|---|
| [PLAN.md](PLAN.md) | Phases, exit conditions, study gates |
| [AGENTS.md](AGENTS.md) | Rules every AI agent follows in this repo |
| [DECISIONS.md](DECISIONS.md) | Decision log: what was chosen and why |
| [HYPOTHESIS.md](HYPOTHESIS.md) | Pre-registered test. Frozen before Phase 4 output exists |
| [docs/regulations.md](docs/regulations.md) | FIA energy limits per event, cited |
| [docs/research-2026-10-17.md](docs/research-2026-10-17.md) | Original idea research, data checks |
| [spike/](spike/) | Throwaway feasibility notebook |

## Data

[OpenF1](https://openf1.org/) (free historical tier, non-commercial use), plus
[FastF1](https://docs.fastf1.dev/) where useful. Not affiliated with Formula 1,
FIA or FOM. Raw data is never committed or redistributed.
