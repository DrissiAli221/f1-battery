package dev.f1battery.ingest.source;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;

/**
 * Parsed OpenF1 rows, one record per endpoint. Only the fields that are stored
 * are declared; the mapper ignores the rest. Names map from snake_case JSON.
 * Fields whose JSON type varies between rows are typed loosely ({@code Object},
 * {@code JsonNode}) and normalised by the upserter.
 */
public final class OpenF1Records {

    private OpenF1Records() {}

    public record SessionRecord(Integer sessionKey, Integer meetingKey, Integer circuitKey,
            String sessionName, String sessionType, String countryName, String circuitShortName,
            OffsetDateTime dateStart, OffsetDateTime dateEnd, Integer year) {}

    public record DriverRecord(Integer sessionKey, Integer driverNumber, String nameAcronym,
            String fullName, String teamName, String headshotUrl, String teamColour, String firstName,
            String lastName, String broadcastName, String countryCode) {}

    public record LapRecord(Integer sessionKey, Integer driverNumber, Integer lapNumber,
            OffsetDateTime dateStart, Double lapDuration,
            @JsonProperty("duration_sector_1") Double durationSector1,
            @JsonProperty("duration_sector_2") Double durationSector2,
            @JsonProperty("duration_sector_3") Double durationSector3,
            Boolean isPitOutLap, Integer i1Speed, Integer i2Speed, Integer stSpeed) {}

    public record StintRecord(Integer sessionKey, Integer driverNumber, Integer stintNumber,
            Integer lapStart, Integer lapEnd, String compound, Integer tyreAgeAtStart) {}

    public record PitRecord(Integer sessionKey, Integer driverNumber, Integer lapNumber,
            OffsetDateTime date, Double pitDuration) {}

    public record OvertakeRecord(Integer sessionKey, OffsetDateTime date,
            Integer overtakingDriverNumber, Integer overtakenDriverNumber, Integer position) {}

    public record RaceControlRecord(Integer sessionKey, OffsetDateTime date, Integer driverNumber,
            Integer lapNumber, String category, String flag, String scope, Integer sector,
            String message) {}

    /** gapToLeader and interval are numbers, or text such as "+1 LAP" for lapped cars. */
    public record IntervalRecord(Integer sessionKey, Integer driverNumber, OffsetDateTime date,
            Object gapToLeader, Object interval) {}

    public record PositionRecord(Integer sessionKey, Integer driverNumber, OffsetDateTime date,
            Integer position) {}

    public record WeatherRecord(Integer sessionKey, OffsetDateTime date, Double airTemperature,
            Double trackTemperature, Double humidity, Double pressure, Integer rainfall,
            Integer windDirection, Double windSpeed) {}

    /** position is an integer, null, or a status code such as "RT". */
    public record SessionResultRecord(Integer sessionKey, Integer driverNumber, Object position,
            Integer numberOfLaps, Double points, Boolean dnf, Boolean dns, Boolean dsq,
            JsonNode duration, JsonNode gapToLeader) {}

    public record StartingGridRecord(Integer sessionKey, Integer driverNumber, Integer position,
            Double lapDuration) {}

    public record TeamRadioRecord(Integer sessionKey, Integer driverNumber, OffsetDateTime date,
            String recordingUrl) {}

    public record CarDataRecord(Integer sessionKey, Integer driverNumber, OffsetDateTime date,
            Integer speed, Integer throttle, Integer brake, Integer rpm, Integer nGear, Integer drs) {}

    public record LocationRecord(Integer sessionKey, Integer driverNumber, OffsetDateTime date,
            Integer x, Integer y, Integer z) {}
}
