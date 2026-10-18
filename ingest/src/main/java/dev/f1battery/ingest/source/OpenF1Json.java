package dev.f1battery.ingest.source;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;

/** The one ObjectMapper configuration shared by both sources. */
public final class OpenF1Json {

    private static final ObjectMapper MAPPER = JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();

    private OpenF1Json() {}

    public static ObjectMapper mapper() {
        return MAPPER;
    }

    public static <T> List<T> parseList(InputStream in, Class<T> type) throws IOException {
        return MAPPER.readValue(in, MAPPER.getTypeFactory().constructCollectionType(List.class, type));
    }
}
