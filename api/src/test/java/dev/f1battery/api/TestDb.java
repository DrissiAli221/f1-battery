package dev.f1battery.api;

import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** One TimescaleDB container shared by every integration test class in the JVM. */
final class TestDb {

    static final PostgreSQLContainer<?> DB = new PostgreSQLContainer<>(
            DockerImageName.parse("timescale/timescaledb:2.30.2-pg16").asCompatibleSubstituteFor("postgres"));

    static {
        DB.start();
    }

    private TestDb() {}
}
