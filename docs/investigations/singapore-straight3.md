# Singapore race 11388, straight 3: what the hinge detector flags

Scripts: `model/investigations/`
(run `sg_straight3_extract.py` first). Figures: `model/out/investigations/` (`sg_s3_flagged_vs_not.png`,
`sg_s3_threshold.png`, `sg_p_time_speed.png`). CdA 0.94 m^2; flag share reproduced (272 / 989).

## Findings

**The drop is on almost every lap; the flag is not.** 922 of 963 fitted laps (95.7 %) pass the drop, variance
and 210 kph tests; 650 of 691 unflagged laps fail only the plateau-acceleration test. Unflagged laps have the
same ramp start (1117 vs 1112 m) and drop (182 vs 208 kW). Straight 6 passes the same tests on 93 % of laps.
Flagged and unflagged traces overlap within their 10-90 % bands.

**The ramp start is not identified.** On 62 % of straight-3 laps (straight 6: 98 %) it sits at the earliest index
allowed (`MIN_DEPLOY_STEPS`, 0.5 s into the fit): `p` peaks ~0.75 s after full throttle and then declines
monotonically (~700 to ~450 W/kg) with no flat deploy level. Monza T1->Roggia shows the same (85 %);
Lesmo->Ascari does not.

| | hypothesis | evidence |
|---|---|---|
| a | car-specific derate at a fixed point | No. Drop on 91-100 % of laps for every car, start pinned at the fit boundary. What varies by car is end-of-straight acceleration (1.66 m/s^2 car 63, 0.45 car 18), so the clean-air flag share runs 0-95 %. |
| b | tow / traffic | No. Gap ahead < 1 s at section start: 12.6 % flagged (n = 175); >= 1 s: 31.7 %; > 2 s: 34.7 %. A tow raises plateau acceleration (1.65 vs 1.12). |
| c | Overtake | Enabled 12:05:07, never disabled, so availability = gap < 1 s: flags rarer when available. Car behind within 1 s: 26.9 % vs 28.5 %. |
| d | shift / rev limit | Upshift within 0.5 s of the ramp start on 96 % of laps, only because the pinned start falls in the 5-6 shift zone. rpm peaks at 11.6k (median), no limiter plateau. |
| e | geometry | Gradient below 0.4 %. A flat-out bend at 1320-1500 m (26 deg, radius ~400 m, ~1.6 g at 285-290 kph) lies under the "plateau" window and lowers its acceleration; it is after the ramp start. Later lifts lower it too (Spearman -0.54). |
| f | thresholds | Yes. Flag share vs plateau limit is smooth: 13.5 / 20.4 / 28.2 / 41.7 / 56.9 % at 0.8-1.2 m/s^2. CdA 0.74 / 0.94 / 1.14: 27.1 / 28.2 / 28.8 %. |

**Is the decline in `p` real?** Partly, probably: median `p` against speed differs between straights (250 kph:
straight 3 625, straight 6 456, straight 1 586 W/kg), which a CdA error alone cannot produce; it follows time
since full throttle more closely, consistent with power front-loaded at corner exit. The taper/drag degeneracy
(phase3-regimes.md) remains.

## Verdict

(f), with the bend (e) and car top-end acceleration as contributors. The 27.5 % is the tail of a continuous
plateau-acceleration distribution (median 1.14 m/s^2) cut at 1.0. The underlying feature, a smooth decline in `p`
after corner exit, is on ~96 % of laps on straights 3 and 6 for all cars.

## Implications and recommendation

With `t0` at the fit boundary the hinge cannot separate a smooth taper from "ramp then plateau", so the ramp
start is not a measurement there (including Monza T1->Roggia, 1103-1120 m). The detector stays experimental.

Proposed decision: (1) keep the Singapore expectation; (2) require an interior ramp start (>= 1 s of deploy level
before `t0`) and report boundary fits as "no identified ramp"; (3) do not tune the plateau limit (0.8-1.2 gives
13-57 %); (4) decide "a cut exists" from the spike crossing (option b in phase3-regimes.md) and use the hinge
for position only where `t0` is interior. Re-run `check_phase3` with (2) before changing the exit condition.
