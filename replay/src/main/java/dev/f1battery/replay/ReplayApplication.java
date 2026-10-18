package dev.f1battery.replay;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Entry point of the replay jar: {@code --mode=producer} or {@code --mode=consumer}. No Spring
 * context is started; Spring Boot is used for dependency management, logging and packaging only,
 * since neither mode needs a container.
 */
public final class ReplayApplication {

    private static final Logger log = LoggerFactory.getLogger(ReplayApplication.class);

    private ReplayApplication() {}

    public static void main(String[] args) throws Exception {
        ReplayConfig cfg;
        try {
            cfg = ReplayConfig.parse(args, System.getenv());
        } catch (IllegalArgumentException e) {
            System.err.println(e.getMessage());
            System.err.println("usage: java -jar replay.jar --mode=producer|consumer --session=<key> [--speed=1.0] [--drivers=1,63]");
            System.exit(2);
            return;
        }
        if (cfg.mode().equals("producer")) {
            new ReplayProducer(cfg).run();
        } else {
            RegimeConsumer consumer = new RegimeConsumer(cfg.kafkaBootstrap(), cfg.sessionKey(),
                    "regime-consumer-" + cfg.sessionKey(), 250, Pacer.Clock.SYSTEM);
            Runtime.getRuntime().addShutdownHook(new Thread(consumer::stop));
            log.info("consuming {} -> {}", Topics.telemetry(cfg.sessionKey()), Topics.state(cfg.sessionKey()));
            consumer.run();
        }
    }
}
