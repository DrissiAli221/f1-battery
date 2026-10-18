package dev.f1battery.replay;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class RegimeLabellerTest {

    static final Instant T0 = Instant.parse("2026-09-06T13:00:00Z");

    @Test
    void rulesFollowTheBatchLabeller() {
        assertEquals("brake", RegimeRules.classify(100, 100, 3.0)); // brake wins over everything
        assertEquals("brake", RegimeRules.classify(0, 100, -20.0));
        assertEquals("lift", RegimeRules.classify(97, 0, 4.0));
        assertEquals("lift", RegimeRules.classify(0, 0, -1.0));
        assertEquals("deploy", RegimeRules.classify(100, 0, 0.51));
        assertEquals("plateau", RegimeRules.classify(98, 0, 0.5));
        assertEquals("plateau", RegimeRules.classify(100, 0, -0.5));
        assertEquals("other", RegimeRules.classify(100, 0, -0.6));
    }

    static Sample s(int i, int speedKph, int thr, int brk) {
        return new Sample(1, 44, T0.plusMillis(250L * i), speedKph, thr, brk, i, 2 * i);
    }

    @Test
    void labelsTheMiddleSampleOfAFullWindow() {
        DriverWindow w = new DriverWindow();
        for (int i = 0; i < 4; i++) assertTrue(w.add(s(i, 200, 100, 0)).isEmpty());
        var out = w.add(s(4, 200, 100, 0)).orElseThrow();
        assertEquals(2, out.sample().x()); // sample index 2 of 0..4
        assertEquals("plateau", out.regime());
    }

    @Test
    void acceleratingAtFullThrottleIsDeploy() {
        DriverWindow w = new DriverWindow();
        DriverWindow.Labelled last = null;
        for (int i = 0; i < 8; i++) {
            // +4 km/h per 250 ms is about 4.4 m/s^2
            var o = w.add(s(i, 200 + 4 * i, 100, 0));
            if (o.isPresent()) last = o.get();
        }
        assertEquals("deploy", last.regime());
        assertEquals(4.44, last.accel(), 0.05);
    }

    @Test
    void distanceIsTheIntegralOfSpeed() {
        DriverWindow w = new DriverWindow();
        List<DriverWindow.Labelled> out = new ArrayList<>();
        for (int i = 0; i < 12; i++) w.add(s(i, 360, 100, 0)).ifPresent(out::add); // 100 m/s
        // Middle sample of the last window is index 9: 9 steps of 0.25 s at 100 m/s.
        assertEquals(225.0, out.get(out.size() - 1).distanceM(), 1e-6);
    }

    @Test
    void gapResetsTheWindowAndMissingChannelsAreSkipped() {
        DriverWindow w = new DriverWindow();
        for (int i = 0; i < 5; i++) w.add(s(i, 200, 100, 0));
        assertTrue(w.add(new Sample(1, 44, T0.plusSeconds(30), 200, 100, 0, 0, 0)).isEmpty());
        assertTrue(w.add(new Sample(1, 44, T0.plusSeconds(31), null, 100, 0, 0, 0)).isEmpty());
    }
}
