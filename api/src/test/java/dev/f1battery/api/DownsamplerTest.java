package dev.f1battery.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class DownsamplerTest {

    @Test
    void emptyInputGivesEmptyOutline() {
        assertThat(Downsampler.downsample(List.of(), 500)).isEmpty();
    }

    @Test
    void keepsPointsAtLeastSpacingApartAndPreservesTotalLength() {
        List<Downsampler.Sample> s = new ArrayList<>();
        for (int i = 0; i <= 100; i++) {
            s.add(new Downsampler.Sample(i * 30, 0, 5)); // 30 units per step, 3000 total
        }
        List<Downsampler.Point> out = Downsampler.downsample(s, 500);
        assertThat(out.get(0).d()).isZero();
        assertThat(out.get(out.size() - 1).d()).isEqualTo(3000.0);
        for (int i = 1; i < out.size() - 1; i++) {
            assertThat(out.get(i).d() - out.get(i - 1).d()).isGreaterThanOrEqualTo(500);
        }
        assertThat(out.size()).isLessThan(15);
    }

    @Test
    void distanceFollowsThePathNotTheChord() {
        List<Downsampler.Sample> s = List.of(
                new Downsampler.Sample(0, 0, 0), new Downsampler.Sample(300, 0, 0), new Downsampler.Sample(300, 400, 0));
        List<Downsampler.Point> out = Downsampler.downsample(s, 100);
        assertThat(out.get(out.size() - 1).d()).isEqualTo(700.0);
    }

    @Test
    void singleSampleYieldsOnePoint() {
        assertThat(Downsampler.downsample(List.of(new Downsampler.Sample(1, 2, 3)), 500)).hasSize(1);
    }
}
