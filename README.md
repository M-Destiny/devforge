# DevForge

**AI-powered scaffolding CLI for microservices**

DevForge generates production-ready microservices infrastructure from declarative YAML specs. Define your services, databases, scaling rules, and ingress once — get Docker Compose, Kubernetes manifests, GitHub Actions CI/CD, and more.

## Features

- **Multi-language support**: Node.js, Python, Go, Rust, Java
- **Docker Compose**: Local development with health checks, networking, volumes
- **Kubernetes**: Deployment, Service, HPA, ConfigMap, Ingress manifests
- **CI/CD**: GitHub Actions workflows for building, testing, and deploying
- **Service Discovery**: Automatic dependency resolution and health checks
- **Horizontal Pod Autoscaling**: CPU/memory based HPA configuration
- **Prometheus Monitoring**: Pre-configured scrape configs
- **Nginx Reverse Proxy**: Load balancing configuration

## Quick Start

### Installation

```bash
npm install -g devforge
```

Or use npx without installing:

```bash
npx devforge@latest init examples/microservice-spec.yaml
```

### Initialize a Project

```bash
devforge init examples/microservice-spec.yaml -o my-platform
cd my-platform
make up
```

### Validate a Spec

```bash
devforge validate examples/microservice-spec.yaml
```

### Interactive Scaffold

```bash
devforge scaffold my-new-service
```

### List Available Templates

```bash
devforge list-templates
```

## How It Works

1. **Write a spec** in YAML describing your services, databases, scaling, and ingress
2. **Run `devforge init`** to generate all infrastructure files
3. **Deploy** with Docker Compose locally or Kubernetes in production

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      DevForge CLI                           │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐  │
│  │  Init   │  │ Validate │  │  Scaffold │  │   List     │  │
│  └────┬────┘  └────┬─────┘  └─────┬─────┘  └─────┬──────┘  │
└───────┼───────────┼──────────────┼──────────────┼──────────┘
        │           │              │              │
        ▼           ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Template Engine                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Mustache Templates: Docker, K8s, GitHub Actions, etc │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Generated Output                         │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │   Docker    │  │   K8s       │  │  GitHub Actions  │    │
│  │  Compose    │  │  Manifests  │  │    Workflows    │    │
│  └─────────────┘  └─────────────┘  └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Example Spec

```yaml
name: my-platform
namespace: production
services:
  - name: api-gateway
    language: node
    port: 3000
    dependencies:
      - auth-service
    healthCheck:
      path: /health
      interval: 30s
      timeout: 10s
      retries: 3
    scaling:
      minReplicas: 2
      maxReplicas: 10
      targetCPUUtilization: 70

  - name: auth-service
    language: node
    port: 3001
    scaling:
      minReplicas: 2
      maxReplicas: 8

databases:
  - name: postgres
    type: postgres
    version: "15"
    size: 10Gi
    port: 5432

ingress:
  enabled: true
  rules:
    - host: api.example.com
      path: /
      service: api-gateway
      servicePort: 3000

github:
  owner: my-org
  repo: my-platform
```

## Generated Files

```
output/
├── docker-compose.yml
├── Makefile
├── nginx.conf
├── k8s/
│   ├── services/
│   │   ├── api-gateway/
│   │   │   ├── deployment.yaml
│   │   │   ├── service.yaml
│   │   │   ├── hpa.yaml
│   │   │   └── configmap.yaml
│   │   └── auth-service/
│   │       └── ...
│   ├── databases/
│   │   └── postgres.yaml
│   ├── ingress.yaml
│   └── monitoring/
│       └── prometheus-configmap.yaml
├── .github/
│   └── workflows/
│       └── deploy.yml
└── services/
    ├── api-gateway/
    │   ├── Dockerfile
    │   └── README.md
    └── auth-service/
        └── ...
```

## Template Reference

| Template | Description |
|----------|-------------|
| `docker-compose` | Multi-service Docker Compose with health checks |
| `k8s-deployment` | Kubernetes Deployment manifest |
| `k8s-service` | Kubernetes Service (ClusterIP) |
| `k8s-hpa` | Horizontal Pod Autoscaler |
| `k8s-ingress` | Kubernetes Ingress with TLS |
| `k8s-configmap` | ConfigMap for environment variables |
| `dockerfile-node` | Multi-stage Node.js Dockerfile |
| `dockerfile-python` | Multi-stage Python Dockerfile with uv |
| `github-actions` | CI/CD pipeline: build, test, push, deploy |
| `prometheus-cm` | Prometheus scrape configuration |
| `service-readme` | Per-service documentation |
| `nginx-conf` | Nginx reverse proxy config |
| `Makefile` | Local development commands |

## Deployment Guide

### Local Development (Docker Compose)

```bash
make up          # Start all services
make logs        # View logs
make down        # Stop all services
make clean       # Remove containers and volumes
```

### Kubernetes

1. Apply the manifests:
```bash
kubectl apply -f k8s/services/
kubectl apply -f k8s/databases/
kubectl apply -f k8s/ingress.yaml
```

2. Check rollout status:
```bash
kubectl rollout status deployment -n <namespace>
```

### GitHub Actions

Push to `main` triggers:
1. Docker build for each service
2. Push to container registry
3. Deploy to Kubernetes cluster

Set `KUBE_CONFIG` secret in GitHub repo.

## CLI Commands

| Command | Description |
|---------|-------------|
| `init <spec.yaml>` | Generate project from spec file |
| `validate <spec.yaml>` | Validate spec without generating |
| `list-templates` | Show available templates |
| `scaffold <name>` | Interactive project creation |

## Development

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Run tests
npm test

# Build
npm run build

# Link for local testing
npm link
```

## License

MIT
