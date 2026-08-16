.PHONY: up down logs ps build clean test lint help

COMPOSE_FILE := docker-compose.yml
PROJECT_NAME := test-platform

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

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
	@echo "Testing api-gateway..."
	-cd services/api-gateway && npm test
	@echo "Testing auth-service..."
	-cd services/auth-service && npm test

lint: ## Run linters
	@echo "Linting api-gateway..."
	-cd services/api-gateway && npm run lint
	@echo "Linting auth-service..."
	-cd services/auth-service && npm run lint

logs-api-gateway: ## View logs for api-gateway
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) logs -f api-gateway

restart-api-gateway: ## Restart api-gateway
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) restart api-gateway

logs-auth-service: ## View logs for auth-service
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) logs -f auth-service

restart-auth-service: ## Restart auth-service
	docker-compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME) restart auth-service

