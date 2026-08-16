# syntax=docker/dockerfile:1
FROM golang:1.22-alpine AS builder
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git make

# Download dependencies first (caching)
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/bin/server ./cmd/server

FROM alpine:3.20 AS runtime
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache ca-certificates curl tzdata     && update-ca-certificates

# Create non-root user
RUN addgroup -g 1000 -S appgroup &&     adduser -u 1000 -S appuser -G appgroup

# Copy binary from builder
COPY --from=builder /app/bin/server /app/bin/server

# Copy config files if any
COPY --from=builder /app/config ./config


EXPOSE 

USER appuser
CMD ["/app/bin/server"]
