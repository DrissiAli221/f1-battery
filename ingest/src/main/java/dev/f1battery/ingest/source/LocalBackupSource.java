package dev.f1battery.ingest.source;

import dev.f1battery.ingest.source.OpenF1Records.SessionRecord;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.GZIPInputStream;

/**
 * Reads the raw backup written by tools/backup_openf1.py: one gzipped JSON array
 * per request under {@code <root>/<session_key>/}, plus {@code sessions_<year>}
 * at the root.
 *
 * <p>Telemetry file names are {@code <endpoint>_<driver>_<suffix>.json.gz}. The
 * suffix is {@code w<minutes>_<index>} (current layout) or just {@code <index>}
 * (the first Melbourne/Shanghai files, which are 30-minute slices). Window
 * identity is derived from the name alone so the resume check does not have to
 * open the file.
 */
public class LocalBackupSource implements OpenF1Source {

    private static final Pattern SUFFIX = Pattern.compile("(?:w(\\d+)_)?(\\d+)");
    private static final int LEGACY_SLICE_MINUTES = 30;

    private final Path root;

    public LocalBackupSource(Path root) {
        this.root = root;
    }

    @Override
    public String name() {
        return "local";
    }

    @Override
    public List<SessionRecord> sessions(int year) {
        Path file = root.resolve("sessions_" + year + ".json.gz");
        if (!Files.exists(file)) {
            throw new SourceException("missing " + file);
        }
        // Only sessions with a backup directory are served; practice sessions are
        // not part of the backup.
        return read(file, SessionRecord.class).stream()
                .filter(s -> s.sessionKey() != null && Files.isDirectory(root.resolve(String.valueOf(s.sessionKey()))))
                .sorted(Comparator.comparing(SessionRecord::dateStart, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
    }

    @Override
    public <T> List<T> fetch(Endpoint<T> endpoint, SessionRecord session) {
        Path file = sessionDir(session).resolve(endpoint.name() + ".json.gz");
        return Files.exists(file) ? read(file, endpoint.type()) : List.of();
    }

    @Override
    public List<FetchWindow> windows(Endpoint<?> endpoint, SessionRecord session, int driverNumber) {
        String prefix = endpoint.name() + "_" + driverNumber + "_";
        List<FetchWindow> out = new ArrayList<>();
        try (Stream<Path> files = Files.list(sessionDir(session))) {
            files.map(p -> p.getFileName().toString())
                    .filter(n -> n.startsWith(prefix) && n.endsWith(".json.gz"))
                    .sorted()
                    .forEach(n -> {
                        String suffix = n.substring(prefix.length(), n.length() - ".json.gz".length());
                        Matcher m = SUFFIX.matcher(suffix);
                        if (!m.matches()) {
                            return;
                        }
                        int minutes = m.group(1) != null ? Integer.parseInt(m.group(1)) : LEGACY_SLICE_MINUTES;
                        int index = Integer.parseInt(m.group(2));
                        out.add(FetchWindow.nominal(m.group(1) != null ? suffix : LEGACY_SLICE_MINUTES + "_" + suffix, start(session), end(session), minutes, index));
                    });
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out;
    }

    @Override
    public <T> List<T> fetch(Endpoint<T> endpoint, SessionRecord session, int driverNumber, FetchWindow window) {
        Path file = sessionDir(session).resolve(endpoint.name() + "_" + driverNumber + "_" + fileSuffix(window.label()) + ".json.gz");
        return Files.exists(file) ? read(file, endpoint.type()) : List.of();
    }

    /** Inverse of the label rule in {@link #windows}: legacy labels are "30_<index>". */
    private static String fileSuffix(String label) {
        return label.startsWith("w") ? label : label.substring(label.indexOf('_') + 1);
    }

    private Path sessionDir(SessionRecord s) {
        return root.resolve(String.valueOf(s.sessionKey()));
    }

    static OffsetDateTime start(SessionRecord s) {
        return s.dateStart() != null ? s.dateStart() : OffsetDateTime.of(1970, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    }

    static OffsetDateTime end(SessionRecord s) {
        return s.dateEnd() != null ? s.dateEnd() : start(s).plusHours(3);
    }

    private static <T> List<T> read(Path file, Class<T> type) {
        try (InputStream in = new GZIPInputStream(Files.newInputStream(file), 1 << 16)) {
            return OpenF1Json.parseList(in, type);
        } catch (IOException e) {
            throw new SourceException("cannot read " + file, e);
        }
    }
}
