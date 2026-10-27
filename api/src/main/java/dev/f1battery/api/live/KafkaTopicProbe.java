package dev.f1battery.api.live;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Reads topic names with an {@link Admin} client and the newest record time of a topic with a
 * short-lived consumer that is assigned (no group, no commits) and seeks to the last offset of each
 * partition. Every call is bounded to a few seconds so a dead broker cannot hang a request.
 */
@Component
@ConditionalOnProperty(name = "api.replay.enabled", havingValue = "true")
public class KafkaTopicProbe implements TopicProbe {

    private static final String PREFIX = "regime-state.";
    private static final int TIMEOUT_MS = 5000;

    private final String bootstrap;

    public KafkaTopicProbe(@Value("${api.replay.kafka-bootstrap:localhost:9092}") String bootstrap) {
        this.bootstrap = bootstrap;
    }

    @Override
    public List<String> regimeStateTopics() throws Exception {
        try (Admin admin = Admin.create(Map.of(
                "bootstrap.servers", bootstrap,
                "request.timeout.ms", TIMEOUT_MS,
                "default.api.timeout.ms", TIMEOUT_MS))) {
            return admin.listTopics().names().get(TIMEOUT_MS, TimeUnit.MILLISECONDS).stream()
                    .filter(n -> n.startsWith(PREFIX))
                    .toList();
        }
    }

    @Override
    public OptionalLong lastRecordMillis(String topic) {
        Map<String, Object> p = Map.of(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap,
                ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false",
                ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName(),
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName(),
                ConsumerConfig.DEFAULT_API_TIMEOUT_MS_CONFIG, String.valueOf(TIMEOUT_MS),
                ConsumerConfig.REQUEST_TIMEOUT_MS_CONFIG, String.valueOf(TIMEOUT_MS));
        try (KafkaConsumer<String, String> c = new KafkaConsumer<>(p)) {
            var infos = c.partitionsFor(topic, Duration.ofMillis(TIMEOUT_MS));
            List<TopicPartition> parts = new ArrayList<>();
            if (infos != null) infos.forEach(i -> parts.add(new TopicPartition(topic, i.partition())));
            if (parts.isEmpty()) return OptionalLong.empty();
            c.assign(parts);
            Map<TopicPartition, Long> begin = c.beginningOffsets(parts);
            Map<TopicPartition, Long> end = c.endOffsets(parts);
            List<TopicPartition> nonEmpty = parts.stream().filter(tp -> end.get(tp) > begin.get(tp)).toList();
            if (nonEmpty.isEmpty()) return OptionalLong.empty();
            // The newest record of a partition is the one before its end offset. The state topic is
            // compacted, but the head of the log is never compacted away.
            for (TopicPartition tp : nonEmpty) c.seek(tp, end.get(tp) - 1);
            long newest = -1;
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
            List<TopicPartition> waiting = new ArrayList<>(nonEmpty);
            while (!waiting.isEmpty() && System.nanoTime() < deadline) {
                for (ConsumerRecord<String, String> r : c.poll(Duration.ofMillis(300))) {
                    newest = Math.max(newest, r.timestamp());
                    waiting.remove(new TopicPartition(r.topic(), r.partition()));
                }
            }
            return newest < 0 ? OptionalLong.empty() : OptionalLong.of(newest);
        }
    }
}
