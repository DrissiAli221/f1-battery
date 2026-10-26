# Multi-stage build of the replay module. Every module pom is copied so the reactor resolves
# (the root pom lists db, ingest, api and replay); only replay and the modules it needs are built.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY db/pom.xml db/pom.xml
COPY ingest/pom.xml ingest/pom.xml
COPY api/pom.xml api/pom.xml
COPY replay/pom.xml replay/pom.xml
COPY db/src db/src
COPY replay/src replay/src
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -q -pl replay -am -DskipTests package \
 && cp replay/target/replay-*-SNAPSHOT.jar /app.jar

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --no-create-home --shell /usr/sbin/nologin app
COPY --from=build --chown=app:app /app.jar app.jar
USER app
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD java -version >/dev/null 2>&1 || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
