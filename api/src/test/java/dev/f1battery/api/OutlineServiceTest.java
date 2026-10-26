package dev.f1battery.api;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The checks a candidate reference lap must pass before it becomes the circuit outline. */
class OutlineServiceTest {

    /** A 1000-unit (100 m) square, 100 units per sample, starting at sample {@code from}. */
    static List<Downsampler.Sample> square(int from, int n) {
        List<Downsampler.Sample> out = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            int k = (from + i) % 40;
            int side = k / 10;
            int along = (k % 10) * 100;
            double x = side == 0 ? along : side == 1 ? 1000 : side == 2 ? 1000 - along : 0;
            double y = side == 0 ? 0 : side == 1 ? along : side == 2 ? 1000 : 1000 - along;
            out.add(new Downsampler.Sample(x, y, 0));
        }
        return out;
    }

    static final double[] LINE = {0, 0};

    @Test
    void aClosedLapOfTheRightLengthFromTheLinePasses() {
        assertTrue(OutlineService.drawsTheCircuit(square(0, 40), 400.0, LINE));
        // Length is only checked when the circuit's lap length is known.
        assertTrue(OutlineService.drawsTheCircuit(square(0, 40), null, LINE));
        // Start is only checked when the session's line position is known.
        assertTrue(OutlineService.drawsTheCircuit(square(20, 40), 400.0, null));
    }

    @Test
    void tooFewSamplesFail() {
        assertFalse(OutlineService.drawsTheCircuit(List.of(), 400.0, LINE));
        assertFalse(OutlineService.drawsTheCircuit(square(0, OutlineService.MIN_SAMPLES - 1), null, null));
    }

    @Test
    void anOpenArcFailsOnLengthAndOnClosure() {
        // 30 of 40 samples: 290 m of a 400 m lap, ending 100 m from the start (Hungaroring race).
        assertFalse(OutlineService.drawsTheCircuit(square(0, 30), 400.0, LINE));
        assertFalse(OutlineService.drawsTheCircuit(square(0, 30), null, LINE));
    }

    @Test
    void aLapThatDoesNotStartAtTheLineFails() {
        // Closed and the right length, but the lap clock is off by a quarter lap.
        assertFalse(OutlineService.drawsTheCircuit(square(20, 40), 400.0, LINE));
        // Within START_TOLERANCE_M it passes: 400 units = 40 m along the first side.
        assertTrue(OutlineService.drawsTheCircuit(square(4, 40), 400.0, LINE));
    }

    @Test
    void lengthToleranceIsThreePercent() {
        assertTrue(OutlineService.drawsTheCircuit(square(0, 40), 390.0 / 0.97 - 0.5, LINE));
        assertFalse(OutlineService.drawsTheCircuit(square(0, 40), 450.0, LINE));
    }
}
