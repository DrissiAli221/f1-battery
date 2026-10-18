package dev.f1battery.replay;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.StringSerializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Re-emits a recorded session onto {@code telemetry.<session_key>}, one JSON record per sample,
 * keyed by driver number, at {@code speed} times real time.
 */
public final class ReplayProducer {

    private static final Logger log = LoggerFactory.getLogger(ReplayProducer.class);
    private static final Duration PROGRESS_EVERY = Duration.ofSeconds(60);

    private final ReplayConfig cfg;
    private final AtomicLong published = new AtomicLong();

    public ReplayProducer(ReplayConfig cfg) {
        this.cfg = cfg;
    }

    public long published() {
        return published.get();
    }

    public void run() throws Exception {
        Topics.ensureTelemetry(cfg.kafkaBootstrap(), cfg.sessionKey());
        String topic = Topics.telemetry(cfg.sessionKey());
        Pacer pacer = new Pacer(Pacer.Clock.SYSTEM, cfg.speed());
        Map<String, Object> props = Map.of(
                ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, cfg.kafkaBootstrap(),
                ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
                ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
                ProducerConfig.LINGER_MS_CONFIG, 5,
                ProducerConfig.ACKS_CONFIG, "1");
        log.info("replaying session {} to {} at {}x{}", cfg.sessionKey(), topic, cfg.speed(),
                cfg.drivers().isEmpty() ? "" : " for drivers " + cfg.drivers());
        try (KafkaProducer<String, String> producer = new KafkaProducer<>(props);
                SampleSource source = new SampleSource(cfg, 20_000)) {
            Instant firstTs = null;
            Instant nextReport = null;
            Sample s;
            while ((s = source.next()) != null) {
                if (firstTs == null) {
                    firstTs = s.ts();
                    nextReport = s.ts().plus(PROGRESS_EVERY);
                }
                pacer.awaitDue(s.ts());
                producer.send(new ProducerRecord<>(topic, Integer.toString(s.driverNumber()), Json.MAPPER.writeValueAsString(s)));
                published.incrementAndGet();
                if (!s.ts().isBefore(nextReport)) {
                    log.info("session time +{} s, {} records published", Duration.between(firstTs, s.ts()).toSeconds(), published.get());
                    nextReport = s.ts().plus(PROGRESS_EVERY);
                }
            }
            producer.flush();
        }
        log.info("done, {} records published", published.get());
    }
}
