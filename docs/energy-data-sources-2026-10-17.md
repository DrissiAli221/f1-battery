# Is estimation the only way to get 2026 energy data? (checked 2026-10-17)

Goal: exhaust every conceivable source of real per-car 2026 ERS / battery /
deployment / active-aero data before committing to estimating it. Checked by
Claude (Fable 5.1) directly where marked **(V)**, otherwise by three Sonnet
researchers; **(F)** = page fetched and read, **(S)** = search snippet only.

**Verdict: yes.** No public, paid, official or unofficial source carries
measured per-car energy state for 2026. Everything that exists is inferred
from speed, throttle and position. Estimation from public telemetry is the
only route, and the one remaining alternative (broadcast graphics) is
featured-car-only, intermittent, itself an estimate, and barred by F1TV terms.

## Every source checked

| # | Source | Energy data? | Evidence |
|---|---|---|---|
| 1 | **OpenF1 API**, all 18 endpoints | No | Docs scanned (V): zero hits for ers, energy, battery, boost, aero, deploy, harvest, charge, soc. car_data fields: brake, date, driver_number, drs, meeting_key, n_gear, rpm, session_key, speed, throttle |
| 2 | OpenF1 `drs` field (possible repurposing for Overtake mode) | No | `null` on all 186,886 Monza and 122,510 Singapore samples in our cache (V) |
| 3 | OpenF1 `race_control` | Partial, session-level only | Messages "OVERTAKE ENABLED" / "OVERTAKE DISABLED" exist (V). Gives Overtake-availability windows for the whole field, nothing per car |
| 4 | OpenF1 `laps` segments / mini-sectors | No | Fields are sector times, speed traps, segment colours (V) |
| 5 | **F1 live-timing SignalR feed** (what FastF1, OpenF1, MultiViewer, f1-dash all read) | No | FastF1 `_api.py` parses channels 0 rpm, 2 speed, 3 gear, 4 throttle, 5 brake, 45 drs only, with the 2026 comment "drs is no longer included in 2026" (F). 21 topics listed (CarData.z, Position.z, TimingData, …, TeamRadio): none energy-related. No new channel in code, changelog or issues |
| 6 | FastF1 maintainer statement | No | Discussion #861, 2026-03-14 (F): "F1 has decided to not make any data on active aero and ERS state available publicly"; active aero "was apparently trialed during pre-season testing but removed from the data feed again". Issue #864: "not yet available in the F1 public telemetry data" |
| 7 | Live-timing static archive `livetiming.formula1.com/static/<year>/` | Inaccessible | HTTP 401 for 2025 and 2026 Index.json since ~2026-10-15 (V, and FastF1 issue #978, F). Needs an F1 TV subscription bearer token. OpenF1 serves its own stored copies, so it still works |
| 8 | Official F1 Live Timing app, F1TV data channel | No | No per-car battery or Overtake indicator found (S). jonathansblog car-stats page: no mention (F) |
| 9 | **Broadcast graphics** (battery bar in the halo/driver-tracker graphic) | Featured cars only, intermittent, an estimate | Shown at Melbourne, "gradually phased out" (Autosport, F); absent at Silverstone and Spa, back at Hungary (GPFans, F). FastF1 #864 commenter: the graphic is "just an estimate, not data obtained from the teams" (F). Domenicali 2026-07-30: "no one is interested in how you drive your car" (F) |
| 10 | Video OCR of the broadcast | Not viable | No existing F1 OCR project found. F1TV terms 9.2(c) forbid recording/storing, 9.2(k) forbid "text or data mining or web scraping" (F). Also the bar vanishes in exactly the high-deployment battles that matter |
| 11 | AWS F1 Insights "Hybrid Energy System" | Derived estimate, not a feed | Computed from energy-balance equations on the previous lap (aboutamazon, F). No 2026 data product |
| 12 | Commercial providers: Sportradar (official betting data), Stats Perform, Genius, Sportec, Marelli (telemetry supplier), FOM data licensing | No evidence of ERS fields | Nothing advertised (S). Marelli carries car data to broadcast centres but nothing says ERS is exposed (F) |
| 13 | FIA documents (event notes, technical delegate and stewards reports) | No per-car energy figures | Only per-event limits, sent to teams under B7.2.1b, not published. Per-track qualifying forecasts leaked via The Race 2026-05-02 (V) |
| 14 | Teams and PU makers (Mercedes HPP, Ferrari, Honda, Audi, Red Bull Ford) | No | No per-lap energy publications found (S, weak search). A forum claim that FIA/FOM/teams agreed not to share SoC even internally is unverified (S) |
| 15 | Datasets: TracingInsights/2026, Kaggle, HuggingFace, Zenodo | No | TracingInsights fields: speed, throttle, brake, drs, rpm, gear, 3-axis acceleration at ~3.7 Hz from FastF1/MultiViewer (F). Nothing with 2026 ERS elsewhere |
| 16 | arXiv 2603.01290 | Simulated | HMM-POMDP on simulated data; real telemetry listed as future work (V) |
| 17 | Third-party tools: GP Tempo / f1-tempo.com, MultiViewer, f1-dash, undercut-f1, Jolpica | No | All relay the same live-timing feed or results. The Race's "GP Tempo data" Monza analysis is speed-trace comparison (V) |
| 18 | Team radio | Qualitative at best | OpenF1: "most events providing no radio data at all" in 2026 (F) |
| 19 | EA F1 26 game UDP | Not real data | Has ERS fields; no claim of calibration to real behaviour |
| 20 | FOM plans to publish later | None found | No roadmap or commitment (S). Domenicali says the data "is available" but for "a niche of our fans" |

## Consequences for the project

1. **D1 stands:** the hidden state must be estimated. There is no ground
   truth and no shortcut.
2. **OpenF1 is now the only free historical route.** FastF1's raw archive
   access broke on 2026-10-15 (401). OpenF1 keeps its own copies. Risk to
   record: OpenF1's ingestion of *future* races depends on its own feed
   access; cache everything locally (already the rule, AGENTS.md).
3. **One new usable signal:** `race_control` "OVERTAKE ENABLED/DISABLED"
   gives session-level Overtake availability windows. Add it to the
   HYPOTHESIS.md controls and to Phase 1 ingestion (already in scope via
   race_control).
4. **The broadcast bar is not a validation source either.** It is an FOM
   estimate, not team data, so matching it would prove agreement between two
   estimates, nothing more.
5. The estimate must stay labelled as an estimate. Nothing found changes the
   honest framing in README.md.
