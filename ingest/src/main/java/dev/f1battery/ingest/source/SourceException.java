package dev.f1battery.ingest.source;

/** A fetch that cannot be retried or whose retries are exhausted. */
public class SourceException extends RuntimeException {

    public SourceException(String message) {
        super(message);
    }

    public SourceException(String message, Throwable cause) {
        super(message, cause);
    }
}
