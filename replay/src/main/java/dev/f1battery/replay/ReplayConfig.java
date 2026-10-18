package dev.f1battery.replay;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Command-line and environment configuration shared by both modes. */
public record ReplayConfig(
        String mode,
        int sessionKey,
        double speed,
        List<Integer> drivers,
        String kafkaBootstrap,
        String dbUrl,
        String dbUser,
        String dbPassword) {

    public static ReplayConfig parse(String[] args, Map<String, String> env) {
        String mode = null;
        Integer session = null;
        double speed = 1.0;
        List<Integer> drivers = new ArrayList<>();
        for (String a : args) {
            if (!a.startsWith("--") || !a.contains("=")) throw new IllegalArgumentException("expected --name=value, got: " + a);
            String key = a.substring(2, a.indexOf('='));
            String val = a.substring(a.indexOf('=') + 1);
            switch (key) {
                case "mode" -> mode = val;
                case "session" -> session = Integer.parseInt(val);
                case "speed" -> speed = Double.parseDouble(val);
                case "drivers" -> {
                    for (String d : val.split(",")) if (!d.isBlank()) drivers.add(Integer.parseInt(d.trim()));
                }
                default -> throw new IllegalArgumentException("unknown option: --" + key);
            }
        }
        if (mode == null || !(mode.equals("producer") || mode.equals("consumer")))
            throw new IllegalArgumentException("--mode=producer|consumer is required");
        if (session == null) throw new IllegalArgumentException("--session=<session_key> is required");
        if (!(speed > 0)) throw new IllegalArgumentException("--speed must be positive");
        return new ReplayConfig(
                mode,
                session,
                speed,
                List.copyOf(drivers),
                env.getOrDefault("KAFKA_BOOTSTRAP", "localhost:9092"),
                env.getOrDefault("DB_URL", "jdbc:postgresql://localhost:55432/f1battery"),
                env.getOrDefault("DB_USER", "f1"),
                env.getOrDefault("DB_PASSWORD", "f1dev"));
    }
}
