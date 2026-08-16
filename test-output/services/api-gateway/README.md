# api-gateway

## Overview

Service: **api-gateway**
Language: **go**
Port: **8080**

## Dependencies

- 


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
docker-compose up api-gateway

# View logs
docker-compose logs -f api-gateway

# Run tests
cd services/api-gateway
npm test
```

## Deployment

This service is deployed to Kubernetes with the following configuration:

- **Namespace**: production
- **Replicas**: 2 - 10
- **Health Check**: /health

## Docker

```bash
# Build
docker build -t api-gateway ./services/api-gateway

# Run
docker run -p 8080:8080 api-gateway
```
