FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY db/pom.xml db/pom.xml
COPY ingest/pom.xml ingest/pom.xml
COPY api/pom.xml api/pom.xml
COPY db/src db/src
COPY ingest/src ingest/src
RUN mvn -B -q -pl ingest -am -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/ingest/target/ingest-*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
