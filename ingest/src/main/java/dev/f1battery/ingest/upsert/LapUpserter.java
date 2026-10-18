package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.LapRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class LapUpserter extends BatchUpserter<LapRecord> {

    public LapUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public LapUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "lap",
                List.of("session_key", "driver_number", "lap_number", "date_start", "lap_duration", "duration_sector_1", "duration_sector_2", "duration_sector_3", "is_pit_out_lap", "i1_speed", "i2_speed", "st_speed"),
                "session_key, driver_number, lap_number", List.of("date_start", "lap_duration", "duration_sector_1", "duration_sector_2", "duration_sector_3", "is_pit_out_lap", "i1_speed", "i2_speed", "st_speed"), Set.of(), batchSize);
    }

    @Override
    List<Object> key(LapRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber(), r.lapNumber());
    }

    @Override
    Object[] values(LapRecord r) {
        return new Object[] {r.sessionKey(), r.driverNumber(), r.lapNumber(), r.dateStart(), r.lapDuration(), r.durationSector1(), r.durationSector2(), r.durationSector3(), r.isPitOutLap(), r.i1Speed(), r.i2Speed(), r.stSpeed()};
    }
}
