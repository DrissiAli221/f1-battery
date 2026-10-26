package dev.f1battery.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class RequireDbPasswordTest {

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(RequireDbPassword.class);

    @Test
    void prodWithoutPasswordFailsToStart() {
        runner.withPropertyValues("spring.profiles.active=prod").run(ctx -> {
            assertThat(ctx).hasFailed();
            assertThat(ctx.getStartupFailure()).hasRootCauseMessage(
                    "DB_PASSWORD must be set when SPRING_PROFILES_ACTIVE=prod");
        });
    }

    @Test
    void prodWithPasswordAndNonProdWithoutBothStart() {
        runner.withPropertyValues("spring.profiles.active=prod", "DB_PASSWORD=secret")
                .run(ctx -> assertThat(ctx).hasNotFailed());
        runner.run(ctx -> assertThat(ctx).hasNotFailed());
    }
}
