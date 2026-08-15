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

RUN apt-get update && apt-get install -y --no-install-recommends \\
    curl \\
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
HEALTHCHECK --interval=<%{interval}%> --timeout=<%{timeout}%> --retries=<%{retries}%> \\
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

export function listTemplates(): string[] {
  return Object.keys(templates);
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

// Registry of all templates — placed after every const declaration to avoid
// TDZ (temporal dead zone) forward references to k8s/helm templates below.
export const templates = {
  'docker-compose': dockerComposeTemplate,
  'k8s-deployment': k8sDeploymentTemplate,
  'k8s-service': k8sServiceTemplate,
  'k8s-hpa': k8sHPATemplate,
  'k8s-ingress': k8sIngressTemplate,
  'k8s-configmap': k8sConfigMapTemplate,
  'dockerfile-node': dockerfileNode,
  'dockerfile-python': dockerfilePython,
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
};
