# syntax=docker/dockerfile:1
FROM maven:3.9-21-slim AS builder
WORKDIR /app

# Download dependencies first (caching)
COPY pom.xml ./
RUN mvn dependency:go-offline -B

COPY src ./src
RUN mvn package -DskipTests

FROM eclipse-temurin:21-slim AS runtime
WORKDIR /app

# Create non-root user
RUN groupadd -g 1000 -S appgroup && \
    adduser -u 1000 -S appuser -G appgroup

# Copy jar from builder
COPY --from=builder /app/target/*.jar /app/app.jar


EXPOSE 

USER appuser
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
