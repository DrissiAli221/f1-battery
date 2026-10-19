package dev.f1battery.ingest;

import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import org.springframework.boot.ApplicationArguments;

/**
 * Command-line options. {@code --sessions} filters on session_name (never
 * session_type, which lumps sprints with races); spaces in names may be written
 * as '_' or '-' so the list survives shell word splitting. {@code --refresh=drivers}
 * re-fetches the named endpoints even where the ingestion log marks them
 * complete (used to backfill columns added after the first ingest).
 */
public record IngestOptions(String source, int year, Integer sessionKey, List<String> sessionNames, boolean dryRun,
        Set<String> refresh) {

    public IngestOptions {
        if (!source.equals("local") && !source.equals("api")) {
            throw new IllegalArgumentException("--source must be local or api, got '" + source + "'");
        }
        refresh = refresh == null ? Set.of() : Set.copyOf(refresh);
        for (String e : refresh) {
            if (!REFRESHABLE.contains(e)) {
                throw new IllegalArgumentException("--refresh supports " + REFRESHABLE + ", got '" + e + "'");
            }
        }
    }

    /** Session-wide endpoints that may be re-fetched past the completed-unit skip. */
    static final Set<String> REFRESHABLE = Set.of("drivers");

    public IngestOptions(String source, int year, Integer sessionKey, List<String> sessionNames, boolean dryRun) {
        this(source, year, sessionKey, sessionNames, dryRun, Set.of());
    }

    public static IngestOptions from(ApplicationArguments args) {
        String source = first(args, "source").orElseThrow(() -> new IllegalArgumentException("--source=local|api is required"));
        int year = first(args, "year").map(Integer::parseInt).orElse(2026);
        Integer key = first(args, "session").map(Integer::valueOf).orElse(null);
        List<String> names = first(args, "sessions")
                .map(v -> List.of(v.split(",")).stream().map(IngestOptions::normalise).filter(s -> !s.isEmpty()).toList())
                .orElse(List.of());
        Set<String> refresh = first(args, "refresh")
                .map(v -> Set.copyOf(List.of(v.split(",")).stream().map(String::trim).filter(s -> !s.isEmpty()).toList()))
                .orElse(Set.of());
        return new IngestOptions(source, year, key, names, args.containsOption("dry-run"), refresh);
    }

    public boolean accepts(String sessionName, int key) {
        if (sessionKey != null && sessionKey != key) {
            return false;
        }
        return sessionNames.isEmpty() || sessionNames.contains(normalise(sessionName));
    }

    private static Optional<String> first(ApplicationArguments args, String name) {
        List<String> v = args.getOptionValues(name);
        return v == null || v.isEmpty() ? Optional.empty() : Optional.of(v.get(0));
    }

    private static String normalise(String name) {
        return name == null ? "" : name.replace('_', ' ').replace('-', ' ').trim().toLowerCase(Locale.ROOT);
    }
}
