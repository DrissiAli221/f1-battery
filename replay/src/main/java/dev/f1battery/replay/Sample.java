package dev.f1battery.replay;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import java.time.Instant;

/**
 * One telemetry sample as published to {@code telemetry.<session_key>}. The position fields are
 * nullable because a car_data row can lack a matching location row.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record Sample(
        int sessionKey,
        int driverNumber,
        Instant ts,
        Integer speed,
        Integer throttle,
        Integer brake,
        Integer x,
        Integer y) {}
