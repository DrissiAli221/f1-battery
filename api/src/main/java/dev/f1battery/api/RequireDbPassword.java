package dev.f1battery.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Fails startup under the {@code prod} profile when {@code DB_PASSWORD} is not set, so a production
 * deployment can never fall back to the development password in application.yml.
 */
@Component
@Profile("prod")
public class RequireDbPassword {

    public RequireDbPassword(@Value("${DB_PASSWORD:}") String password) {
        if (password.isBlank()) {
            throw new IllegalStateException("DB_PASSWORD must be set when SPRING_PROFILES_ACTIVE=prod");
        }
    }
}
