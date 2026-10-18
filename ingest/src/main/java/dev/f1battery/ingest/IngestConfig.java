package dev.f1battery.ingest;

import dev.f1battery.ingest.ratelimit.RateLimiter;
import dev.f1battery.ingest.ratelimit.Sleeper;
import dev.f1battery.ingest.ratelimit.TokenBucketRateLimiter;
import dev.f1battery.ingest.source.ApiSource;
import dev.f1battery.ingest.source.LocalBackupSource;
import io.micrometer.core.instrument.MeterRegistry;
import java.nio.file.Path;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Wiring for both sources; the one used is chosen per run by {@code --source}. */
@Configuration
public class IngestConfig {

    @Bean
    LocalBackupSource localBackupSource(@Value("${ingest.local.root:data/raw/openf1}") String root) {
        return new LocalBackupSource(Path.of(root));
    }

    /**
     * Free-tier limits (AGENTS.md: at most 3 req/s and 30 req/min). The per-minute
     * burst defaults to 1, which spaces requests two seconds apart.
     */
    @Bean
    RateLimiter openF1RateLimiter(
            @Value("${ingest.api.per-second:3}") int perSecond,
            @Value("${ingest.api.per-minute:30}") int perMinute,
            @Value("${ingest.api.minute-burst:1}") int minuteBurst) {
        return TokenBucketRateLimiter.openF1(perSecond, perMinute, minuteBurst);
    }

    @Bean
    ApiSource apiSource(@Value("${ingest.api.base-url:https://api.openf1.org}") String baseUrl,
            RateLimiter limiter, MeterRegistry metrics) {
        return new ApiSource(ApiSource.Config.of(baseUrl), ApiSource.defaultHttpClient(), limiter,
                Sleeper.SYSTEM, () -> ThreadLocalRandom.current().nextDouble(), metrics);
    }

    @Bean
    TransactionTemplate transactionTemplate(PlatformTransactionManager tm) {
        return new TransactionTemplate(tm);
    }
}
