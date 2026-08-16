# auth-service

## Overview

Service: **auth-service**
Language: **rust**
Port: **3001**



## API Endpoints

### Health Check

```bash
GET /health
```

Returns service health status.

### Custom Health Path: /health

## Local Development

```bash
# Start service
docker-compose up auth-service

# View logs
docker-compose logs -f auth-service

# Run tests
cd services/auth-service
npm test
```

## Deployment

This service is deployed to Kubernetes with the following configuration:

- **Namespace**: production
- **Replicas**: 1 - 5
- **Health Check**: /health

## Docker

```bash
# Build
docker build -t auth-service ./services/auth-service

# Run
docker run -p 3001:3001 auth-service
```
