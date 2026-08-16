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

RUN apt-get update && apt-get install -y --no-install-recommends \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

<%#env%>
<%#.%>
ENV <%{key}%>=<%{value}%>
<%/.%>
<%/env%>

EXPOSE <%{port}%>
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
CMD ["node", "dist/index.js"]
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

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
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
HEALTHCHECK --interval=<%{interval}%> --timeout=<%{timeout}%> --retries=<%{retries}%> \
  CMD curl -f http://localhost:<%{port}%><%{path}%> || exit 1
<%/path%>
<%/healthCheck%>

USER appuser
CMD ["/app/bin/server"]
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
      containers:
        - name: <%service.name%>
          image: <%service.image%><%^service.image%>docker.io/<%project.github.owner%>/<%project.name%>-<%service.name%>:latest<%/service.image%>
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: <%service.port%>
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
  'k8s-deployment': {
    description: 'Kubernetes Deployment with probes, resource limits, and env from spec.',
    category: 'kubernetes',
    perService: true,
    outputPath: 'k8s/services/<name>/deployment.yaml',
  },
  'k8s-service': {
    description: 'Kubernetes Service (ClusterIP) exposing the service port.',
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
  const variableTag = /<%([\^/!{#]|\.[^%]*)?\s*([A-Za-z0-9_.]+)\s*%>/g;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = variableTag.exec(template)) !== null) {
    names.add(m[2]);
  }
  return Array.from(names).sort();
}
// PodDisruptionBudget (k8s-pdb)
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

export const templates = {
  'docker-compose': dockerComposeTemplate,
  'k8s-deployment': k8sDeploymentTemplate,
  'k8s-service': k8sServiceTemplate,
  'k8s-hpa': k8sHPATemplate,
  'k8s-ingress': k8sIngressTemplate,
  'k8s-configmap': k8sConfigMapTemplate,
  'dockerfile-node': dockerfileNode,
  'dockerfile-python': dockerfilePython,
  'dockerfile-go': dockerfileGo,
  'dockerfile-rust': dockerfileRust,
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
};
