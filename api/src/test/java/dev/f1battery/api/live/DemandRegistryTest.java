package dev.f1battery.api.live;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** Counting, refresh and expiry of the demand map, and the shape of GET /api/live/demand. */
class DemandRegistryTest {

    static final Instant T0 = Instant.parse("2026-10-27T12:00:00Z");

    static class MutableClock extends Clock {
        Instant now = T0;

        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    @Test
    void countsViewersPerSession() {
        MutableClock clock = new MutableClock();
        DemandRegistry d = new DemandRegistry(clock);
        d.open(1);
        d.open(1);
        d.open(2);
        assertEquals(2, d.wanted().size());
        assertEquals(2, d.wanted().stream().filter(w -> w.sessionKey() == 1).findFirst().orElseThrow().viewers());
        d.close(1);
        assertEquals(1, d.wanted().stream().filter(w -> w.sessionKey() == 1).findFirst().orElseThrow().viewers());
    }

    @Test
    void openStreamIsWantedForeverAndTouchRefreshesLastSeen() {
        MutableClock clock = new MutableClock();
        DemandRegistry d = new DemandRegistry(clock);
        d.open(1);
        clock.now = T0.plusSeconds(3600);
        assertEquals(1, d.wanted().size()); // still open: never expires
        d.touch(1);
        assertEquals(T0.plusSeconds(3600), d.wanted().get(0).lastSeen());
    }

    @Test
    void closedSessionLingersFiveMinutesThenDrops() {
        MutableClock clock = new MutableClock();
        DemandRegistry d = new DemandRegistry(clock);
        d.open(1);
        clock.now = T0.plusSeconds(60);
        d.close(1);
        clock.now = T0.plusSeconds(60 + 299);
        assertEquals(1, d.wanted().size());
        assertEquals(0, d.wanted().get(0).viewers());
        clock.now = T0.plusSeconds(60 + 300);
        assertTrue(d.wanted().isEmpty());
    }

    @Test
    void reopenWithinLingerKeepsTheOriginalSince() {
        MutableClock clock = new MutableClock();
        DemandRegistry d = new DemandRegistry(clock);
        d.open(1);
        d.close(1);
        clock.now = T0.plusSeconds(100);
        d.open(1);
        assertEquals(T0, d.wanted().get(0).since());
    }

    @Test
    void longestWantedComesFirst() {
        MutableClock clock = new MutableClock();
        DemandRegistry d = new DemandRegistry(clock);
        d.open(9);
        clock.now = T0.plusSeconds(5);
        d.open(3);
        assertEquals(9, d.wanted().get(0).sessionKey());
        assertEquals(3, d.wanted().get(1).sessionKey());
    }

    @Test
    void closeOfUnknownSessionIsHarmless() {
        DemandRegistry d = new DemandRegistry(new MutableClock());
        d.close(7);
        d.touch(7);
        assertTrue(d.wanted().isEmpty());
    }

    @Test
    void controllerShapesTheBody() throws Exception {
        MutableClock clock = new MutableClock();
        DemandRegistry d = new DemandRegistry(clock);
        d.open(11361);
        d.open(11361);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new DemandController(d)).build();
        mvc.perform(get("/api/live/demand"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.wanted[0].session_key").value(11361))
                .andExpect(jsonPath("$.wanted[0].viewers").value(2))
                .andExpect(jsonPath("$.wanted[0].last_seen").value("2026-10-27T12:00:00Z"));
    }
}
