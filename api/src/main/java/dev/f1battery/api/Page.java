package dev.f1battery.api;

import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Pagination envelope shared by every list endpoint. Pages are zero-based. */
public record Page<T>(List<T> items, int page, int size, long total) {

    public static final int DEFAULT_SIZE = 100;
    public static final int MAX_SIZE = 1000;

    /** Rejects out-of-range paging parameters with a 400 rather than silently clamping. */
    public static void validate(int page, int size) {
        if (page < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "page must be >= 0");
        }
        if (size < 1 || size > MAX_SIZE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "size must be between 1 and " + MAX_SIZE);
        }
    }

    /** Slices an already materialised list; used where rows are assembled in memory. */
    public static <T> Page<T> of(List<T> all, int page, int size) {
        validate(page, size);
        long from = (long) page * size;
        int start = (int) Math.min(from, all.size());
        int end = (int) Math.min(from + size, all.size());
        return new Page<>(List.copyOf(all.subList(start, end)), page, size, all.size());
    }
}
