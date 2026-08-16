# user-service

## Overview

Service: **user-service**
Language: **java**
Port: **8081**

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
docker-compose up user-service

# View logs
docker-compose logs -f user-service

# Run tests
cd services/user-service
npm test
```

## Deployment

This service is deployed to Kubernetes with the following configuration:

- **Namespace**: production
- **Replicas**: 2 - 8
- **Health Check**: /health

## Docker

```bash
# Build
docker build -t user-service ./services/user-service

# Run
docker run -p 8081:8081 user-service
```
