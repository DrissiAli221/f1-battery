package dev.f1battery.replay;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

/** Produces 20 synthetic samples through a real broker and checks the regimes the consumer publishes. */
@Testcontainers
class RegimeReplayIT {

    @Container
    static final KafkaContainer KAFKA = new KafkaContainer("apache/kafka:3.8.0");

    static final int SESSION = 4242;

    /**
     * 20 samples, 250 ms apart, one driver:
     * 0-7 accelerating at full throttle, 8-13 constant speed at full throttle,
     * 14-16 throttle released, 17-19 braking.
     */
    static List<Sample> synthetic() {
        Instant t0 = Instant.parse("2026-09-06T13:00:00Z");
        List<Sample> out = new ArrayList<>();
        int[] speed = new int[20];
        for (int i = 0; i < 20; i++) {
            speed[i] = i < 8 ? 200 + 6 * i : i < 14 ? 242 : i < 17 ? 242 - 4 * (i - 13) : 230 - 15 * (i - 16);
            int thr = i < 14 ? 100 : i < 17 ? 0 : 0;
            int brk = i >= 17 ? 100 : 0;
            out.add(new Sample(SESSION, 1, t0.plusMillis(250L * i), speed[i], thr, brk, 1000 + 10 * i, 2000));
        }
        return out;
    }

    @Test
    void consumerPublishesExpectedRegimes() throws Exception {
        String bootstrap = KAFKA.getBootstrapServers();
        Topics.ensureTelemetry(bootstrap, SESSION);
        try (KafkaProducer<String, String> p = new KafkaProducer<>(Map.of(
                ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap,
                ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
                ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class))) {
            for (Sample s : synthetic())
                p.send(new ProducerRecord<>(Topics.telemetry(SESSION), "1", Json.MAPPER.writeValueAsString(s)));
            p.flush();
        }

        RegimeConsumer consumer = new RegimeConsumer(bootstrap, SESSION, "it-group", 0, Pacer.Clock.SYSTEM);
        Thread t = new Thread(() -> {
            try {
                consumer.run();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
        t.start();

        Map<Integer, String> byIndex = new HashMap<>(); // sample index (from x) -> regime
        Map<String, Object> cprops = Map.of(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap,
                ConsumerConfig.GROUP_ID_CONFIG, "it-reader",
                ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest",
                ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        try (KafkaConsumer<String, String> reader = new KafkaConsumer<>(cprops)) {
            reader.subscribe(List.of(Topics.state(SESSION)));
            long deadline = System.currentTimeMillis() + 60_000;
            while (byIndex.size() < 16 && System.currentTimeMillis() < deadline) {
                reader.poll(Duration.ofMillis(500)).forEach(r -> {
                    try {
                        RegimeState st = Json.MAPPER.readValue(r.value(), RegimeState.class);
                        assertEquals("1", r.key());
                        byIndex.put((st.x() - 1000) / 10, st.regime());
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                });
            }
        } finally {
            consumer.stop();
            t.join(10_000);
        }

        // 20 samples give 16 labelled centres (indices 2..17).
        assertEquals(16, byIndex.size(), byIndex::toString);
        assertEquals("deploy", byIndex.get(4));
        assertEquals("plateau", byIndex.get(11));
        assertEquals("lift", byIndex.get(15));
        assertEquals("brake", byIndex.get(17));
        assertTrue(consumer.consumed() >= 20);
        assertEquals(16, consumer.produced());
    }
}
