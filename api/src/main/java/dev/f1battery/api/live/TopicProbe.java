package dev.f1battery.api.live;

import java.util.List;
import java.util.OptionalLong;

/** What the now-playing lookup needs from Kafka; a seam so the age/filter logic is testable without a broker. */
public interface TopicProbe {

    /** Names of the topics that match {@code regime-state.*}. */
    List<String> regimeStateTopics() throws Exception;

    /** Wall-clock time (epoch ms) of the newest record of the topic, or empty if it holds none. */
    OptionalLong lastRecordMillis(String topic) throws Exception;
}
