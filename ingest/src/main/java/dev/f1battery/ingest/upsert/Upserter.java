package dev.f1battery.ingest.upsert;

import java.util.List;

/** Idempotent bulk write of one table. */
public interface Upserter<T> {

    String table();

    /**
     * Writes the rows and returns how many were inserted or changed. Rows that
     * already exist unchanged count as zero, so a repeated run reports 0.
     */
    int upsert(List<T> rows);
}
