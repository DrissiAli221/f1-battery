package dev.f1battery.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "api.rate-per-min=2")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RateLimitIT {

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", TestDb.DB::getJdbcUrl);
        r.add("spring.datasource.username", TestDb.DB::getUsername);
        r.add("spring.datasource.password", TestDb.DB::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Test
    void thirdRequestInAMinuteIs429WithRetryAfterAndHealthIsExempt() throws Exception {
        mvc.perform(get("/api/sessions")).andExpect(status().isOk());
        mvc.perform(get("/api/sessions")).andExpect(status().isOk());
        mvc.perform(get("/api/sessions"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"));
        mvc.perform(get("/api/health")).andExpect(status().isOk());
    }
}
