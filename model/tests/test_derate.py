import numpy as np

from f1battery_model import derate, physics as ph, regimes


def synthetic_p(n=48, k0=16, tau=8, deploy=700.0, plateau=420.0, noise=0.0, seed=0):
    i = np.arange(n)
    h = np.clip(1.0 - (i - k0) / tau, 0.0, 1.0)
    rng = np.random.default_rng(seed)
    return plateau + (deploy - plateau) * h + rng.normal(0, noise, n)


def test_hinge_recovers_noise_free_ramp():
    p = synthetic_p()
    fit = derate.fit_hinge(p, rate_wkg_s=1000.0)
    assert fit is not None
    assert fit.t0_idx == 16 and fit.tau_steps == 8
    assert abs(fit.p_deploy - 700.0) < 1e-6 and abs(fit.p_plateau - 420.0) < 1e-6
    assert fit.sse < 1e-6


def test_hinge_recovers_ramp_with_noise():
    errs = []
    for seed in range(40):
        p = synthetic_p(noise=25.0, seed=seed)
        fit = derate.fit_hinge(p, rate_wkg_s=1000.0)
        errs.append((fit.t0_idx - 16) * ph.GRID)
        assert abs(fit.delta - 280.0) < 60.0
    assert np.mean(np.abs(errs)) < 0.75       # seconds; noise 25 W/kg vs a 280 W/kg step


def test_hinge_rate_bound_limits_slope():
    # A 280 W/kg drop over 2 s is 140 W/kg/s; a bound of 60 W/kg/s forbids it, so the
    # fitted ramp must be at least 280/60 s long.
    p = synthetic_p(n=64, k0=16, tau=8)
    fit = derate.fit_hinge(p, rate_wkg_s=60.0)
    assert fit is not None
    assert fit.delta / (fit.tau_steps * ph.GRID) <= 60.0 + 1e-9
    assert fit.tau_steps * ph.GRID >= 280.0 / 60.0 - 1e-9


def test_flat_signal_has_no_useful_ramp():
    rng = np.random.default_rng(1)
    p = 700.0 + rng.normal(0, 20.0, 48)
    fit = derate.fit_hinge(p, rate_wkg_s=1000.0)
    # Either no feasible hinge or one that explains almost nothing relative to the noise.
    assert fit is None or fit.sse / fit.sse_flat > 0.7


def test_deploy_energy_constant_acceleration():
    # a = 2 m/s^2 for 4 s from 50 m/s: sum(a v dt) approximates the specific kinetic-energy change (v1^2 - v0^2) / 2.
    dt = ph.GRID
    t = np.arange(0, 4.0, dt)
    v = 50.0 + 2.0 * t
    a = np.full_like(t, 2.0)
    e = derate.deploy_energy(a, v, 0.0)
    expected = 0.5 * ((50.0 + 2.0 * 4.0) ** 2 - 50.0 ** 2)   # integral over the full 4 s
    assert abs(e - expected) / expected < 0.01
    # Referencing to a plateau acceleration removes that part of the surplus.
    assert abs(derate.deploy_energy(a, v, 2.0)) < 1e-9
    assert derate.deploy_energy(a, v, 1.0) < e


def test_deploy_energy_is_linear_in_reference():
    rng = np.random.default_rng(3)
    a = rng.uniform(0, 3, 30)
    v = rng.uniform(60, 90, 30)
    e0 = derate.deploy_energy(a, v, 0.0)
    e1 = derate.deploy_energy(a, v, 0.7)
    assert abs((e0 - e1) - 0.7 * v.sum() * ph.GRID) < 1e-9


def test_threshold_crossing_requires_speed_and_persistence():
    a = np.concatenate([np.full(10, 3.0), np.full(10, 0.1)])
    v = np.full(20, 300.0)
    assert derate.threshold_crossing(a, v) == 10
    assert derate.threshold_crossing(a, np.full(20, 200.0)) is None
    blip = np.full(20, 3.0)
    blip[5:7] = 0.0                      # only two steps below the threshold
    assert derate.threshold_crossing(blip, v) is None


def test_regime_bins_and_agreement():
    d = np.arange(0, 200.0, 5.0)
    lab = np.where(d < 100, regimes.DEPLOY, regimes.PLATEAU).astype(np.int8)
    bins = regimes.lap_bin_labels(d, lab)
    assert list(bins) == [regimes.DEPLOY, regimes.DEPLOY, regimes.PLATEAU, regimes.PLATEAU]
    shares = regimes.lap_shares(bins)
    assert shares["deploy"] == 0.5 and shares["plateau"] == 0.5 and shares["lift"] == 0.0
    other = np.array([regimes.DEPLOY, regimes.PLATEAU, regimes.PLATEAU, regimes.PLATEAU], dtype=np.int8)
    agr = regimes.agreement([bins, other])
    assert agr["pairs"] == 1 and abs(agr["mean"] - 0.75) < 1e-12
