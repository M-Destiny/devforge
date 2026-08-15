# ⚒️ DevForge

> AI-powered full-stack scaffolding CLI — write a YAML spec, generate production microservices with Docker, Kubernetes, and GitHub Actions.

```
┌─────────────────────────────────────────────────────────────┐
│                      DEVFORGE                                │
│                                                              │
│  spec.yaml ──▶ ProjectGenerator ──▶ Output Directory         │
│                    │                                         │
│                    ├── docker-compose.yml                     │
│                    ├── k8s/ (Deployment, Service, HPA, ...)  │
│                    ├── .github/workflows/deploy.yml           │
│                    ├── Dockerfile (multi-stage)               │
│                    └── Makefile                              │
└─────────────────────────────────────────────────────────────┘
```

## Features

| Feature | Description |
|---|---|
| **YAML-Driven** | Single spec file generates entire project structure |
| **Multi-language** | TypeScript, Python, Go, Rust service templates |
| **Database Support** | PostgreSQL, MySQL, MongoDB, Redis with health checks |
| **Auto-scaling** | Kubernetes HPA with configurable CPU/memory targets |
| **CI/CD** | GitHub Actions matrix builds + kubectl deploy |
| **Observability** | Prometheus scrape config + Grafana dashboard |
| **Networking** | Kubernetes NetworkPolicy + Ingress with TLS |
| **Local Dev** | Docker Compose with hot-reload + health checks |
| **Dry-run Mode** | Preview all generated files before writing |

## Quick Start

```bash
npm install -g devforge
devforge init spec.yaml
```

Or create a spec from scratch:

```bash
devforge scaffold my-platform --lang typescript --db postgres
```

## Example Spec

```yaml
name: my-platform
namespace: production
services:
  - name: api-gateway
    language: typescript
    port: 8080
    dependencies: [auth-service, user-service]
    healthCheck: { path: /health, interval: 30 }
    scaling: { min: 2, max: 10, targetCPU: 70 }
  - name: auth-service
    language: typescript
    port: 3001
    dependencies: [postgres]
databases:
  - name: postgres
    type: postgres
    version: '16'
ingress:
  host: api.myplatform.io
  tls: true
```

## Available Templates

```
docker-compose      PostgreSQL/MySQL/MongoDB + services + health checks
k8s-deployment     Deployment + Service + HPA + PodDisruptionBudget
k8s-ingress        Ingress with TLS + cert-manager
k8s-configmap      Per-service ConfigMap for env vars
k8s-secret         Kubernetes Secret for credentials
dockerfile-node    Multi-stage Node.js Dockerfile
dockerfile-python  Multi-stage Python Dockerfile with uv
github-actions     Build → Test → Push → Helm deploy workflow
prometheus-cm      Prometheus scrape config per service
service-readme     Per-service API documentation
nginx-conf         Reverse proxy config
Makefile           make up / down / logs / test
```

## CLI Commands

```bash
devforge init <spec.yaml>          # Parse spec and generate project
devforge validate <spec.yaml>       # Validate spec without generating
devforge list-templates            # Show available templates
devforge scaffold <name>           # Interactive spec creation + generation
```

## Generated Output Structure

```
output/
├── docker-compose.yml
├── Dockerfile
├── k8s/
│   ├── api-gateway/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── hpa.yaml
│   │   └── configmap.yaml
│   └── auth-service/
│       └── ...
├── .github/
│   └── workflows/
│       └── deploy.yml
├── Makefile
└── README.md
```

## Deploy

| Platform | Command |
|---|---|
| **Vercel** | `vercel --prod` |
| **Fly.io** | `fly launch && fly deploy` |
| **Railway** | Connect repo → auto-deploy |
| **Render** | `render.yaml` → Blueprint |

## License

MIT — M-Destiny
