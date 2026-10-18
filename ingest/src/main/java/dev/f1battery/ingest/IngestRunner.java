package dev.f1battery.ingest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ExitCodeGenerator;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Entry point of the job: parses the arguments, runs the ingestion and turns
 * the outcome into the process exit code (0 on success, 1 if any unit failed,
 * 2 for unusable arguments). Disabled with {@code ingest.run-on-startup=false}
 * so that tests can build the context and call {@link IngestService} directly.
 */
@Component
@ConditionalOnProperty(name = "ingest.run-on-startup", havingValue = "true", matchIfMissing = true)
public class IngestRunner implements ApplicationRunner, ExitCodeGenerator {

    private static final Logger log = LoggerFactory.getLogger(IngestRunner.class);

    private final IngestService service;
    private volatile int exitCode;

    public IngestRunner(IngestService service) {
        this.service = service;
    }

    @Override
    public void run(ApplicationArguments args) {
        IngestOptions options;
        try {
            options = IngestOptions.from(args);
        } catch (IllegalArgumentException e) {
            log.error("event=bad_arguments error=\"{}\" usage=\"--source=local|api [--year=2026] [--session=<key>] [--sessions=Race,Qualifying,...] [--dry-run]\"", e.getMessage());
            exitCode = 2;
            return;
        }
        try {
            exitCode = service.run(options).ok() ? 0 : 1;
        } catch (RuntimeException e) {
            log.error("event=run_aborted error=\"{}\"", e.toString(), e);
            exitCode = 1;
        }
    }

    @Override
    public int getExitCode() {
        return exitCode;
    }
}
