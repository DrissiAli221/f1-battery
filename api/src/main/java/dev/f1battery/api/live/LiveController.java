package dev.f1battery.api.live;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.errors.WakeupException;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.filter.ShallowEtagHeaderFilter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * {@code GET /api/live/{session_key}}: server-sent events carrying the records of
 * {@code regime-state.<session_key>}. Present only when {@code api.replay.enabled=true}.
 *
 * <p>Each connection owns one Kafka consumer with a unique group id and no offset commits, so
 * browsers never share or steal each other's position. On connect the consumer reads the topic from
 * the start up to the end offsets seen at that moment, keeps the last record per key (the state
 * topic is compacted, but compaction is lazy, so the log can still hold history) and sends those
 * first; it then follows new records.
 */
@RestController
@ConditionalOnProperty(name = "api.replay.enabled", havingValue = "true")
public class LiveController {

    private static final Logger log = LoggerFactory.getLogger(LiveController.class);

    private final String bootstrap;
    private final ExecutorService pool = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "live-sse");
        t.setDaemon(true);
        return t;
    });

    public LiveController(@Value("${api.replay.kafka-bootstrap:localhost:9092}") String bootstrap) {
        this.bootstrap = bootstrap;
    }

    @GetMapping(value = "/api/live/{sessionKey}", produces = "text/event-stream")
    public SseEmitter stream(@PathVariable int sessionKey, HttpServletRequest request) {
        // The ETag filter buffers the whole body to hash it, which would hold back every event.
        ShallowEtagHeaderFilter.disableContentCaching(request);
        SseEmitter emitter = new SseEmitter(0L);
        AtomicBoolean open = new AtomicBoolean(true);
        KafkaConsumer<String, String>[] holder = newHolder();
        Runnable close = () -> {
            open.set(false);
            if (holder[0] != null) holder[0].wakeup();
        };
        emitter.onCompletion(close);
        emitter.onTimeout(close);
        emitter.onError(e -> close.run());
        pool.execute(() -> follow(sessionKey, emitter, open, holder));
        return emitter;
    }

    @SuppressWarnings("unchecked")
    private static KafkaConsumer<String, String>[] newHolder() {
        return new KafkaConsumer[1];
    }

    private void follow(int sessionKey, SseEmitter emitter, AtomicBoolean open, KafkaConsumer<String, String>[] holder) {
        String topic = "regime-state." + sessionKey;
        Properties p = new Properties();
        p.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap);
        p.put(ConsumerConfig.GROUP_ID_CONFIG, "api-live-" + UUID.randomUUID());
        p.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");
        p.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        p.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        p.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        p.put(ConsumerConfig.DEFAULT_API_TIMEOUT_MS_CONFIG, "10000");
        try (KafkaConsumer<String, String> c = new KafkaConsumer<>(p)) {
            holder[0] = c;
            var infos = c.partitionsFor(topic, Duration.ofSeconds(5));
            List<TopicPartition> parts = new ArrayList<>();
            if (infos != null) infos.forEach(i -> parts.add(new TopicPartition(topic, i.partition())));
            if (parts.isEmpty()) {
                // The topic does not exist yet (producer/consumer not started). Tell the view and finish.
                emitter.send(SseEmitter.event().name("status").data("{\"state\":\"no-topic\"}"));
                emitter.complete();
                return;
            }
            c.assign(parts);
            c.seekToBeginning(parts);
            Map<TopicPartition, Long> end = c.endOffsets(parts);

            Map<String, String> latest = new LinkedHashMap<>();
            Map<TopicPartition, Boolean> caughtUp = new HashMap<>();
            while (open.get() && caughtUp.size() < parts.size()) {
                for (ConsumerRecord<String, String> r : c.poll(Duration.ofMillis(200))) {
                    if (r.value() != null) latest.put(r.key(), r.value());
                }
                for (TopicPartition tp : parts) {
                    if (c.position(tp) >= end.get(tp)) caughtUp.put(tp, true);
                }
            }
            emitter.send(SseEmitter.event().name("status").data("{\"state\":\"connected\"}"));
            for (String v : latest.values()) emitter.send(SseEmitter.event().name("state").data(v));

            while (open.get()) {
                for (ConsumerRecord<String, String> r : c.poll(Duration.ofMillis(500))) {
                    if (r.value() != null) emitter.send(SseEmitter.event().name("state").data(r.value()));
                }
                // Keeps proxies from closing an idle stream and surfaces a closed client as an IOException.
                emitter.send(SseEmitter.event().comment("keepalive"));
            }
        } catch (WakeupException e) {
            // connection closed by the client
        } catch (IOException | IllegalStateException e) {
            log.debug("live stream for session {} ended: {}", sessionKey, e.toString());
        } catch (RuntimeException e) {
            log.warn("live stream for session {} failed", sessionKey, e);
            emitter.completeWithError(e);
        }
    }
}
