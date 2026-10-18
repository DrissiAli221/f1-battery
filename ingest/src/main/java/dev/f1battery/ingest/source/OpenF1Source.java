package dev.f1battery.ingest.source;

import dev.f1battery.ingest.source.OpenF1Records.SessionRecord;
import java.util.List;

/**
 * Where OpenF1 JSON comes from (DECISIONS.md D9). Parsing and upsert are
 * identical for both sources; only the fetch differs.
 *
 * <p>An endpoint with no data (404, empty file) yields an empty list, never an
 * exception. Exceptions mean the fetch failed and should be retried later.
 */
public interface OpenF1Source {

    /** "local" or "api"; the value stored in ingestion_log.source. */
    String name();

    /** Sessions of the year that this source can serve. */
    List<SessionRecord> sessions(int year);

    /** A once-per-session endpoint (everything except car_data and location). */
    <T> List<T> fetch(Endpoint<T> endpoint, SessionRecord session);

    /** The telemetry windows to fetch for one driver. */
    List<FetchWindow> windows(Endpoint<?> endpoint, SessionRecord session, int driverNumber);

    /** One telemetry window for one driver (car_data or location). */
    <T> List<T> fetch(Endpoint<T> endpoint, SessionRecord session, int driverNumber, FetchWindow window);
}
