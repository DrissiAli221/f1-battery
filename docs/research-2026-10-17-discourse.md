# What people are saying about 2026 energy management (2026-10-17)

Independent research by Claude (Fable 5.1) with four Haiku researchers (fan
forums, technical media, driver/team/FIA quotes, practitioner code). Marks:
**(F)** fetched and read, **(S)** search snippet only, **(V)** verified by
Claude directly. Reddit and f1technical.net forum pages refused fetches, so
fan-thread claims rest on snippets.

## The effect we measure is public knowledge, under the name "derating"
- Media describe it in words: speeds "peak in the first half of the straight,
  then plateau or fall" (PlanetF1 Monza, S). Russell: derate is limited to
  50 kW/s from 350 kW to 0 (The Race 04-20, F). arXiv 2603.01290 (V) models a
  rival's ERS with an explicit L_derate state, on simulated data only.
- Nobody found publishes a per-straight cut-off distance per car across a
  season. Closest: j5t3313/season_opening_analysis (0 stars, F) flags
  super-clipping where throttle ≥ 95 % and dSpeed/dDistance < −0.02 after
  Savitzky–Golay (window 13), Australia and China qualifying only, no
  braking-guard discussion, no validation. arXiv 2603.01290 defines the
  distance where speed starts falling from the sector maximum.
- Practitioner detectors are all smoothed-gradient-plus-throttle-gate, none
  validated, all 0–2 stars, none season-wide. A forum poster withdrew clipping
  claims because public traces have dropped frames (S).

## Overtakes and energy: the hypothesis is widely believed, never measured
- Norris, Suzuka (The Race 04-04, F): "It's just my battery deploys, I don't
  want it to deploy, but I can't control it." Battles described as
  "yo-yoing"; a pass attributed to deployment timing.
- Verstappen, Suzuka (F): using the battery behind another car is
  "completely inefficient"; team radio asked "where then to lift" (S).
- Norris (pitdebrief, F): "I literally had 5% of my battery coming out the
  last corner. There was no point of trying to defend."
- Alonso, Silverstone (F): "You just press one button and you overtake if
  you have a better power unit than the car in front."
- Ocon (crash.net, F): "Boost usage has been a nightmare, if you use it, you
  actually go backwards."
- A r/F1Technical post on Canada 2026 read Hamilton's top speed falling, then
  recovering before the lap-62 pass, as save-then-attack (S, from the other
  agent's search). One anecdote, no statistics anywhere.
- No source gives pass counts for Overtake mode vs DRS.

## Rules in practice: limits move per event and sources disagree
- The Race 2026-05-02 (V): qualifying recharge forecasts per track, 5 MJ
  (Monza) to 9 MJ (Monaco, Hungary, Singapore). Now in docs/regulations.md.
- FIA Suzuka notice 2026-03-26 (formula1.com, F): qualifying 9→8 MJ.
- FIA clarification before Miami (PlanetF1 05-01, F, paraphrased): the 7 MJ
  cut was not blanket; Miami race 9, quali 8, practice 9.
- Monza race weekend: 5 MJ quali, reportedly 7 MJ race, 9 MJ out-laps
  (The Race 09-04, F). Piastri: a higher harvest limit would mean "30 or 40
  km/h" lost per straight. Consistent with our spike finding no harvest-
  under-throttle at Monza.
- April package (Motor Sport Magazine 04-20, F): super-clip target 2–4 s per
  lap; peak 250→350 kW; race boost +150 kW; 350 kW in key zones, 250
  elsewhere; lower-energy events 8→12.
- Conflicts seen: base cap 8.5 vs 8 MJ; super-clip 250 vs 350 kW (different
  stages of the proposal); Miami 9→8 vs 8→7 (quali vs baseline).

## Speed-loss figures reported (for sanity-checking Phase 3)
- Bahrain testing T12: 267→233 km/h (The Race 02-25, F, unsourced).
- Suzuka: up to 50 km/h lost before 130R and the chicane (The Race 03-27, F).
- Spa (PlanetF1 07-20, F): 34 km/h after T7, 31 after T13, 50 between T15
  and the chicane; Kemmel top speed 328 vs 341 in 2025.
- Hadjar: Spa "energy-starved", Hungary "energy-rich" (PlanetF1 07-29, F).

## Battery data stays hidden, and fans mind
- Domenicali, 31 Jul 2026 (Autosport, Motorsport Week, F): "No one is
  interested in how you drive your car"; "The people are interested if
  you're overtaking or not"; the data "is available". Graphics vanished at
  Silverstone and Spa, returned at Hungary (S).
- Verstappen, Feb (F): "Formula E on steroids"; "you cannot drive like that".
- Stella (F): the accidental-deploy behaviour is "probably avoidable" by
  regulation.

## What this means for the project
1. Keep the pitch: measured derating per car, season-wide, tested against
   overtakes. Everyone talks about it; nobody has counted it.
2. Phase 3 must model the cut-off as a ramp (50 kW/s) and tolerate dropped
   frames; the 1.5 s brake guard stays.
3. The lift-and-reapply 200 kW burst is a real confound for "lift" labels.
4. Per-event qualifying limits exist publicly; race limits mostly don't.
   Monza's low limit explains the absent super-clip, and means clip
   behaviour will differ a lot by event. Baku (8.5) and Las Vegas (6) are
   the events to look at next for harvest-under-throttle.
5. The driver quotes are the write-up's opening: the hypothesis is the
   paddock's own belief, stated in their words, and nobody has tested it.
