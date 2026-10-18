package dev.f1battery.replay;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import java.time.Instant;

/** Latest regime estimate of one driver, published to {@code regime-state.<session_key>}. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record RegimeState(
        int sessionKey,
        int driverNumber,
        Instant ts,
        Integer x,
        Integer y,
        double speed,
        String regime,
        double lapDistanceEst) {}
