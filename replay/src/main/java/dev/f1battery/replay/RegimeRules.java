package dev.f1battery.replay;

/**
 * Sample-level regime rules, mirroring model/f1battery_model/regimes.py in structure (not in
 * numerics): brake first, then lift below full throttle, then deploy / plateau by acceleration.
 *
 * <p>Simplifications against the batch labeller: no brake guard and no post-lift burst
 * extension, and acceleration comes from a short centred difference rather than the
 * Savitzky-Golay fit. The batch model stays authoritative; this is a display estimate.
 */
public final class RegimeRules {

    /** Full-throttle threshold in percent (batch: physics.FULL_THROTTLE). */
    public static final int FULL_THROTTLE = 98;
    /** Acceleration threshold in m/s^2 separating deploy from plateau (batch: A_DEPLOY). */
    public static final double A_DEPLOY = 0.5;

    private RegimeRules() {}

    public static String classify(int throttle, int brake, double accel) {
        if (brake > 0) return "brake";
        if (throttle < FULL_THROTTLE) return "lift";
        if (accel > A_DEPLOY) return "deploy";
        if (Math.abs(accel) <= A_DEPLOY) return "plateau";
        return "other"; // full throttle but decelerating faster than the plateau band
    }
}
