package dev.f1battery.ingest.source;

import static org.assertj.core.api.Assertions.assertThat;

import dev.f1battery.ingest.source.OpenF1Records.*;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;

class LocalBackupSourceTest {

    private final LocalBackupSource source = new LocalBackupSource(Path.of("src/test/resources/backup"));

    private SessionRecord race() {
        return source.sessions(2026).stream().filter(s -> s.sessionKey() == 11234).findFirst().orElseThrow();
    }

    @Test
    void listsOnlySessionsWithABackupDirectory() {
        assertThat(source.sessions(2026)).extracting(SessionRecord::sessionKey).containsExactly(11234, 11257);
        assertThat(race().sessionName()).isEqualTo("Race");
        assertThat(race().dateStart()).isEqualTo(OffsetDateTime.parse("2026-03-08T04:00:00Z"));
    }

    @Test
    void parsesSessionWideEndpoints() {
        assertThat(source.fetch(Endpoint.DRIVERS, race())).hasSize(2)
                .extracting(DriverRecord::driverNumber).containsExactlyInAnyOrder(10, 63);
        List<LapRecord> laps = source.fetch(Endpoint.LAPS, race());
        assertThat(laps).hasSize(6);
        assertThat(laps.get(0).sessionKey()).isEqualTo(11234);
        assertThat(source.fetch(Endpoint.STARTING_GRID, race())).isEmpty();
    }

    @Test
    void lappedGapIsKeptAsText() {
        List<IntervalRecord> rows = source.fetch(Endpoint.INTERVALS, race());
        assertThat(rows).extracting(IntervalRecord::gapToLeader).anyMatch(v -> v instanceof String s && s.equals("+1 LAP"));
        assertThat(rows).extracting(IntervalRecord::gapToLeader).anyMatch(v -> v instanceof Number);
    }

    @Test
    void telemetryWindowsAreDerivedFromFileNames() {
        List<FetchWindow> windows = source.windows(Endpoint.CAR_DATA, race(), 10);
        assertThat(windows).extracting(FetchWindow::label).containsExactly("w180_00", "w20_00");
        FetchWindow whole = windows.get(0);
        // The whole-session file is keyed by the session bounds.
        assertThat(whole.start()).isEqualTo(race().dateStart());
        assertThat(whole.end()).isEqualTo(race().dateEnd());
        // Same start as the whole-session window; the label keeps the log keys apart.
        assertThat(windows.get(1).start()).isEqualTo(whole.start());
        assertThat(windows.get(1).label()).isNotEqualTo(whole.label());
        assertThat(source.windows(Endpoint.CAR_DATA, race(), 99)).isEmpty();
    }

    @Test
    void parsesTelemetryRows() {
        FetchWindow w = source.windows(Endpoint.CAR_DATA, race(), 63).get(0);
        List<CarDataRecord> rows = source.fetch(Endpoint.CAR_DATA, race(), 63, w);
        assertThat(rows).hasSize(5);
        assertThat(rows.get(0).driverNumber()).isEqualTo(63);
        assertThat(rows.get(0).drs()).isNull();
        assertThat(rows.get(0).date()).isNotNull();
        FetchWindow lw = source.windows(Endpoint.LOCATION, race(), 63).get(0);
        assertThat(source.fetch(Endpoint.LOCATION, race(), 63, lw)).hasSize(5);
    }

    @Test
    void legacyUnprefixedFileNamesAreThirtyMinuteSlices() {
        FetchWindow w = FetchWindow.nominal("02", race().dateStart(), race().dateEnd(), 30, 2);
        assertThat(w.start()).isEqualTo(race().dateStart().plusMinutes(60));
        assertThat(w.end()).isEqualTo(race().dateStart().plusMinutes(90));
    }

    @Test
    void sessionWithNoDataYieldsEmptyLists() {
        SessionRecord quali = source.sessions(2026).stream().filter(s -> s.sessionKey() == 11257).findFirst().orElseThrow();
        assertThat(source.fetch(Endpoint.LAPS, quali)).isEmpty();
        assertThat(source.fetch(Endpoint.DRIVERS, quali)).isEmpty();
    }
}
