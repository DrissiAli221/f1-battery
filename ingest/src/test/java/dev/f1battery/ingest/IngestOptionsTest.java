package dev.f1battery.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;

class IngestOptionsTest {

    private static IngestOptions parse(String... args) {
        return IngestOptions.from(new DefaultApplicationArguments(args));
    }

    @Test
    void apiSourceDefaultsToTheModelledSessions() {
        IngestOptions o = parse("--source=api");
        assertThat(o.accepts("Race", 1)).isTrue();
        assertThat(o.accepts("Qualifying", 2)).isTrue();
        assertThat(o.accepts("Sprint", 3)).isTrue();
        assertThat(o.accepts("Sprint Qualifying", 4)).isTrue();
        assertThat(o.accepts("Practice 1", 5)).isFalse();
    }

    @Test
    void explicitSessionsOrKeyOverrideTheApiDefault() {
        assertThat(parse("--source=api", "--sessions=Practice_1").accepts("Practice 1", 5)).isTrue();
        assertThat(parse("--source=api", "--session=5").accepts("Practice 1", 5)).isTrue();
    }

    @Test
    void localSourceHasNoDefaultFilter() {
        assertThat(parse("--source=local").accepts("Practice 1", 5)).isTrue();
    }
}
