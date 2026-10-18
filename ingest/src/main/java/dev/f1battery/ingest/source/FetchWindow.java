package dev.f1battery.ingest.source;

import java.time.OffsetDateTime;

/**
 * One unit of per-driver telemetry: [start, end) plus a label. The label is
 * the ingestion_log window_label: the backup file suffix ("w180_00", "w20_03"),
 * "30_<index>" for legacy unprefixed files, or "<minutes>_<index>" for the API.
 * Overlapping windows of different sizes share a start; the label tells them apart.
 */
public record FetchWindow(String label, OffsetDateTime start, OffsetDateTime end) {

    /** Window length that covers a whole session in the backup (the "w180" files). */
    public static final int WHOLE_SESSION_MINUTES = 180;

    /** Nominal window {@code index} of {@code minutes} length from the session start. */
    public static FetchWindow nominal(String label, OffsetDateTime sessionStart, OffsetDateTime sessionEnd,
            int minutes, int index) {
        OffsetDateTime start = sessionStart.plusMinutes((long) minutes * index);
        OffsetDateTime end = minutes >= WHOLE_SESSION_MINUTES && index == 0 ? sessionEnd : start.plusMinutes(minutes);
        if (end.isAfter(sessionEnd) && sessionEnd.isAfter(start)) {
            end = sessionEnd;
        }
        return new FetchWindow(label, start, end);
    }
}
