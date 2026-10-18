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
}
