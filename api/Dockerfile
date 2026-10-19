# Multi-stage build of the api module. Every module pom is copied so the reactor resolves
# (the root pom lists db, ingest, api and replay); only api and the modules it needs are built.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY db/pom.xml db/pom.xml
COPY ingest/pom.xml ingest/pom.xml
COPY api/pom.xml api/pom.xml
COPY replay/pom.xml replay/pom.xml
COPY db/src db/src
COPY api/src api/src
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -q -pl api -am -DskipTests package \
 && cp api/target/api-*-SNAPSHOT.jar /app.jar

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --no-create-home --shell /usr/sbin/nologin app
COPY --from=build --chown=app:app /app.jar app.jar
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
