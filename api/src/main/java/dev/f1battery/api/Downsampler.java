package dev.f1battery.api;

import java.util.ArrayList;
import java.util.List;

/**
 * Reduces one lap of location samples to a coarse outline. Distance is the cumulative
 * x/y path length over the full-rate samples (so thinning does not shorten it); a point is
 * kept each time the path has advanced by at least {@code spacing} stored units since the
 * last kept point. The first and last samples are always kept.
 */
public final class Downsampler {

    public record Sample(double x, double y, double z) {}

    public record Point(double d, double x, double y, double z) {}

    private Downsampler() {}

    public static List<Point> downsample(List<Sample> samples, double spacing) {
        List<Point> out = new ArrayList<>();
        if (samples.isEmpty()) {
            return out;
        }
        double d = 0;
        double lastKept = 0;
        Sample prev = samples.get(0);
        out.add(new Point(0, prev.x(), prev.y(), prev.z()));
        for (int i = 1; i < samples.size(); i++) {
            Sample s = samples.get(i);
            d += Math.hypot(s.x() - prev.x(), s.y() - prev.y());
            prev = s;
            boolean last = i == samples.size() - 1;
            if (d - lastKept >= spacing || (last && d > lastKept)) {
                out.add(new Point(round1(d), s.x(), s.y(), s.z()));
                lastKept = d;
            }
        }
        return out;
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
