package dev.f1battery.ingest.source;

/**
 * Where OpenF1 JSON comes from (DECISIONS.md D9). The parser and the upsert are
 * identical for both sources; only the fetch differs. Implementations to come:
 * <ul>
 *   <li>{@code ApiSource}: the live API (rate-limited, backs off on 429/5xx).</li>
 *   <li>{@code LocalBackupSource}: reads the raw backup in data/raw/openf1.</li>
 * </ul>
 * Interface only for now; the methods are defined in Phase 1.
 */
public interface OpenF1Source {
}
