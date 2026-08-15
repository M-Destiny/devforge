# DevForge — Specification

> **Spec Kit: graphify + ponytail development approach**

## 1. Concept & Vision

DevForge is a YAML-driven project scaffolding CLI that generates production-ready microservice architectures from a single spec file. Write your platform topology in YAML, get Docker Compose, Kubernetes manifests, GitHub Actions CI/CD, Makefiles, and Prometheus configs — fully generated, fully yours.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       DEVFORGE ARCHITECTURE                      │
│                                                                  │
│   spec.yaml ──▶ ProjectGenerator ──▶ Output Directory            │
│                      │                                           │
│                      ├── docker-compose.yml                      │
│                      ├── k8s/ (Deployment, Service, HPA, ...)   │
│                      │     ├── deployment.yaml                   │
│                      │     ├── service.yaml                       │
│                      │     ├── hpa.yaml                           │
│                      │     └── configmap.yaml                     │
│                      ├── .github/workflows/deploy.yml              │
│                      ├── Dockerfile (multi-stage)                  │
│                      ├── Makefile                                │
│                      └── prometheus-cm.yaml                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    GENERATOR DATA FLOW                           │
│                                                                  │
│  YAML Spec ──▶ SpecParser ──▶ Zod Validation ──▶ ProjectSpec    │
│                                           │                      │
│                                           ▼                      │
│                                    GenerationResult              │
│                                           │                      │
│              ┌────────────────────────────┼────────────────────┐ │
│              ▼            ▼              ▼            ▼        │ │
│         dockerfile    k8s/       github-actions   Makefile    │ │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20, TypeScript 5, ESM |
| CLI | Commander.js |
| Templating | Mustache |
| Config | js-yaml, Zod |
| Files | fs-extra, glob |
| Logging | Pino |

## 4. Core Modules

### `types.ts` — Data Models
```typescript
ServiceSpec { name, language, port, dependencies, env, healthCheck, scaling }
DatabaseSpec { name, type, version, size }
ProjectSpec { name, namespace, services, databases, ingress, github }
```

### `spec-parser.ts` — Parsing & Validation
- `parseSpec(yaml: string)` → `ProjectSpec` (Zod validated)
- `validateSpec(spec)` → `{ valid, errors[] }`
  - Circular dependency detection
  - Port conflict detection
  - Valid scaling ranges

### `templates.ts` — All Mustache Templates
- `docker-compose.yml` — services + databases + health
- `k8s-deployment.yaml` — Deployment + Service + HPA per service
- `k8s-ingress.yaml` — TLS ingress
- `k8s-configmap.yaml` — env vars per service
- `dockerfile-node` — multi-stage Node.js
- `dockerfile-python` — multi-stage Python + uv
- `github-actions.yml` — build → test → push → deploy
- `prometheus-cm.yaml` — scrape config
- `service-readme.md` — per-service docs
- `nginx.conf` — reverse proxy
- `Makefile` — up / down / logs / test

### `generator.ts` — ProjectGenerator
- `generate()` → writes all files to output dir
- `validate()` → pre-gen checks
- `renderTemplate(name, context)` → string

## 5. CLI Commands

```bash
devforge init <spec.yaml> [-o output-dir]   # Parse + generate
devforge validate <spec.yaml>               # Validate only
devforge list-templates                     # Show available templates
devforge scaffold <name>                    # Interactive prompts → spec → generate
```

## 6. Example Spec

```yaml
name: my-platform
namespace: production
services:
  - name: api-gateway
    language: typescript
    port: 8080
    dependencies: [auth-service]
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
github:
  repo: org/my-platform
  branch: main
```

## 7. Generated Output Structure

```
output/
├── docker-compose.yml
├── Dockerfile
├── Makefile
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
└── prometheus-cm.yaml
```

## 8. Deployment

| Platform | Config |
|---|---|---|
| Vercel | `vercel.json` |
| Fly.io | `fly.toml` |
| Railway | `railway.json` |
| Render | `render.yaml` |

## 9. Milestones

- [x] Phase 1: Core modules (parser, generator, templates)
- [x] Phase 2: CLI commands
- [x] Phase 3: README + deployment configs
- [ ] Phase 4: Full test coverage
- [ ] Phase 5: Additional language templates (Go, Rust)
- [ ] Phase 6: Interactive TUI wizard
