package dev.f1battery.api.live;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

/** Age filter, ordering, cap and cache of the now-playing lookup, and the controller bodies; no broker needed. */
class NowPlayingTest {

    static final Instant NOW = Instant.parse("2026-10-27T12:00:00Z");

    static class FakeProbe implements TopicProbe {
        final List<String> topics = new ArrayList<>();
        final Map<String, Long> last = new HashMap<>();
        final AtomicInteger calls = new AtomicInteger();
        boolean fail;

        @Override
        public List<String> regimeStateTopics() throws Exception {
            calls.incrementAndGet();
            if (fail) throw new java.io.IOException("broker down");
            return topics;
        }

        @Override
        public OptionalLong lastRecordMillis(String topic) {
            Long v = last.get(topic);
            return v == null ? OptionalLong.empty() : OptionalLong.of(v);
        }
    }

    static Clock at(Instant t) {
        return Clock.fixed(t, ZoneOffset.UTC);
    }

    @Test
    void ageUnderTwoMinutesIsActive() {
        assertEquals(12, NowPlaying.classify(1, NOW.minusSeconds(12).toEpochMilli(), NOW).ageSeconds());
        assertEquals(119, NowPlaying.classify(1, NOW.minusSeconds(119).toEpochMilli(), NOW).ageSeconds());
        assertNull(NowPlaying.classify(1, NOW.minusSeconds(120).toEpochMilli(), NOW));
        assertEquals(0, NowPlaying.classify(1, NOW.plusSeconds(3).toEpochMilli(), NOW).ageSeconds());
    }

    @Test
    void onlyRecentTopicsAreListedNewestFirst() throws Exception {
        FakeProbe p = new FakeProbe();
        p.topics.addAll(List.of("regime-state.11361", "regime-state.9999", "regime-state.abc", "regime-state.7777"));
        p.last.put("regime-state.11361", NOW.minusSeconds(30).toEpochMilli());
        p.last.put("regime-state.9999", NOW.minusSeconds(3600).toEpochMilli());
        // 7777 has no records at all
        var active = new NowPlaying(p, at(NOW)).active();
        assertEquals(1, active.size());
        assertEquals(11361, active.get(0).sessionKey());
        assertEquals(30, active.get(0).ageSeconds());
    }

    @Test
    void sessionKeysAreCappedToTheNewestFifty() {
        List<String> topics = new ArrayList<>();
        for (int i = 1; i <= 80; i++) topics.add("regime-state." + i);
        List<Integer> keys = NowPlaying.sessionKeys(topics);
        assertEquals(NowPlaying.MAX_TOPICS, keys.size());
        assertEquals(80, keys.get(0));
        assertEquals(31, keys.get(keys.size() - 1));
    }

    @Test
    void theAnswerIsCachedForTenSeconds() throws Exception {
        FakeProbe p = new FakeProbe();
        p.topics.add("regime-state.5");
        p.last.put("regime-state.5", NOW.toEpochMilli());
        var clock = new Clock() {
            Instant t = NOW;
            public ZoneOffset getZone() { return ZoneOffset.UTC; }
            public Clock withZone(java.time.ZoneId z) { return this; }
            public Instant instant() { return t; }
        };
        NowPlaying n = new NowPlaying(p, clock);
        n.active();
        clock.t = NOW.plusSeconds(9);
        n.active();
        assertEquals(1, p.calls.get());
        clock.t = NOW.plusSeconds(10);
        n.active();
        assertEquals(2, p.calls.get());
    }

    @Test
    void controllerShapesTheBodyAndMapsBrokerFailureTo503() throws Exception {
        FakeProbe p = new FakeProbe();
        p.topics.add("regime-state.11361");
        p.last.put("regime-state.11361", NOW.minusSeconds(12).toEpochMilli());
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new LiveIndexController(new NowPlaying(p, at(NOW)), 3)).build();
        mvc.perform(get("/api/live"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.active[0].session_key").value(11361))
                .andExpect(jsonPath("$.active[0].last_ts").value("2026-10-27T11:59:48Z"))
                .andExpect(jsonPath("$.active[0].age_s").value(12))
                .andExpect(jsonPath("$.capacity.max").value(3))
                .andExpect(jsonPath("$.capacity.used").value(1));

        FakeProbe down = new FakeProbe();
        down.fail = true;
        var c = new LiveIndexController(new NowPlaying(down, at(NOW)), 3);
        assertEquals(503, assertThrows(ResponseStatusException.class, c::index).getStatusCode().value());
    }

    @Test
    void disabledIndexIs200WithNothingPlaying() throws Exception {
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new LiveDisabledController()).build();
        mvc.perform(get("/api/live"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.active").isEmpty())
                .andExpect(jsonPath("$.capacity.max").value(0));
    }
}
