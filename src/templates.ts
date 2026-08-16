// Mustache 4.x ships mustache.mjs as ESM with a *default* export, but the
// official @types/mustache typings declare a namespace of named exports. Three
// failure modes are guarded here:
//   1. `import * as M from 'mustache'` — runtime returns `{ default: { render } }`,
//      so `M.render` is undefined and the cast hides the crash until first call.
//   2. `import M from 'mustache'` — TS rejects this with TS1192 because
//      @types/mustache has no default export, even with esModuleInterop.
//   3. Synchronous `createRequire` import — works on both shapes.
// We use shape (3) so the runtime is correct AND the types resolve cleanly.
import { createRequire } from 'module';
import type { TemplateContext } from './types.js';

const nodeRequire = createRequire(import.meta.url);
const Mustache = nodeRequire('mustache') as {
  render: (template: string, view: unknown, partials?: unknown, config?: unknown) => string;
  escape: (text: string) => string;
  parse: (template: string, tags?: [string, string]) => unknown;
  Writer: unknown;
  Context: unknown;
  Scanner: unknown;
};

const dockerfileNode = `# syntax=docker/dockerfile:1
FROM node:<%{nodeVersion}%> AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src
RUN npm run build || true

FROM node:<%{nodeVersion}%>-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# OpenTelemetry auto-instrumentation
RUN npm install --omit=dev @opentelemetry/api @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-prometheus @opentelemetry/sdk-node @opentelemetry/resources @opentelemetry/semantic-conventions

<%#env%>
<%#.%>
ENV <%{key}%>=<%{value}%>
<%/.%>
<%/env%>

ENV OTEL_NODE_ENABLED=true
ENV OTEL_SERVICE_NAME=<%service.name%>
ENV OTEL_TRACES_EXPORTER=prometheus
ENV OTEL_METRICS_EXPORTER=prometheus
ENV OTEL_EXPORTER_PROMETHEUS_PORT=9464
ENV OTEL_RESOURCE_ATTRIBUTES=service.name=<%service.name%>,service.namespace=<%project.namespace%>

EXPOSE <%{port}%>
EXPOSE 9464
<%#healthCheck%>
<%#path%>
HEALTHCHECK --interval=<%{interval}%> --timeout=<%{timeout}%> --retries=<%{retries}%> \\
  CMD curl -f http://localhost:<%{port}%><%{path}%> || exit 1
<%/path%>
<%/healthCheck%>

<%#command%>
CMD [<%#.%><%{this}%>, <%/.%>]
<%/command%>
<%^command%>
CMD ["node", "--require", "@opentelemetry/auto-instrumentations-node/register", "dist/index.js"]
<%/command%>
`;

const dockerfilePython = `# syntax=docker/dockerfile:1
FROM python:<%{pythonVersion}%> AS builder
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

FROM python:<%{pythonVersion}%>-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /root/.cache/pip /root/.cache/pip
COPY --from=builder /usr/local/lib/python<%#pythonMajor%>}^<%{.}%><%/pythonMajor%> /usr/local/lib/python<%#pythonMajor%>}^<%{.}%><%/pythonMajor%>
COPY --from=builder /usr/local/bin /usr/local/bin

<%#env%>
<%#.%>
ENV <%{key}%>=<%{value}%>
<%/.%>
<%/env%>

EXPOSE <%{port}%>
<%#healthCheck%>
<%#path%>
HEALTHCHECK --interval=<%{interval}%> --timeout=<%{timeout}%> --retries=<%{retries}%> \
  CMD curl -f http://localhost:<%{port}%><%{path}%> || exit 1
<%/path%>
<%/healthCheck%>

<%#command%>
CMD [<%#.%><%{this}%>, <%/.%>]
<%/command%>
<%^command%>
CMD ["python", "-m", "src"]
<%/command%>
`;

const dockerfileGo = `# syntax=docker/dockerfile:1
FROM golang:<%{goVersion}%>-alpine AS builder
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git make

# Download dependencies first (caching)
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/bin/server ./cmd/server

FROM alpine:<%{alpineVersion}%> AS runtime
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache ca-certificates curl tzdata \
    && update-ca-certificates

# Create non-root user
RUN addgroup -g 1000 -S appgroup && \
    adduser -u 1000 -S appuser -G appgroup

# Copy binary from builder
COPY --from=builder /app/bin/server /app/bin/server

# Copy config files if any
COPY --from=builder /app/config ./config

<%#env%>
<%#.%>
ENV <%{key}%>=<%{value}%>
<%/.%>
<%/env%>

EXPOSE <%{port}%>
<%#healthCheck%>
<%#path%>
HEALTHCHECK --interval=<%{interval}%> --timeout=<%{timeout}%> --retries=<%{retries}%> \
  CMD curl -f http://localhost:<%{port}%><%{path}%> || exit 1
<%/path%>
<%/healthCheck%>

USER appuser
CMD ["/app/bin/server"]
`;

const dockerfileRust = `# syntax=docker/dockerfile:1
FROM rust:<%{rustVersion}%>-slim AS planner
WORKDIR /app
RUN cargo install cargo-chef --locked
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo chef prepare --recipe-path recipe.json

FROM rust:<%{rustVersion}%>-slim AS builder
WORKDIR /app
RUN cargo install cargo-chef --locked
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

COPY . .
RUN cargo build --release

FROM debian:<%{debianVersion}%>-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \\
    ca-certificates curl \\
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r appgroup && useradd -r -g appgroup appuser

COPY --from=builder /app/target/release/<%service.name%> /app/bin/server

<%#env%>
<%#.%>
ENV <%{key}%>=<%{value}%>
<%/.%>
<%/env%>

EXPOSE <%{port}%>
<%#healthCheck%>
<%#path%>
HEALTHCHECK --interval=<%{interval}%> --timeout=<%{timeout}%> --retries=<%{retries}%> \\\\
  CMD curl -f http://localhost:<%{port}%><%{path}%> || exit 1
<%/path%>
<%/healthCheck%>

USER appuser
CMD ["/app/bin/server"]
`;

const dockerfileJava = `# syntax=docker/dockerfile:1
FROM maven:3.9-<%{javaVersion}%> AS builder
WORKDIR /app

# Download dependencies first (caching)
COPY pom.xml ./
RUN mvn dependency:go-offline -B

COPY src ./src
RUN mvn package -DskipTests

FROM eclipse-temurin:<%{javaVersion}%> AS runtime
WORKDIR /app

# Create non-root user
RUN groupadd -g 1000 -S appgroup && \\
    adduser -u 1000 -S appuser -G appgroup

# Copy jar from builder
COPY --from=builder /app/target/*.jar /app/app.jar

<%#env%>
<%#.%>
ENV <%{key}%>=<%{value}%>
<%/.%>
<%/env%>

EXPOSE <%{port}%>
<%#healthCheck%>
<%#path%>
HEALTHCHECK --interval=<%{interval}%> --timeout=<%{timeout}%> --retries=<%{retries}%> \\\\
  CMD curl -f http://localhost:<%{port}%><%{path}%> || exit 1
<%/path%>
<%/healthCheck%>

USER appuser
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
`;

const dockerComposeTemplate = `version: '3.9'

services:
<%#services%>
  <%name%>:
    build:
      context: ./services/<%name%>
      dockerfile: Dockerfile
    container_name: <%name%>
    ports:
      - "<%port%>:<%port%>"
    environment:
      - NODE_ENV=development
      - PORT=<%port%>
<%#dependencies%>
      - SERVICE_DEPENDENCIES=<%#.%>
<%{this}%>
<%/.%>
<%/dependencies%>
<%#env%>
<%#.%>
      - <%{key}%>=<%{value}%>
<%/.%>
<%/env%>
<%#healthCheck%>
<%#healthCheck.path%>
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:<%port%><%{healthCheck.path}%>"]
      interval: "<%healthCheck.interval%>"
      timeout: "<%healthCheck.timeout%>"
      retries: <%healthCheck.retries%>
<%/healthCheck.path%>
<%/healthCheck%>
    depends_on:
<%#dependencies%>
      - <%{this}%>
<%/dependencies%>
    networks:
      - devforge-network
    restart: unless-stopped

<%/services%>
<%#databases%>
  <%name%>:
    image: <%{type}%>:<%{version}%>
    container_name: <%name%>
    environment:
<%#.%>
    <%/.%>
<%#size%>
      - POSTGRES_SIZE=<%size%>
<%/size%>
    ports:
      - "<%port%>:<%port%>"
    volumes:
      - <%name%>-data:/var/lib/<%type%>
    networks:
      - devforge-network
    restart: unless-stopped

<%/databases%>
volumes:
<%#databases%>
  <%name%>-data:
<%/databases%>

networks:
  devforge-network:
    driver: bridge
`;

const k8sDeploymentTemplate = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: <%service.name%>
  namespace: <%project.namespace%>
  labels:
    app: <%service.name%>
    app.kubernetes.io/name: <%service.name%>
    app.kubernetes.io/managed-by: devforge
spec:
  replicas: <%service.scaling.minReplicas%><%^service.scaling%>1<%/service.scaling%>
  selector:
    matchLabels:
      app: <%service.name%>
  template:
    metadata:
      labels:
        app: <%service.name%>
        app.kubernetes.io/name: <%service.name%>
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
        - name: <%service.name%>
          image: <%service.image%><%^service.image%>docker.io/<%project.github.owner%>/<%project.name%>-<%service.name%>:latest<%/service.image%>
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: <%service.port%>
              protocol: TCP
            - name: metrics
              containerPort: 9464
              protocol: TCP
          env:
<%#service.env%>
<%#.%>
            - name: <%{key}%>
              value: "<%value%>"
<%/.%>
<%/service.env%>
<%#service.dependencies%>
            - name: SERVICE_DEPENDENCIES
              value: "<%#.%>
<%{this}%>
<%/.%>
<%/service.dependencies%>
          livenessProbe:
<%#service.healthCheck%>
<%#path%>
            httpGet:
              path: <%{path}%>
              port: http
<%/path%>
<%^path%>
            tcpSocket:
              port: http
<%/path%>
            initialDelaySeconds: 30
            periodSeconds: 10
<%/service.healthCheck%>
<%^service.healthCheck%>
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
<%/service.healthCheck%>
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
`;

const k8sServiceTemplate = `apiVersion: v1
kind: Service
metadata:
  name: <%service.name%>
  namespace: <%project.namespace%>
  labels:
    app: <%service.name%>
spec:
  type: ClusterIP
  ports:
    - port: <%service.port%>
      targetPort: http
      protocol: TCP
      name: http
  selector:
    app: <%service.name%>
`;

const k8sHPATemplate = `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: <%service.name%>
  namespace: <%project.namespace%>
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: <%service.name%>
<%#service.scaling%>
  minReplicas: <%minReplicas%>
  maxReplicas: <%maxReplicas%>
<%/service.scaling%>
<%^service.scaling%>
  minReplicas: 1
  maxReplicas: 5
<%/service.scaling%>
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
<%#service.scaling%>
          averageUtilization: <%targetCPUUtilization%><%^targetCPUUtilization%>70<%/targetCPUUtilization%>
<%/service.scaling%>
<%^service.scaling%>
          averageUtilization: 70
<%/service.scaling%>
<%#service.scaling%>
<%#targetMemoryUtilization%>
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: <%targetMemoryUtilization%>
<%/targetMemoryUtilization%>
<%/service.scaling%>
`;

const k8sIngressTemplate = `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: <%project.name%>
  namespace: <%project.namespace%>
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
spec:
  tls:
<%#ingress.tls%>
    - hosts:
<%#hosts%>
        - <%{this}%>
<%/hosts%>
      secretName: <%secretName%>
<%/ingress.tls%>
<%^ingress.tls%>
    - hosts:
        - "*.<%project.namespace%>.svc.cluster.local"
      secretName: <%project.name%>-tls
<%/ingress.tls%>
  rules:
<%#ingress.rules%>
    - host: <%{host}%>
      http:
        paths:
          - path: <%{path}%>
            pathType: Prefix
            backend:
              service:
                name: <%service%>
                port:
                  number: <%servicePort%>
<%/ingress.rules%>
<%^ingress.rules%>
    - host: api.<%project.namespace%>.example.com
      http:
        paths:
<%#services%>
          - path: /<%name%>
            pathType: Prefix
            backend:
              service:
                name: <%name%>
                port:
                  number: <%port%>
<%/services%>
<%/ingress.rules%>
`;

const k8sConfigMapTemplate = `apiVersion: v1
kind: ConfigMap
metadata:
  name: <%service.name%>-env
  namespace: <%project.namespace%>
  labels:
    app: <%service.name%>
data:
<%#service.env%>
<%#.%>
  <%{key}%>: "<%value%>"
<%/.%>
<%/service.env%>
<%^service.env%>
  NODE_ENV: "production"
<%/service.env%>
  PORT: "<%service.port%>"
<%#service.dependencies%>
  SERVICE_DEPENDENCIES: "<%#.%>
<%{this}%>
<%/.%>
<%/service.dependencies%>
`;

const githubActionsTemplate = `name: Build and Deploy

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

env:
  REGISTRY: ghcr.io
  IMAGE_TAG: \${{ github.sha }}

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service:
<%#services%>
          - <%{name}%>
<%/services%>

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Extract service name
        id: vars
        run: echo "SERVICE_NAME=\${{ matrix.service }}" >> $GITHUB_OUTPUT

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: ./services/\${{ steps.vars.outputs.SERVICE_NAME }}
          push: true
          tags: |
            \${{ env.REGISTRY }}/\${{ github.repository }}-\${{ steps.vars.outputs.SERVICE_NAME }}:\${{ env.IMAGE_TAG }}
            \${{ env.REGISTRY }}/\${{ github.repository }}-\${{ steps.vars.outputs.SERVICE_NAME }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Run tests
        run: |
          cd services/\${{ steps.vars.outputs.SERVICE_NAME }}
          npm ci
          npm test

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up kubectl
        uses: azure/setup-kubectl@v3

      - name: Configure kubectl
        run: |
          echo "\${{ secrets.KUBE_CONFIG }}" | base64 -d > kubeconfig
          echo "KUBECONFIG=$(pwd)/kubeconfig" >> $GITHUB_ENV

      - name: Deploy to Kubernetes
        run: |
<%#services%>
          kubectl apply -f k8s/{{{"{{"}}}/services/<%{name}%>/deployment.yaml
          kubectl apply -f k8s/{{{"{{"}}}/services/<%{name}%>/service.yaml
<%/services%>
<%#databases%>
          kubectl apply -f k8s/{{{"{{"}}}/databases/<%{name}%>.yaml
<%/databases%>
          kubectl apply -f k8s/ingress.yaml
          kubectl rollout status deployment -n <%project.namespace%>
`;

const prometheusConfigMapTemplate = `apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: monitoring
data:
  prometheus.yml: |
    global:
      scrape_interval: 15s
      evaluation_interval: 15s

    scrape_configs:
      - job_name: '<%project.name%>'
        kubernetes_sd_configs:
          - role: pod
        relabel_configs:
          - source_labels:
              - __meta_kubernetes_pod_label_app
            action: keep
            regex: <%services.0.name%><%^services.0.name%>.*<%/services.0.name%>
<%#services%>
      - job_name: '<%name%>'
        kubernetes_sd_configs:
          - role: pod
            namespaces:
              names:
                - {{../project.namespace}}
        relabel_configs:
          - source_labels:
              - __meta_kubernetes_pod_label_app
            action: keep
            regex: <%name%>
          - source_labels:
              - __meta_kubernetes_pod_container_port_number
            action: keep
            regex: "<%port%>"
<%/services%>
<%#databases%>
      - job_name: '<%name%>'
        static_configs:
          - targets:
              - <%name%>.{{../project.namespace}}.svc.cluster.local:<%port%>
<%/databases%>
`;

const serviceReadmeTemplate = `# <%service.name%>

## Overview

Service: **<%service.name%>**
Language: **<%service.language%>**
Port: **<%service.port%>**

<%#service.dependencies%>
## Dependencies

<%#.%>
- <%{this}%>
<%/.%>
<%/service.dependencies%>

<%#service.env%>
## Environment Variables

| Variable | Value |
|----------|-------|
<%#.%>
| <%{key}%> | <%{value}%> |
<%/.%>
<%/service.env%>

## API Endpoints

### Health Check

\`\`\`bash
GET /health
\`\`\`

Returns service health status.

<%#service.healthCheck%>
<%#path%>
### Custom Health Path: <%{path}%>
<%/path%>
<%/service.healthCheck%>

## Local Development

\`\`\`bash
# Start service
docker-compose up <%service.name%>

# View logs
docker-compose logs -f <%service.name%>

# Run tests
cd services/<%service.name%>
npm test
\`\`\`

## Deployment

This service is deployed to Kubernetes with the following configuration:

- **Namespace**: <%project.namespace%>
<%#service.scaling%>
- **Replicas**: <%service.scaling.minReplicas%> - <%service.scaling.maxReplicas%>
<%/service.scaling%>
<%^service.scaling%>
- **Replicas**: 1 - 5
<%/service.scaling%>
- **Health Check**: <%service.healthCheck.path%><%^service.healthCheck.path%>/health<%/service.healthCheck.path%>

## Docker

\`\`\`bash
# Build
docker build -t <%service.name%> ./services/<%service.name%>

# Run
docker run -p <%service.port%>:<%service.port%> <%service.name%>
\`\`\`
`;

const nginxConfTemplate = `upstream <%project.name%> {
<%#services%>
    server <%name%>:<%port%>;
<%/services%>
}

server {
    listen 80;
    server_name _;

    client_max_body_size 10M;

    location / {
        proxy_pass http://<%project.name%>;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /health {
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
`;

const makefileTemplate = `.PHONY: up down logs ps build clean test lint help

COMPOSE_FILE := docker-compose.yml
PROJECT_NAME := <%project.name%>

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\\033[36m%-15s\\033[0m %s\\n", $$1, $$2}'

up: ## Start all services
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) up -d
	@echo "Services started. View logs with: make logs"

down: ## Stop all services
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) down

logs: ## View logs (all services)
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) logs -f

ps: ## List running services
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) ps

build: ## Build all service images
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) build --no-cache

rebuild: ## Rebuild service images without cache
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) down
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) build --no-cache
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) up -d

clean: ## Remove all containers, volumes, and images
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) down -v --remove-orphans
	rm -rf services/*/dist

test: ## Run tests for all services
<%#services%>
	@echo "Testing <%name%>..."
	-cd services/<%name%> && npm test
<%/services%>

lint: ## Run linters
<%#services%>
	@echo "Linting <%name%>..."
	-cd services/<%name%> && npm run lint
<%/services%>

<%#services%>
logs-<%name%>: ## View logs for <%name%>
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) logs -f <%name%>

restart-<%name%>: ## Restart <%name%>
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) restart <%name%>

<%/services%>`;

/**
 * Human-readable descriptions for each template, surfaced by `list-templates`
 * and `info-template`. Keeping the metadata in one place avoids drift between
 * the template name registry (`templates` below) and what the CLI prints.
 */
export interface TemplateMetadata {
  name: string;
  description: string;
  /** What kind of artifact this template renders. Drives the `info-template` summary. */
  category: 'docker' | 'kubernetes' | 'helm' | 'ci' | 'observability' | 'infra' | 'documentation';
  /** True for templates that render once per service (most k8s/services templates). */
  perService: boolean;
  /** Where the rendered file lives under the chosen output directory. */
  outputPath: string;
}

export const templateDescriptions: Record<string, Omit<TemplateMetadata, 'name'>> = {
  'docker-compose': {
    description: 'Docker Compose stack with all services, databases, networks, and health checks.',
    category: 'docker',
    perService: false,
    outputPath: 'docker-compose.yml',
  },
  'dockerfile-node': {
      description: 'Multi-stage Dockerfile for Node.js services (builder + runtime slims).',
      category: 'docker',
      perService: true,
      outputPath: 'services/<name>/Dockerfile',
    },
    'dockerfile-python': {
      description: 'Multi-stage Dockerfile for Python services (builder + runtime slims).',
      category: 'docker',
      perService: true,
      outputPath: 'services/<name>/Dockerfile',
    },
    'dockerfile-go': {
      description: 'Multi-stage Dockerfile for Go services (builder + runtime Alpine).',
      category: 'docker',
      perService: true,
      outputPath: 'services/<name>/Dockerfile',
    },
    'dockerfile-rust': {
      description: 'Multi-stage Dockerfile for Rust services (cargo-chef for dependency caching).',
      category: 'docker',
      perService: true,
      outputPath: 'services/<name>/Dockerfile',
    },
    'dockerfile-java': {
      description: 'Multi-stage Dockerfile for Java services (Maven builder + Eclipse Temurin runtime).',
      category: 'docker',
      perService: true,
      outputPath: 'services/<name>/Dockerfile',
    },
    'docker-swarm': {
      description: 'Docker Swarm stack with deploy configs, healthchecks, and overlay networking.',
      category: 'docker',
      perService: false,
      outputPath: 'docker-compose.swarm.yml',
    },
  'k8s-deployment': {
    description: 'Kubernetes Deployment with resource limits, health probes, and autoscaling annotations.',
    category: 'kubernetes',
    perService: true,
    outputPath: 'k8s/services/<name>/deployment.yaml',
  },
  'k8s-service': {
    description: 'Kubernetes ClusterIP Service for a single service.',
    category: 'kubernetes',
    perService: true,
    outputPath: 'k8s/services/<name>/service.yaml',
  },
  'k8s-hpa': {
    description: 'HorizontalPodAutoscaler with CPU + optional memory utilization.',
    category: 'kubernetes',
    perService: true,
    outputPath: 'k8s/services/<name>/hpa.yaml',
  },
  'k8s-ingress': {
    description: 'Ingress with TLS, cert-manager, and per-service routing rules.',
    category: 'kubernetes',
    perService: false,
    outputPath: 'k8s/ingress.yaml',
  },
  'k8s-configmap': {
    description: 'ConfigMap with the service environment and dependency list.',
    category: 'kubernetes',
    perService: true,
    outputPath: 'k8s/services/<name>/configmap.yaml',
  },
  'k8s-pdb': {
    description: 'PodDisruptionBudget requiring at least 1 pod available during rollouts.',
    category: 'kubernetes',
    perService: true,
    outputPath: 'k8s/services/<name>/pdb.yaml',
  },
  'k8s-networkpolicy': {
    description: 'Per-service NetworkPolicy: ingress from dependencies + ingress-nginx, egress to DNS + dependencies.',
    category: 'kubernetes',
    perService: true,
    outputPath: 'k8s/services/<name>/networkpolicy.yaml',
  },
  'k8s-networkpolicy-strict': {
    description: 'Strict per-service NetworkPolicy: allow only pods in the same namespace, DNS outbound.',
    category: 'kubernetes',
    perService: true,
    outputPath: 'k8s/service-networkpolicies/<name>.yaml',
  },
  'k8s-netpol-default-deny': {
    description: 'Cluster-wide default-deny NetworkPolicy. Use as a baseline before adding allow rules.',
    category: 'kubernetes',
    perService: false,
    outputPath: 'k8s/networkpolicies/default-deny.yaml',
  },
  'helm-chart': {
    description: 'Helm Chart.yaml with project metadata, maintainers, and home URL.',
    category: 'helm',
    perService: false,
    outputPath: 'helm/<project.name>/Chart.yaml',
  },
  'helm-deployment': {
    description: 'Helm template for a single-service Deployment.',
    category: 'helm',
    perService: true,
    outputPath: 'helm/<project.name>/templates/<name>-deployment.yaml',
  },
  'helm-service': {
    description: 'Helm template for a single-service Service.',
    category: 'helm',
    perService: true,
    outputPath: 'helm/<project.name>/templates/<name>-service.yaml',
  },
  'helm-values': {
    description: 'Helm values.yaml with autoscaling, image, ingress, and resource defaults.',
    category: 'helm',
    perService: false,
    outputPath: 'helm/<project.name>/values.yaml',
  },
  'helm-notes': {
    description: 'Helm NOTES.txt — printed after `helm install` to summarise services.',
    category: 'helm',
    perService: false,
    outputPath: 'helm/<project.name>/templates/NOTES.txt',
  },
  'github-actions': {
    description: 'GitHub Actions matrix build + push + kubectl deploy on main.',
    category: 'ci',
    perService: false,
    outputPath: '.github/workflows/deploy.yml',
  },
  'prometheus-cm': {
    description: 'Prometheus ConfigMap with per-service and per-database scrape configs.',
    category: 'observability',
    perService: false,
    outputPath: 'k8s/monitoring/prometheus-configmap.yaml',
  },
  'grafana-dashboard': {
    description: 'Grafana dashboard JSON with cluster health + per-service request / error / latency panels.',
    category: 'observability',
    perService: false,
    outputPath: 'k8s/monitoring/grafana-dashboard.json',
  },
  'grafana-datasource': {
    description: 'Grafana datasource ConfigMap pointing at the in-cluster Prometheus.',
    category: 'observability',
    perService: false,
    outputPath: 'k8s/monitoring/grafana-datasource.yaml',
  },
  'grafana-dashboard-provider': {
    description: 'Grafana dashboard provider ConfigMap for sidecar provisioning.',
    category: 'observability',
    perService: false,
    outputPath: 'k8s/monitoring/grafana-dashboard-provider.yaml',
  },
  'service-readme': {
    description: 'Per-service README with overview, dependencies, env, and deployment notes.',
    category: 'documentation',
    perService: true,
    outputPath: 'services/<name>/README.md',
  },
  'nginx-conf': {
    description: 'Top-level nginx reverse-proxy config with per-service upstream + health endpoint.',
    category: 'infra',
    perService: false,
    outputPath: 'nginx.conf',
  },
  'Makefile': {
    description: 'Makefile with up, down, logs, build, test, lint, and per-service target aliases.',
    category: 'infra',
    perService: false,
    outputPath: 'Makefile',
  },
  'terraform-aws': {
    description: 'Terraform module for AWS: VPC, EKS, RDS, ElastiCache, IAM, and the EKS node group.',
    category: 'infra',
    perService: false,
    outputPath: 'terraform/main.tf',
  },
  'grpc-node-service': {
    description: 'gRPC service implementation for Node.js using @grpc/grpc-js.',
    category: 'docker',
    perService: true,
    outputPath: 'services/<name>/src/index.ts',
  },
  'grpc-go-service': {
    description: 'gRPC service implementation for Go using google.golang.org/grpc.',
    category: 'docker',
    perService: true,
    outputPath: 'services/<name>/cmd/server/main.go',
  },
  'grpc-dockerfile-node': {
    description: 'Multi-stage Dockerfile for gRPC Node.js services with protobuf compilation.',
    category: 'docker',
    perService: true,
    outputPath: 'services/<name>/Dockerfile',
  },
  'grpc-dockerfile-go': {
    description: 'Multi-stage Dockerfile for gRPC Go services with protobuf compilation.',
    category: 'docker',
    perService: true,
    outputPath: 'services/<name>/Dockerfile',
  },
  'grpc-node-package-json': {
    description: 'package.json for gRPC Node.js services with @grpc/grpc-js and protobuf deps.',
    category: 'docker',
    perService: true,
    outputPath: 'services/<name>/package.json',
  },
  'grpc-go-mod': {
    description: 'go.mod for gRPC Go services with grpc and protobuf dependencies.',
    category: 'docker',
    perService: true,
    outputPath: 'services/<name>/go.mod',
  },
  'grpc-readme': {
    description: 'Per-service README for gRPC services with proto usage examples.',
    category: 'documentation',
    perService: true,
    outputPath: 'services/<name>/README.md',
  },
};

export function listTemplates(): string[] {
  return Object.keys(templates);
}

/**
 * Returns rich metadata for every template that ships with DevForge. Used by
 * the `list-templates --verbose` and `info-template <name>` CLI commands.
 * Templates without a metadata entry are still listed — they just get
 * fall-through defaults so we never break an unknown template.
 */
export function listTemplatesWithMetadata(): TemplateMetadata[] {
  return Object.keys(templates).map((name) => {
    const meta = templateDescriptions[name];
    return {
      name,
      description: meta?.description ?? '(no description)',
      category: meta?.category ?? 'infra',
      perService: meta?.perService ?? false,
      outputPath: meta?.outputPath ?? name,
    };
  });
}

/**
 * Returns metadata for a single template, or `null` if the template name is
 * unknown. The binary form (`name` only) is kept for backwards compatibility
 * with the existing `listTemplates()` API.
 */
export function getTemplateMetadata(name: string): TemplateMetadata | null {
  if (!(name in templates)) {
    return null;
  }
  const meta = templateDescriptions[name];
  return {
    name,
    description: meta?.description ?? '(no description)',
    category: meta?.category ?? 'infra',
    perService: meta?.perService ?? false,
    outputPath: meta?.outputPath ?? name,
  };
}

export function renderTemplate(templateName: string, context: TemplateContext): string {
  const template = (templates as Record<string, string>)[templateName];
  if (!template) {
    throw new Error(`Unknown template: ${templateName}`);
  }
  // Configure delimiters per-tag via the Mustache.js Writer config:
  //   <% %> for variable interpolation
  //   <%{ %> %> for raw output (no HTML escaping)
  // This is the supported, idiomatic way to override delimiters without
  // adding a `{{=<% %>=}}` header to every template.
  //
  // Security note: Mustache 4 calls HTML-escape on every <%var%> output by
  // default. DevForge generates non-HTML artifacts (k8s YAML, Dockerfile,
  // Makefile, GitHub Actions), so HTML escaping silently corrupts identifiers
  // that contain `<`, `>`, `&`, `"`, or `'` — e.g. a service named `api<v1>`
  // would render as `api&lt;v1&gt;` and break `kubectl apply`. We override the
  // escape function with an identity function so identifiers pass through
  // unchanged. Authors of new templates who need HTML escaping should use
  // `<%{var}%>` (raw) intentionally, not rely on the default.
  return Mustache.render(
    template,
    context,
    {},
    {
      tags: ['<%', '%>'],
      escape: (value: unknown) => (value == null ? '' : String(value)),
    } as unknown
  );
}

/**
 * Returns the list of placeholder tags ({{var}}) used in a template, after
 * stripping any non-printing artifacts. Used by the template-validation
 * pipeline to detect missing context keys before writing files.
 */
export function getTemplatePlaceholders(templateName: string): string[] {
  const template = (templates as Record<string, string>)[templateName];
  if (!template) {
    throw new Error(`Unknown template: ${templateName}`);
  }
  // The project uses <% %> delimiters, not the Mustache default {{ }}.
  // Match variable tags (`<%name%>`, `<%service.name%>`) — these are the only
  // placeholders that need to resolve against the TemplateContext. Skip section
  // tags (<%#foo%>, <%/foo%>, <%^foo%>, <%!comment%>, <%{raw}%>, <%.%>) which
  // are control flow or lambdas, not data lookups.
  const variableTag = /<%([\^/!{#]|\\.[^%]*)?\s*([A-Za-z0-9_.]+)\s*%>/g;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = variableTag.exec(template)) !== null) {
    names.add(m[2]);
  }
  return Array.from(names).sort();
}

/**
 * Validates that all placeholders in a template can be resolved against
 * a sample TemplateContext. Returns an array of missing/unresolvable placeholders.
 * If the array is empty, the template is valid.
 */
export function validateTemplatePlaceholders(
  templateName: string,
  context: TemplateContext
): string[] {
  const placeholders = getTemplatePlaceholders(templateName);
  const missing: string[] = [];

  // Helper to check if a dotted path exists in an object
  function hasPath(obj: unknown, path: string): boolean {
    if (obj === null || obj === undefined) return false;
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return false;
      if (typeof current !== 'object') return false;
      if (!(part in current)) return false;
      current = (current as Record<string, unknown>)[part];
    }
    return true;
  }

  // Known Mustache special paths that are valid in sections but don't need
  // explicit context keys (they're resolved by Mustache at render time).
  const mustacheSpecialPaths = new Set(['.', 'this']);

  for (const placeholder of placeholders) {
    // Skip Mustache special iteration context references
    if (mustacheSpecialPaths.has(placeholder)) continue;

    if (!hasPath(context, placeholder)) {
      missing.push(placeholder);
    }
  }

  return missing;
}

/**
 * Validates all templates against a sample context and returns a map of
 * template name -> missing placeholders. Templates with no missing placeholders
 * are not included in the result.
 */
export function validateAllTemplates(
  context: TemplateContext
): Map<string, string[]> {
  const results = new Map<string, string[]>();
  for (const name of listTemplates()) {
    const missing = validateTemplatePlaceholders(name, context);
    if (missing.length > 0) {
      results.set(name, missing);
    }
  }
  return results;
}
const k8sPDBTemplate = `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: <%service.name%>
  namespace: <%project.namespace%>
  labels:
    app: <%service.name%>
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: <%service.name%>`;

// Per-service NetworkPolicy (k8s-networkpolicy)
const k8sNetworkPolicyTemplate = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: <%service.name%>
  namespace: <%project.namespace%>
  labels:
    app: <%service.name%>
spec:
  podSelector:
    matchLabels:
      app: <%service.name%>
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
<%#service.dependencies%>
        - podSelector:
            matchLabels:
              app: <%{this}%>
<%/service.dependencies%>
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - port: <%service.port%>
          protocol: TCP
  egress:
    - to:
        - namespaceSelector: {}
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
<%#service.dependencies%>
    - to:
        - podSelector:
            matchLabels:
              app: <%{this}%>
      ports:
        - port: <%service.port%>
          protocol: TCP
<%/service.dependencies%>`;

// Cluster-wide default-deny NetworkPolicy
const k8sNetPolDefaultDenyTemplate = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: <%project.namespace%>
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress`;

// Stricter per-service NetworkPolicy
const k8sNetworkPolicyStrictTemplate = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: <%service.name%>-strict
  namespace: <%project.namespace%>
  labels:
    app: <%service.name%>
spec:
  podSelector:
    matchLabels:
      app: <%service.name%>
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
      ports:
        - port: <%service.port%>
          protocol: TCP
  egress:
    - to:
        - namespaceSelector: {}
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP`;

// Helm chart — Chart.yaml
const helmChartTemplate = `apiVersion: v2
name: <%project.name%>
description: <%project.name%> helm chart
type: application
version: 0.1.0
appVersion: "0.1.0"
keywords:
  - microservices
  - devforge
home: https://github.com/<%project.github.owner%>/<%project.name%>
maintainers:
  - name: <%project.github.owner%>
`;

// Helm chart — deployment template
const helmChartDeploymentTemplate = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: <%service.name%>
  namespace: <%project.namespace%>
  labels:
    app: <%service.name%>
    app.kubernetes.io/name: <%service.name%>
spec:
  replicas: <%service.scaling.minReplicas%>
  selector:
    matchLabels:
      app: <%service.name%>
  template:
    metadata:
      labels:
        app: <%service.name%>
    spec:
      containers:
        - name: <%service.name%>
          image: "<%service.image%>"
          ports:
            - name: http
              containerPort: <%service.port%>
          livenessProbe:
            httpGet:
              path: <%service.healthCheck.path%>
              port: http
          readinessProbe:
            httpGet:
              path: /ready
              port: http
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
`;

// Helm chart — service template
const helmChartServiceTemplate = `apiVersion: v1
kind: Service
metadata:
  name: <%service.name%>
  namespace: <%project.namespace%>
spec:
  type: ClusterIP
  ports:
    - port: <%service.port%>
      targetPort: http
  selector:
    app: <%service.name%>
`;

// Helm chart — values.yaml
const helmValuesTemplate = `# Default values for <%project.name%>.
# This is a YAML-formatted file.
replicaCount: 1

image:
  repository: <%project.github.owner%>/<%project.name%>
  pullPolicy: IfNotPresent
  tag: "0.1.0"

service:
  type: ClusterIP
  port: 80

ingress:
  enabled: false
  className: ""
  annotations: {}
  hosts:
    - host: chart-example.local
      paths:
        - path: /
          pathType: ImplementationSpecific
  tls: []

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 128Mi

autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 5
  targetCPUUtilizationPercentage: 80
`;

// Helm chart — NOTES.txt
const helmChartNOTES = `<%project.name%> has been deployed to namespace <%project.namespace%>.

Services:
<%#services%>
- <%name%> on port <%port%>
<%/services%>
`;

// Grafana dashboard ConfigMap — provisioned alongside Prometheus so a fresh
// cluster has working visualizations the moment `kubectl apply` finishes.
// Generates a service-by-service row with request-rate / error-rate / latency
// panels, plus a top-level cluster health row.
const grafanaDashboardTemplate = `{
  "annotations": {
    "list": []
  },
  "editable": true,
  "fiscalYearStartMonth": 0,
  "graphTooltip": 1,
  "id": null,
  "links": [],
  "liveNow": false,
  "panels": [
    {
      "type": "row",
      "title": "Cluster Health",
      "id": 1,
      "gridPos": { "h": 1, "w": 24, "x": 0, "y": 0 },
      "collapsed": false,
      "panels": []
    },
    {
      "type": "stat",
      "title": "Services Running",
      "id": 2,
      "gridPos": { "h": 4, "w": 6, "x": 0, "y": 1 },
      "targets": [
        {
          "expr": "count(kube_deployment_status_replicas_available{namespace=\\"<%project.namespace%>\\"})",
          "refId": "A"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "red", "value": null },
              { "color": "green", "value": 1 }
            ]
          }
        }
      },
      "options": {
        "colorMode": "background",
        "graphMode": "none",
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false }
      }
    },
    {
      "type": "stat",
      "title": "Pods Ready",
      "id": 3,
      "gridPos": { "h": 4, "w": 6, "x": 6, "y": 1 },
      "targets": [
        {
          "expr": "sum(kube_deployment_status_replicas_ready{namespace=\\"<%project.namespace%>\\"})",
          "refId": "A"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "red", "value": null },
              { "color": "green", "value": 1 }
            ]
          }
        }
      }
    },
    {
      "type": "stat",
      "title": "CPU Usage (cores)",
      "id": 4,
      "gridPos": { "h": 4, "w": 6, "x": 12, "y": 1 },
      "targets": [
        {
          "expr": "sum(rate(container_cpu_usage_seconds_total{namespace=\\"<%project.namespace%>\\"}[5m]))",
          "refId": "A"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short",
          "decimals": 2
        }
      }
    },
    {
      "type": "stat",
      "title": "Memory Usage",
      "id": 5,
      "gridPos": { "h": 4, "w": 6, "x": 18, "y": 1 },
      "targets": [
        {
          "expr": "sum(container_memory_working_set_bytes{namespace=\\"<%project.namespace%>\\"})",
          "refId": "A"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "bytes",
          "decimals": 2
        }
      }
    },
    {
      "type": "row",
      "title": "Per-Service Metrics",
      "id": 10,
      "gridPos": { "h": 1, "w": 24, "x": 0, "y": 5 },
      "collapsed": false,
      "panels": []
    }<%#services%>,
    {
      "type": "timeseries",
      "title": "<%name%> — Request Rate",
      "id": <%id.request%>,
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "gridPos": { "h": 8, "w": 8, "x": 0, "y": <%id.y%> },
      "targets": [
        {
          "expr": "sum(rate(http_requests_total{namespace=\\"<%project.namespace%>\\",job=\\"<%name%>\\"}[5m]))",
          "legendFormat": "{{code}}",
          "refId": "A"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "reqps",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "smooth",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        }
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom" }
      }
    },
    {
      "type": "timeseries",
      "title": "<%name%> — Error Rate",
      "id": <%id.error%>,
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "gridPos": { "h": 8, "w": 8, "x": 8, "y": <%id.y%> },
      "targets": [
        {
          "expr": "sum(rate(http_requests_total{namespace=\\"<%project.namespace%>\\",job=\\"<%name%>\\",code=~\\"5..\\"}[5m])) / sum(rate(http_requests_total{namespace=\\"<%project.namespace%>\\",job=\\"<%name%>\\"}[5m]))",
          "legendFormat": "error %",
          "refId": "A"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "min": 0,
          "max": 1,
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "smooth",
            "fillOpacity": 10
          }
        }
      }
    },
    {
      "type": "timeseries",
      "title": "<%name%> — p95 Latency",
      "id": <%id.latency%>,
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "gridPos": { "h": 8, "w": 8, "x": 16, "y": <%id.y%> },
      "targets": [
        {
          "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{namespace=\\"<%project.namespace%>\\",job=\\"<%name%>\\"}[5m])) by (le))",
          "legendFormat": "p95",
          "refId": "A"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "s",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "smooth",
            "fillOpacity": 10
          }
        }
      }
    }<%/services%>
  ],
  "refresh": "30s",
  "schemaVersion": 38,
  "tags": ["devforge", "<%project.name%>"],
  "templating": { "list": [] },
  "time": { "from": "now-6h", "to": "now" },
  "timepicker": {},
  "timezone": "",
  "title": "<%project.name%> — Service Overview",
  "uid": "<%project.name%>-overview",
  "version": 1,
  "weekStart": ""
}
`;

// Grafana datasource ConfigMap — points the provisioned dashboard at the
// in-cluster Prometheus service. Sidecar provisioning reads this ConfigMap
// from /etc/grafana/provisioning/datasources/.
const grafanaDatasourceTemplate = `apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasource-prometheus
  namespace: monitoring
  labels:
    grafana_datasource: "1"
data:
  prometheus.yaml: |
    apiVersion: 1
    datasources:
      - name: Prometheus
        type: prometheus
        uid: prometheus
        access: proxy
        url: http://prometheus.monitoring.svc.cluster.local:9090
        isDefault: true
        editable: false
        jsonData:
          timeInterval: "15s"
`;

// Grafana dashboard provider ConfigMap — sidecar provisioning auto-loads any
// dashboard dropped into /etc/grafana/provisioning/dashboards/.
const grafanaDashboardProviderTemplate = `apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboards-provider
  namespace: monitoring
  labels:
    grafana_dashboard: "1"
data:
  provider.yaml: |
    apiVersion: 1
    providers:
      - name: devforge
        orgId: 1
        folder: "DevForge"
        type: file
        disableDeletion: false
        updateIntervalSeconds: 30
        allowUiUpdates: true
        options:
          path: /etc/grafana/provisioning/dashboards
`;

// Terraform — AWS EKS platform for <%project.name%>. Provisions VPC, EKS
// cluster, default node group, RDS Postgres <%#databases%>(<%name%> instance)<%/databases%>,
// and an IAM role for the cluster. Apply from the generated terraform/ dir.
const terraformAWSMainTemplate = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket = "<%project.name%>-terraform-state"
    key    = "platform/terraform.tfstate"
    region = "us-east-1"
    encrypt = true
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "EKS cluster name."
  type        = string
  default     = "<%project.name%>"
}

variable "kubernetes_version" {
  description = "Kubernetes version for the EKS control plane."
  type        = string
  default     = "1.29"
}

variable "node_instance_type" {
  description = "EC2 instance type for the default node group."
  type        = string
  default     = "m6i.large"
}

variable "node_min_size" {
  type    = number
  default = 2
}

variable "node_max_size" {
  type    = number
  default = 10
}

variable "node_desired_size" {
  type    = number
  default = 3
}

# ----- VPC -----
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "\${var.cluster_name}-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["\${var.aws_region}a", "\${var.aws_region}b", "\${var.aws_region}c"]
  public_subnets  = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  private_subnets = ["10.0.10.0/24", "10.0.11.0/24", "10.0.12.0/24"]

  enable_nat_gateway   = true
  single_nat_gateway   = true
  enable_dns_hostnames = true

  tags = {
    "kubernetes.io/cluster/\${var.cluster_name}" = "shared"
  }
}

# ----- EKS -----
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.kubernetes_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  eks_managed_node_groups = {
    default = {
      instance_types = [var.node_instance_type]
      min_size       = var.node_min_size
      max_size       = var.node_max_size
      desired_size   = var.node_desired_size

      labels = {
        role = "general"
      }
    }
  }

  tags = {
    Environment = "<%project.namespace%>"
    Project     = "<%project.name%>"
  }
}
<%#databases%>
# ----- RDS: <%name%> (<%type%> <%version%>) -----
module "rds_<%name%>" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.0"

  identifier = "\${var.cluster_name>-<%name%>"

  engine            = "<%type%>"
  engine_version    = "<%version%>"
  instance_class    = "db.t3.medium"
  allocated_storage = 20

  db_name  = "<%project.name%>"
  username = "admin"
  port     = <%port%>

  vpc_security_group_ids = [module.vpc.default_security_group_id]
  db_subnet_group_name   = module.vpc.database_subnet_group
  publicly_accessible    = false

  family = "<%type%><%version%>"

  tags = {
    Service = "<%name%>"
  }
}
<%/databases%>
# ----- Outputs -----
output "cluster_endpoint" {
  description = "EKS API endpoint."
  value       = module.eks.cluster_endpoint
}

output "cluster_name" {
  value = module.eks.cluster_name
}

output "kubeconfig_command" {
  description = "Command to populate kubeconfig."
  value       = "aws eks update-kubeconfig --name \${module.eks.cluster_name} --region \${var.aws_region}"
}
<%#databases%>

output "db_<%name%>_endpoint" {
  value = module.rds_<%name%>.db_instance_endpoint
}
<%/databases%>
`;

// Registry of all templates — placed after every const declaration to avoid
// TDZ (temporal dead zone) forward references to k8s/helm templates below.

// Deployment platform configs
const vercelTemplate = `{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "<%project.framework%>",
  "regions": ["iad1"]
}
`;

const flyTemplate = `# Fly.io configuration for <%service.name%>
app = "<%service.name%>"
primary_region = "<%project.region%>"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
`;

const railwayTemplate = `# Railway configuration for <%service.name%>
buildCommand = "npm run build"
startCommand = "npm start"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
`;

const renderPlatformTemplate = `# Render configuration for <%service.name%>
services:
  - type: web
    name: <%service.name%>
    env: node
    plan: starter
    buildCommand: npm run build
    startCommand: npm start
    healthCheckPath: /health
    autoDeploy: true
`;

const cloudflareWorkersTemplate = `// Cloudflare Workers config for <%service.name%>
name = "<%service.name%>"
main = "src/worker.ts"
compatibility_date = "2024-01-01"
workers_dev = true

[vars]
NODE_ENV = "production"
`;

// OpenTelemetry instrumentation templates
const opentelemetryNodeTemplate = `// OpenTelemetry Node.js instrumentation for <%service.name%>
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  }),
  serviceName: '<%service.name%>',
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error shutting down OpenTelemetry SDK', err);
      process.exit(1);
    });
});
`;

const opentelemetryPythonTemplate = `# OpenTelemetry Python instrumentation for <%service.name%>
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.auto_instrumentation import (  # type: ignore[attr-defined]
    sitecustomize,
)

provider = TracerProvider()
processor = BatchSpanProcessor(
    OTLPSpanExporter(endpoint="http://localhost:4318/v1/traces")
)
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("<%service.name%>")
`;

const opentelemetryGoTemplate = `// OpenTelemetry Go instrumentation for <%service.name%>
package main

import (
	"context"
	"log"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
)

func initTracer() (*sdktrace.TracerProvider, error) {
	ctx := context.Background()
	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpoint("localhost:4318"),
		otlptracehttp.WithInsecure(),
	)
	if err != nil {
		return nil, err
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName("<%service.name%>"),
		),
	)
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})

	return tp, nil
}

func main() {
	tp, err := initTracer()
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		if err := tp.Shutdown(context.Background()); err != nil {
			log.Printf("Error shutting down tracer provider: %v", err)
		}
	}()

	// Your service code here
	_ = otel.Tracer("<%service.name%>")
}
`;

const opentelemetryRustTemplate = `// OpenTelemetry Rust instrumentation for <%service.name%>
use opentelemetry::{global, trace::TracerProvider as _};
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{trace::TracerProvider, Resource};
use std::time::Duration;

fn init_tracer() -> Result<TracerProvider, Box<dyn std::error::Error + Send + Sync + 'static>> {
    let exporter = opentelemetry_otlp::new_exporter()
        .http()
        .with_endpoint("http://localhost:4318/v1/traces")
        .with_timeout(Duration::from_secs(30));

    let provider = TracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(
            Resource::builder()
                .with_service_name("<%service.name%>")
                .build(),
        )
        .build();

    global::set_tracer_provider(provider.clone());
    Ok(provider)
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    let provider = init_tracer()?;

    // Your service code here
    let _tracer = global::tracer("<%service.name%>");

    // Shutdown
    provider.shutdown()?;
    Ok(())
}
`;

const opentelemetryJavaTemplate = `// OpenTelemetry Java instrumentation for <%service.name%>
package com.<%project.github.owner%>.<%project.name%>.<%service.name%>;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.exporter.otlp.trace.OtlpGrpcSpanExporter;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.semconv.resource.attributes.ResourceAttributes;

public class OpenTelemetryConfig {
    public static OpenTelemetry initOpenTelemetry() {
        OtlpGrpcSpanExporter exporter = OtlpGrpcSpanExporter.builder()
            .setEndpoint("http://localhost:4317")
            .build();

        SdkTracerProvider tracerProvider = SdkTracerProvider.builder()
            .addSpanProcessor(BatchSpanProcessor.builder(exporter).build())
            .setResource(Resource.getDefault().toBuilder()
                .put(ResourceAttributes.SERVICE_NAME, "<%service.name%>")
                .build())
            .build();

        OpenTelemetry openTelemetry = OpenTelemetrySdk.builder()
            .setTracerProvider(tracerProvider)
            .buildAndRegisterGlobal();

        return openTelemetry;
    }
    
    public static void main(String[] args) {
        OpenTelemetry openTelemetry = initOpenTelemetry();
        Tracer tracer = openTelemetry.getTracer("<%service.name%>");
        // Your service code here
    }
}
`;

// gRPC service templates

const grpcProtoTemplate = `syntax = "proto3";

package <%service.name%>;

option go_package = "github.com/<%project.github.owner%>/<%project.name%>/gen/go/<%service.name%>";
option java_package = "com.<%project.github.owner%>.<%project.name%>.<%service.name%>";
option java_multiple_files = true;

service <%service.name%> {
  rpc HealthCheck (HealthCheckRequest) returns (HealthCheckResponse);
  rpc GetItem (GetItemRequest) returns (GetItemResponse);
  rpc ListItems (ListItemsRequest) returns (ListItemsResponse);
}

message HealthCheckRequest {
  string service = 1;
}

message HealthCheckResponse {
  bool healthy = 1;
  string status = 2;
}

message GetItemRequest {
  string id = 1;
}

message GetItemResponse {
  Item item = 1;
}

message ListItemsRequest {
  int32 page_size = 1;
  string page_token = 2;
}

message ListItemsResponse {
  repeated Item items = 1;
  string next_page_token = 2;
}

message Item {
  string id = 1;
  string name = 2;
  string description = 3;
  int64 created_at = 4;
  int64 updated_at = 5;
}
`;

const grpcNodeServiceTemplate = `# <%- service.name %> gRPC Service

import { loadSync } from '@grpc/proto-loader';
import { GrpcObject, loadPackageDefinition, Server, ServerCredentials, handleUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');

const PROTO_PATH = join(__dirname, 'proto', '<%service.name%>.proto');

const packageDefinition = loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = loadPackageDefinition(packageDefinition) as unknown as GrpcObject;
const serviceProto = proto.<%service.name%> as GrpcObject;

interface Item {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

const items: Map<string, Item> = new Map();

function healthCheck(call: handleUnaryCall<any, any>, callback: sendUnaryData<any>): void {
  callback(null, { healthy: true, status: 'serving' });
}

function getItem(call: handleUnaryCall<any, any>, callback: sendUnaryData<any>): void {
  const { id } = call.request;
  const item = items.get(id);
  if (!item) {
    callback({ code: 5, message: 'Item not found' } as any, null);
    return;
  }
  callback(null, { item });
}

function listItems(call: handleUnaryCall<any, any>, callback: sendUnaryData<any>): void {
  const { page_size = 10, page_token } = call.request;
  const allItems = Array.from(items.values());
  const start = page_token ? parseInt(page_token, 10) : 0;
  const end = Math.min(start + page_size, allItems.length);
  const pageItems = allItems.slice(start, end);
  const nextPageToken = end < allItems.length ? String(end) : '';
  callback(null, { items: pageItems, next_page_token: nextPageToken });
}

function main(): void {
  const server = new Server();
  server.addService(serviceProto.<%service.name%>.service, {
    healthCheck,
    getItem,
    listItems,
  });

  const port = process.env.PORT || '<%service.port%>';
  server.bindAsync(\`0.0.0.0:\${port}\`, ServerCredentials.createInsecure(), (err, boundPort) => {
    if (err) {
      console.error('Failed to bind gRPC server:', err);
      process.exit(1);
    }
    console.log(\`gRPC server running on port \${boundPort}\`);
  });
}

main();
`;

const grpcGoServiceTemplate = `package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	pb "github.com/<%project.github.owner%>/<%project.name%>/gen/go/<%service.name%>"
)

type server struct {
	pb.Unimplemented<%service.name%>Server
	mu    sync.RWMutex
	items map[string]*pb.Item
}

func (s *server) HealthCheck(ctx context.Context, req *pb.HealthCheckRequest) (*pb.HealthCheckResponse, error) {
	return &pb.HealthCheckResponse{Healthy: true, Status: "serving"}, nil
}

func (s *server) GetItem(ctx context.Context, req *pb.GetItemRequest) (*pb.GetItemResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.items[req.Id]
	if !ok {
		return nil, fmt.Errorf("item not found: %s", req.Id)
	}
	return &pb.GetItemResponse{Item: item}, nil
}

func (s *server) ListItems(ctx context.Context, req *pb.ListItemsRequest) (*pb.ListItemsResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	pageSize := int(req.PageSize)
	if pageSize <= 0 {
		pageSize = 10
	}

	start := 0
	if req.PageToken != "" {
		var err error
		start, err = strconv.Atoi(req.PageToken)
		if err != nil {
			return nil, fmt.Errorf("invalid page token: %v", err)
		}
	}

	var allItems []*pb.Item
	for _, item := range s.items {
		allItems = append(allItems, item)
	}

	end := start + pageSize
	if end > len(allItems) {
		end = len(allItems)
	}

	var nextPageToken string
	if end < len(allItems) {
		nextPageToken = strconv.Itoa(end)
	}

	return &pb.ListItemsResponse{
		Items:          allItems[start:end],
		NextPageToken:  nextPageToken,
	}, nil
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "<%service.port%>"
	}

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	s := grpc.NewServer()
	pb.Register<%service.name%>Server(s, &server{
		items: make(map[string]*pb.Item),
	})

	// Register health check
	healthServer := health.NewServer()
	healthpb.RegisterHealthServer(s, healthServer)
	healthServer.SetServingStatus("<%service.name%>", healthpb.HealthCheckResponse_SERVING)

	// Enable reflection for grpcurl
	reflection.Register(s)

	log.Printf("gRPC server listening on port %s", port)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
`;

const grpcDockerfileNodeTemplate = `# syntax=docker/dockerfile:1
FROM node:<%{nodeVersion}%> AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src
COPY proto ./proto
RUN npm run build || true

FROM node:<%{nodeVersion}%>-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/proto ./proto
COPY package*.json ./

<%#env%>
<%#.%>
ENV <%{key}%>=<%{value}%>
<%/.%>
<%/env%>

EXPOSE <%{port}%>
<%#healthCheck%>
<%#path%>
HEALTHCHECK --interval=<%{interval}%> --timeout=<%{timeout}%> --retries=<%{retries}%> \\\\
  CMD curl -f http://localhost:<%{port}%><%{path}%> || exit 1
<%/path%>
<%/healthCheck%>

<%#command%>
CMD [<%#.%><%{this}%>, <%/.%>]
<%/command%>
<%^command%>
CMD ["node", "dist/index.js"]
<%/command%>
`;

const grpcDockerfileGoTemplate = `# syntax=docker/dockerfile:1
FROM golang:<%{goVersion}%>-alpine AS builder
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git make protobuf

# Download dependencies first (caching)
COPY go.mod go.sum ./
RUN go mod download

# Generate gRPC code
COPY proto ./proto
RUN mkdir -p gen/go && \\
    protoc --go_out=gen/go --go-grpc_out=gen/go proto/*.proto

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/bin/server ./cmd/server

FROM alpine:<%{alpineVersion}%> AS runtime
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache ca-certificates curl tzdata \\
    && update-ca-certificates

# Create non-root user
RUN addgroup -g 1000 -S appgroup && \\
    adduser -u 1000 -S appuser -G appgroup

# Copy binary from builder
COPY --from=builder /app/bin/server /app/bin/server

# Copy generated protobuf files
COPY --from=builder /app/gen ./gen

<%#env%>
<%#.%>
ENV <%{key}%>=<%{value}%>
<%/.%>
<%/env%>

EXPOSE <%{port}%>
<%#healthCheck%>
<%#path%>
HEALTHCHECK --interval=<%{interval}%> --timeout=<%{timeout}%> --retries=<%{retries}%> \\\\\\\\\\
  CMD curl -f http://localhost:<%{port}%><%{path}%> || exit 1
<%/path%>
<%/healthCheck%>

USER appuser
CMD ["/app/bin/server"]
`;

const grpcNodePackageJson = `{
  "name": "<%service.name%>",
  "version": "0.1.0",
  "description": "<%service.name%> gRPC microservice",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest",
    "lint": "eslint src --ext .ts",
    "proto:generate": "grpc_tools_node_protoc --js_out=import_style=commonjs,binary:src --grpc_out=grpc_js:src --proto_path=proto proto/*.proto"
  },
  "dependencies": {
    "@grpc/grpc-js": "^1.9.0",
    "@grpc/proto-loader": "^0.7.10",
    "grpc-tools": "^1.12.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "vitest": "^1.0.0"
  }
}
`;

const grpcGoModTemplate = `module github.com/<%project.github.owner%>/<%project.name%>/services/<%service.name%>

go 1.22

require (
	github.com/golang/protobuf v1.5.3
	google.golang.org/grpc v1.62.0
	google.golang.org/protobuf v1.32.0
)

require (
	github.com/cespare/xxhash/v2 v2.2.0 // indirect
	github.com/golang/protobuf v1.5.3 // indirect
	golang.org/x/net v0.17.0 // indirect
	golang.org/x/sys v0.13.0 // indirect
	golang.org/x/text v0.13.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20231016162920-1e3b3b6c5c5d // indirect
	google.golang.org/grpc v1.62.0 // indirect
)
`;

const grpcReadmeTemplate = `# <%service.name%>

## Overview

Service: **<%service.name%>**
Protocol: **gRPC**
Port: **<%service.port%>**

<%#service.dependencies%>
## Dependencies

<%#.%>
- <%{this}%>
<%/.%>
<%/service.dependencies%>

## gRPC Service Definition

The service is defined in \`proto/<%service.name%>.proto\`:

\`\`\`protobuf
service <%service.name%> {
  rpc HealthCheck (HealthCheckRequest) returns (HealthCheckResponse);
  rpc GetItem (GetItemRequest) returns (GetItemResponse);
  rpc ListItems (ListItemsRequest) returns (ListItemsResponse);
}
\`\`\`

## Local Development

\`\`\`bash
# Start service (Node.js)
docker-compose up <%service.name%>

# Start service (Go)
docker-compose up <%service.name%>-go

# Test with grpcurl
grpcurl -plaintext -d '{"service": "<%service.name%>"}' localhost:<%service.port%> <%service.name%>.<%service.name%>/HealthCheck

# Generate gRPC clients (Node.js)
cd services/<%service.name%>
npm run proto:generate
\`\`\`

## Deployment

This service is deployed to Kubernetes with the following configuration:

- **Namespace**: <%project.namespace%>
<%#service.scaling%>
- **Replicas**: <%service.scaling.minReplicas%> - <%service.scaling.maxReplicas%>
<%/service.scaling%>
<%^service.scaling%>
- **Replicas**: 1 - 5
<%/service.scaling%>
- **Health Check**: gRPC Health Checking Protocol

## Docker

\`\`\`bash
# Build (Node.js)
docker build -t <%service.name%> ./services/<%service.name%>

# Build (Go)
docker build -t <%service.name%>-go -f Dockerfile.go ./services/<%service.name%>

# Run
docker run -p <%service.port%>:<%service.port%> <%service.name%>
\`\`\`
`;
// Kubernetes Secret template with SealedSecret and External Secrets hints
const k8sSecretTemplate = `apiVersion: v1
kind: Secret
metadata:
  name: <%service.name%>-secrets
  namespace: <%project.namespace%>
  labels:
    app: <%service.name%>
type: Opaque
stringData:
<%#service.env%>
<%#.%>
  <%{key}%>: "<%value%>"
<%/.%>
<%/service.env%>
<%^service.env%>
  # No environment variables defined in spec
  # Add your secrets here:
  # API_KEY: "your-api-key"
  # DATABASE_PASSWORD: "your-db-password"
<%/service.env%>
---
# For production, consider using SealedSecrets (bitnami-labs/sealed-secrets)
# or External Secrets Operator (external-secrets.io) with a secret store.
# Example SealedSecret workflow:
# 1. Install kubeseal: brew install kubeseal
# 2. Seal this secret: kubeseal --controller-name=sealed-secrets --controller-namespace=kube-system -o yaml < this-secret.yaml > sealed-secret.yaml
# 3. Commit sealed-secret.yaml to Git (safe!)
`;

// ArgoCD Application template for GitOps deployment
const argocdApplicationTemplate = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: <%project.name%>
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/<%project.github.owner%>/<%project.github.repo%>
    targetRevision: <%project.github.branch%><%^project.github.branch%>main<%/project.github.branch%>
    path: k8s
  destination:
    server: https://kubernetes.default.svc
    namespace: <%project.namespace%>
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
      allowEmpty: false
    syncOptions:
      - CreateNamespace=true
      - PruneLast=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
---
# Apply with: kubectl apply -f k8s/argocd-application.yaml
# Requires: ArgoCD installed in cluster (kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml)
`;

// Prometheus ServiceMonitor for Prometheus Operator
const serviceMonitorTemplate = `apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: <%service.name%>
  namespace: <%project.namespace%>
  labels:
    release: prometheus
    app: <%service.name%>
spec:
  selector:
    matchLabels:
      app: <%service.name%>
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
      scrapeTimeout: 10s
  namespaceSelector:
    matchNames:
      - <%project.namespace%>
---
# Requires: Prometheus Operator (kube-prometheus-stack) installed in cluster
# The ServiceMonitor CRD must be available
# Scrapes /metrics endpoint on the service's http port
`;

// KEDA ScaledObject for event-driven autoscaling
const kedaScaledObjectTemplate = `apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: <%service.name%>-keda
  namespace: <%project.namespace%>
spec:
  scaleTargetRef:
    name: <%service.name%>
  pollingInterval: 15
  cooldownPeriod: 300
  minReplicaCount: <%service.scaling.minReplicas%><%^service.scaling%>1<%/service.scaling%>
  maxReplicaCount: <%service.scaling.maxReplicas%><%^service.scaling%>10<%/service.scaling%>
  advanced:
    restoreToOriginalReplicaCount: false
    horizontalPodAutoscalerConfig:
      behavior:
        scaleDown:
          stabilizationWindowSeconds: 300
          policies:
            - type: Percent
              value: 10
              periodSeconds: 60
        scaleUp:
          stabilizationWindowSeconds: 0
          policies:
            - type: Percent
              value: 100
              periodSeconds: 15
            - type: Pods
              value: 4
              periodSeconds: 15
          selectPolicy: Max
  triggers:
    - type: cpu
      metadata:
        type: Utilization
        value: "<%service.scaling.targetCPUUtilization%><%^service.scaling.targetCPUUtilization%>70<%/service.scaling.targetCPUUtilization%>"
    - type: memory
      metadata:
        type: Utilization
        value: "<%service.scaling.targetMemoryUtilization%><%^service.scaling.targetMemoryUtilization%>80<%/service.scaling.targetMemoryUtilization%>"
---
# Requires: KEDA installed in cluster (kubectl apply -f https://github.com/kedacore/keda/releases/download/v2.14.0/keda-2.14.0.yaml)
# Supports: CPU, Memory, Kafka, RabbitMQ, Azure Queue, AWS SQS, GCP Pub/Sub, and 60+ scalers
# Add custom triggers by editing this file (e.g., Kafka lag, HTTP requests, cron)
`;

// Docker Swarm stack
const dockerSwarmTemplate = `version: '3.9'

services:
<%#services%>
  <%name%>:
    build:
      context: ./services/<%name%>
      dockerfile: Dockerfile
    image: <%project.github.owner%>/<%project.name%>-<%name%>:latest
    deploy:
      replicas: <%service.scaling.minReplicas%><%^service.scaling%>1<%/service.scaling%>
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.1'
          memory: 128M
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
      placement:
        constraints:
          - node.role == worker
    ports:
      - target: <%port%>
        published: <%port%>
        protocol: tcp
        mode: ingress
    environment:
      - NODE_ENV=production
      - PORT=<%port%>
<%#dependencies%>
      - SERVICE_DEPENDENCIES=<%#.%>
<%{this}%>
<%/.%>
<%/dependencies%>
<%#env%>
<%#.%>
      - <%{key}%>=<%{value}%>
<%/.%>
<%/env%>
<%#healthCheck%>
<%#healthCheck.path%>
    healthcheck:
      test: [\"CMD\", \"curl\", \"-f\", \"http://localhost:<%port%><%{healthCheck.path}%>\"]
      interval: \"<%healthCheck.interval%>\"
      timeout: \"<%healthCheck.timeout%>\"
      retries: <%healthCheck.retries%>
<%/healthCheck.path%>
<%/healthCheck%>
    networks:
      - devforge-network
<%/services%>
<%#databases%>
  <%name%>:
    image: <%{type}%>:<%{version}%>
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
      placement:
        constraints:
          - node.role == manager
    environment:
<%#.%>
    <%/.%>
<%#size%>
      - POSTGRES_SIZE=<%size%>
<%/size%>
    ports:
      - target: <%port%>
        published: <%port%>
        protocol: tcp
    volumes:
      - <%name%>-data:/var/lib/<%type%>
    networks:
      - devforge-network
<%/databases%>
volumes:
<%#databases%>
  <%name%>-data:
<%/databases%>

networks:
  devforge-network:
    driver: overlay
    attachable: true
`;

export const templates = {
  'docker-compose': dockerComposeTemplate,
  'k8s-deployment': k8sDeploymentTemplate,
  'k8s-service': k8sServiceTemplate,
  'k8s-hpa': k8sHPATemplate,
  'k8s-ingress': k8sIngressTemplate,
  'k8s-configmap': k8sConfigMapTemplate,
  'k8s-secret': k8sSecretTemplate,
  'dockerfile-node': dockerfileNode,
  'dockerfile-python': dockerfilePython,
  'dockerfile-go': dockerfileGo,
  'dockerfile-rust': dockerfileRust,
  'dockerfile-java': dockerfileJava,
  'github-actions': githubActionsTemplate,
  'prometheus-cm': prometheusConfigMapTemplate,
  'service-readme': serviceReadmeTemplate,
  'nginx-conf': nginxConfTemplate,
  'Makefile': makefileTemplate,
  'k8s-pdb': k8sPDBTemplate,
  'k8s-networkpolicy': k8sNetworkPolicyTemplate,
  'k8s-networkpolicy-strict': k8sNetworkPolicyStrictTemplate,
  'k8s-netpol-default-deny': k8sNetPolDefaultDenyTemplate,
  'helm-chart': helmChartTemplate,
  'helm-deployment': helmChartDeploymentTemplate,
  'helm-service': helmChartServiceTemplate,
  'helm-values': helmValuesTemplate,
  'helm-notes': helmChartNOTES,
  'grafana-dashboard': grafanaDashboardTemplate,
  'grafana-datasource': grafanaDatasourceTemplate,
  'grafana-dashboard-provider': grafanaDashboardProviderTemplate,
  'terraform-aws': terraformAWSMainTemplate,
  'vercel': vercelTemplate,
  'fly': flyTemplate,
  'railway': railwayTemplate,
  'render': renderPlatformTemplate,
  'cloudflare-workers': cloudflareWorkersTemplate,
  'opentelemetry-node': opentelemetryNodeTemplate,
  'opentelemetry-python': opentelemetryPythonTemplate,
  'opentelemetry-go': opentelemetryGoTemplate,
  'opentelemetry-rust': opentelemetryRustTemplate,
  'opentelemetry-java': opentelemetryJavaTemplate,
  'docker-swarm': dockerSwarmTemplate,
  'argocd-application': argocdApplicationTemplate,
  'service-monitor': serviceMonitorTemplate,
  'keda-scaledobject': kedaScaledObjectTemplate,
  'grpc-proto': grpcProtoTemplate,
  'grpc-node-service': grpcNodeServiceTemplate,
  'grpc-go-service': grpcGoServiceTemplate,
  'grpc-dockerfile-node': grpcDockerfileNodeTemplate,
  'grpc-dockerfile-go': grpcDockerfileGoTemplate,
  'grpc-node-package-json': grpcNodePackageJson,
  'grpc-go-mod': grpcGoModTemplate,
  'grpc-readme': grpcReadmeTemplate,
};
