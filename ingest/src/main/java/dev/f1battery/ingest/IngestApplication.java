package dev.f1battery.ingest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class IngestApplication implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(IngestApplication.class);

    public static void main(String[] args) {
        System.exit(SpringApplication.exit(SpringApplication.run(IngestApplication.class, args)));
    }

    @Override
    public void run(String... args) {
        log.info("ingest skeleton");
    }
}
