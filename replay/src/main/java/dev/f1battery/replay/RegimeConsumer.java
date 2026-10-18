package dev.f1battery.replay;

import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.errors.WakeupException;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Reads {@code telemetry.<session_key>}, keeps a {@link DriverWindow} per driver and publishes the
 * latest regime state per driver to the compacted topic {@code regime-state.<session_key>}, at
 * most once per {@code minIntervalMs} of wall time per driver.
 *
 * <p>The rate limit is on wall time, not session time: at replay speed 20 the browser should
 * still receive about four updates per second per car, not eighty.
 */
public final class RegimeConsumer {

    private static final Logger log = LoggerFactory.getLogger(RegimeConsumer.class);

    private final String bootstrap;
    private final int sessionKey;
    private final String groupId;
    private final long minIntervalMs;
    private final Pacer.Clock clock;
    private final AtomicBoolean stop = new AtomicBoolean();
    private final AtomicLong consumed = new AtomicLong();
    private final AtomicLong produced = new AtomicLong();
    private volatile KafkaConsumer<String, String> consumer;

    public RegimeConsumer(String bootstrap, int sessionKey, String groupId, long minIntervalMs, Pacer.Clock clock) {
        this.bootstrap = bootstrap;
        this.sessionKey = sessionKey;
        this.groupId = groupId;
        this.minIntervalMs = minIntervalMs;
        this.clock = clock;
    }

    public long consumed() {
        return consumed.get();
    }

    public long produced() {
        return produced.get();
    }

    /** Asks {@link #run()} to return; safe from any thread. */
    public void stop() {
        stop.set(true);
        KafkaConsumer<String, String> c = consumer;
        if (c != null) c.wakeup();
    }

    public void run() throws Exception {
        Topics.ensureTelemetry(bootstrap, sessionKey);
        Topics.ensureState(bootstrap, sessionKey);
        String in = Topics.telemetry(sessionKey);
        String out = Topics.state(sessionKey);
        Map<Integer, DriverWindow> windows = new HashMap<>();
        Map<Integer, Long> lastEmitNanos = new HashMap<>();
        long lastLog = clock.nanoTime();

        Map<String, Object> cprops = Map.of(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap,
                ConsumerConfig.GROUP_ID_CONFIG, groupId,
                ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest",
                ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        Map<String, Object> pprops = Map.of(
                ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap,
                ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
                ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
                ProducerConfig.LINGER_MS_CONFIG, 20);
        try (KafkaConsumer<String, String> c = new KafkaConsumer<>(cprops);
                KafkaProducer<String, String> p = new KafkaProducer<>(pprops)) {
            consumer = c;
            c.subscribe(List.of(in));
            try {
                while (!stop.get()) {
                    for (ConsumerRecord<String, String> rec : c.poll(Duration.ofMillis(250))) {
                        consumed.incrementAndGet();
                        Sample s = Json.MAPPER.readValue(rec.value(), Sample.class);
                        DriverWindow w = windows.computeIfAbsent(s.driverNumber(), k -> new DriverWindow());
                        var labelled = w.add(s);
                        if (labelled.isEmpty()) continue;
                        long now = clock.nanoTime();
                        Long last = lastEmitNanos.get(s.driverNumber());
                        if (last != null && (now - last) / 1_000_000 < minIntervalMs) continue;
                        lastEmitNanos.put(s.driverNumber(), now);
                        Sample m = labelled.get().sample();
                        RegimeState st = new RegimeState(sessionKey, m.driverNumber(), m.ts(), m.x(), m.y(),
                                m.speed(), labelled.get().regime(), labelled.get().distanceM());
                        p.send(new ProducerRecord<>(out, Integer.toString(m.driverNumber()), Json.MAPPER.writeValueAsString(st)));
                        produced.incrementAndGet();
                    }
                    if (clock.nanoTime() - lastLog > 10_000_000_000L) {
                        lastLog = clock.nanoTime();
                        log.info("metrics: consumed={} produced={}", consumed.get(), produced.get());
                    }
                }
            } catch (WakeupException e) {
                if (!stop.get()) throw e;
            }
            p.flush();
        }
        log.info("stopped: consumed={} produced={}", consumed.get(), produced.get());
    }
}
