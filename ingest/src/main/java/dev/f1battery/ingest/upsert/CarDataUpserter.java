package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.CarDataRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class CarDataUpserter extends BatchUpserter<CarDataRecord> {

    public CarDataUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public CarDataUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "car_data",
                List.of("ts", "session_key", "driver_number", "speed", "throttle", "brake", "rpm", "n_gear", "drs"),
                "session_key, driver_number, ts", List.of(), Set.of(), batchSize);
    }

    @Override
    List<Object> key(CarDataRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber(), instant(r.date()));
    }

    @Override
    Object[] values(CarDataRecord r) {
        return new Object[] {r.date(), r.sessionKey(), r.driverNumber(), r.speed(), r.throttle(), r.brake(), r.rpm(), r.nGear(), r.drs()};
    }
}
