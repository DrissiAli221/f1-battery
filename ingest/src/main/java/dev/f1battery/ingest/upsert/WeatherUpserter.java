package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.WeatherRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class WeatherUpserter extends BatchUpserter<WeatherRecord> {

    public WeatherUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public WeatherUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "weather",
                List.of("session_key", "date", "air_temperature", "track_temperature", "humidity", "pressure", "rainfall", "wind_direction", "wind_speed"),
                "session_key, date", List.of("air_temperature", "track_temperature", "humidity", "pressure", "rainfall", "wind_direction", "wind_speed"), Set.of(), batchSize);
    }

    @Override
    List<Object> key(WeatherRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), instant(r.date()));
    }

    @Override
    Object[] values(WeatherRecord r) {
        return new Object[] {r.sessionKey(), r.date(), r.airTemperature(), r.trackTemperature(), r.humidity(), r.pressure(), r.rainfall(), r.windDirection(), r.windSpeed()};
    }
}
