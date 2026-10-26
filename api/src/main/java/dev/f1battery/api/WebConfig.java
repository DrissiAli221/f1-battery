package dev.f1battery.api;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.filter.ShallowEtagHeaderFilter;

/**
 * Filter chain, outermost first: CORS (so 429 responses still carry CORS headers and the
 * browser can read them), rate limit, then ETag. The API is read-only, so only GET and
 * preflight are allowed.
 */
@Configuration
public class WebConfig {

    @Bean
    FilterRegistrationBean<CorsFilter> corsFilter(@Value("${api.cors-origin:http://localhost:5173}") String origin) {
        CorsConfiguration cfg = new CorsConfiguration();
        cfg.setAllowedOrigins(List.of(origin.split("\\s*,\\s*")));
        cfg.setAllowedMethods(List.of("GET", "HEAD", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("*"));
        cfg.setExposedHeaders(List.of("ETag", "Retry-After"));
        cfg.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/api/**", cfg);
        FilterRegistrationBean<CorsFilter> reg = new FilterRegistrationBean<>(new CorsFilter(src));
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return reg;
    }

    @Bean
    FilterRegistrationBean<RateLimitFilter> rateLimitFilter(@Value("${api.rate-per-min:60}") int perMinute,
            @Value("${api.trusted-proxies:}") String trustedProxies) {
        FilterRegistrationBean<RateLimitFilter> reg =
                new FilterRegistrationBean<>(new RateLimitFilter(perMinute, trustedProxies));
        reg.addUrlPatterns("/api/*");
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE + 1);
        return reg;
    }

    /** Results are immutable per model run, so a body hash is a sound validator. */
    @Bean
    FilterRegistrationBean<ShallowEtagHeaderFilter> etagFilter() {
        FilterRegistrationBean<ShallowEtagHeaderFilter> reg = new FilterRegistrationBean<>(new ShallowEtagHeaderFilter());
        reg.addUrlPatterns("/api/*");
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE + 2);
        return reg;
    }
}
