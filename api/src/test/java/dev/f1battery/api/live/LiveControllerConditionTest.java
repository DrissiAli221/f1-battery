package dev.f1battery.api.live;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** Unit-level checks of the property gate; no Kafka and no database needed. */
class LiveControllerConditionTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(LiveDisabledController.class, LiveController.class);

    @Test
    void disabledByDefault() {
        runner.run(ctx -> {
            assertEquals(1, ctx.getBeansOfType(LiveDisabledController.class).size());
            assertEquals(0, ctx.getBeansOfType(LiveController.class).size());
        });
    }

    @Test
    void enabledSwapsTheControllers() {
        runner.withPropertyValues("api.replay.enabled=true").run(ctx -> {
            assertEquals(0, ctx.getBeansOfType(LiveDisabledController.class).size());
            assertEquals(1, ctx.getBeansOfType(LiveController.class).size());
        });
    }

    @Test
    void disabledEndpointAnswers404WithJsonError() throws Exception {
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new LiveDisabledController()).build();
        mvc.perform(get("/api/live/11361"))
                .andExpect(status().isNotFound())
                .andExpect(content().json("{\"error\":\"replay disabled\"}"));
    }

    @Test
    void forwardedStateDropsRawFields() throws Exception {
        String out = LiveController.reduce("{\"session_key\":1,\"driver_number\":63,\"ts\":\"2026-01-01T00:00:00Z\","
                + "\"x\":10,\"y\":20,\"speed\":301.0,\"regime\":\"deploy\",\"lap_distance_est\":1234.5}");
        com.fasterxml.jackson.databind.JsonNode n = new com.fasterxml.jackson.databind.ObjectMapper().readTree(out);
        org.junit.jupiter.api.Assertions.assertEquals(4, n.size());
        org.junit.jupiter.api.Assertions.assertTrue(n.has("regime") && n.has("lap_distance_est")
                && n.has("driver_number") && n.has("ts"));
        org.junit.jupiter.api.Assertions.assertNull(LiveController.reduce("not json"));
    }

    @Test
    void streamBeyondTheLimitIsRefusedWith503() {
        LiveController c = new LiveController("localhost:1", 1);
        try {
            var req = new org.springframework.mock.web.MockHttpServletRequest();
            c.stream(1, req); // takes the only permit; the worker waits on the unreachable broker for seconds
            var ex = org.junit.jupiter.api.Assertions.assertThrows(
                    org.springframework.web.server.ResponseStatusException.class, () -> c.stream(2, req));
            assertEquals(503, ex.getStatusCode().value());
        } finally {
            c.shutdown();
        }
    }
}
