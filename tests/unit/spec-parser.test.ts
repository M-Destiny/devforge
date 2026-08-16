import { describe, it, expect } from 'vitest';
import { parseSpec, validateSpec, validateKubernetesName } from '../../src/spec-parser.js';

describe('parseSpec', () => {
  it('parses valid YAML spec', () => {
    const yaml = `
name: test-project
namespace: default
services:
  - name: api
    language: node
    port: 3000
`;
    const spec = parseSpec(yaml);
    expect(spec.name).toBe('test-project');
    expect(spec.namespace).toBe('default');
    expect(spec.services).toHaveLength(1);
    expect(spec.services[0].name).toBe('api');
  });

  it('parses spec with databases', () => {
    const yaml = `
name: test-project
namespace: default
services:
  - name: api
    language: python
    port: 8000
databases:
  - name: postgres
    type: postgres
    version: "15"
    port: 5432
`;
    const spec = parseSpec(yaml);
    expect(spec.databases).toHaveLength(1);
    expect(spec.databases![0].name).toBe('postgres');
  });

  it('parses spec with ingress', () => {
    const yaml = `
name: test-project
namespace: default
services:
  - name: api
    language: go
    port: 8080
ingress:
  enabled: true
  rules:
    - host: api.example.com
      path: /
      service: api
      servicePort: 8080
`;
    const spec = parseSpec(yaml);
    expect(spec.ingress?.enabled).toBe(true);
    expect(spec.ingress?.rules).toHaveLength(1);
  });

  it('rejects invalid YAML syntax', () => {
    const yaml = `
name: [invalid
`;
    expect(() => parseSpec(yaml)).toThrow();
  });

  it('rejects spec with missing required fields', () => {
    const yaml = `
name: test-project
namespace: default
services:
  - name: api
`;
    expect(() => parseSpec(yaml)).toThrow();
  });

  it('rejects spec with invalid language', () => {
    const yaml = `
name: test-project
namespace: default
services:
  - name: api
    language: ruby
    port: 3000
`;
    expect(() => parseSpec(yaml)).toThrow();
  });

  it('rejects spec with port out of range', () => {
    const yaml = `
name: test-project
namespace: default
services:
  - name: api
    language: node
    port: 70000
`;
    expect(() => parseSpec(yaml)).toThrow();
  });
});

describe('validateSpec', () => {
  it('validates spec with no conflicts', () => {
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [
        { name: 'api', language: 'node' as const, port: 3000 },
        { name: 'auth', language: 'node' as const, port: 3001 },
      ],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects port conflicts', () => {
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [
        { name: 'api', language: 'node' as const, port: 3000 },
        { name: 'auth', language: 'node' as const, port: 3000 },
      ],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Port 3000 conflict'))).toBe(true);
  });

  it('detects circular dependencies', () => {
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [
        { name: 'api', language: 'node' as const, port: 3000, dependencies: ['auth'] },
        { name: 'auth', language: 'node' as const, port: 3001, dependencies: ['api'] },
      ],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Circular dependencies'))).toBe(true);
  });

  it('detects unknown service dependencies', () => {
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [
        { name: 'api', language: 'node' as const, port: 3000, dependencies: ['unknown-service'] },
      ],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('unknown service'))).toBe(true);
  });

  it('validates scaling range', () => {
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [
        {
          name: 'api',
          language: 'node' as const,
          port: 3000,
          scaling: { minReplicas: 10, maxReplicas: 5 },
        },
      ],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('minReplicas > maxReplicas'))).toBe(true);
  });

  it('validates database port conflicts', () => {
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [
        { name: 'api', language: 'node' as const, port: 5432 },
      ],
      databases: [
        { name: 'postgres', type: 'postgres' as const, version: '15', port: 5432 },
      ],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
  });

  it('rejects project names that violate Kubernetes DNS-1123 label rules', () => {
    // Without this guard, `devforge init` would happily emit manifests that
    // `kubectl apply` rejects at apply-time.
    const spec = {
      name: 'Test_Project',
      namespace: 'default',
      services: [{ name: 'api', language: 'node' as const, port: 3000 }],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Project') && e.includes('DNS-1123'))).toBe(true);
  });

  it('rejects service names with uppercase letters or underscores', () => {
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [
        { name: 'Auth_Service', language: 'node' as const, port: 3001 },
      ],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Auth_Service') && e.includes('DNS-1123'))).toBe(true);
  });

  it('rejects names longer than 63 characters', () => {
    const longName = 'a'.repeat(64);
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [{ name: longName, language: 'node' as const, port: 3000 }],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('63'))).toBe(true);
  });

  it('rejects names with leading or trailing hyphens', () => {
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [{ name: '-api-', language: 'node' as const, port: 3000 }],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
  });

  it('accepts valid DNS-1123 names', () => {
    const spec = {
      name: 'test-project',
      namespace: 'production',
      services: [
        { name: 'api-gateway', language: 'node' as const, port: 3000 },
        { name: 'auth-service-v2', language: 'python' as const, port: 8000 },
      ],
      databases: [{ name: 'postgres-main', type: 'postgres' as const, version: '15' }],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid database names', () => {
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [{ name: 'api', language: 'node' as const, port: 3000 }],
      databases: [{ name: 'Postgres_DB', type: 'postgres' as const, version: '15' }],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Postgres_DB') && e.includes('Database'))).toBe(true);
  });

  it('rejects invalid namespace names', () => {
    const spec = {
      name: 'test-project',
      namespace: 'Prod_Namespace',
      services: [{ name: 'api', language: 'node' as const, port: 3000 }],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Namespace') && e.includes('DNS-1123'))).toBe(true);
  });

  it('rejects duplicate service names (would collide on k8s label selectors)', () => {
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [
        { name: 'api', language: 'node' as const, port: 3000 },
        { name: 'api', language: 'python' as const, port: 3001 },
      ],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Duplicate service name'))).toBe(true);
  });

  it('rejects duplicate database names', () => {
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [{ name: 'api', language: 'node' as const, port: 3000 }],
      databases: [
        { name: 'postgres', type: 'postgres' as const, version: '15' },
        { name: 'postgres', type: 'postgres' as const, version: '16' },
      ],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Duplicate database name'))).toBe(true);
  });

  it('rejects when a service and database share a name (label-selector collision)', () => {
    // Both the service Deployment and the database Deployment emit
    // `app: redis` as their pod label. NetworkPolicy ingress selectors,
    // Prometheus relabel_configs, and HPA scaleTargetRefs all key off
    // `app:` — so a `redis` service and a `redis` database would route to
    // each other's pods.
    const spec = {
      name: 'test-project',
      namespace: 'default',
      services: [{ name: 'redis', language: 'node' as const, port: 6379 }],
      databases: [{ name: 'redis', type: 'redis' as const, version: '7' }],
    };
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        e => e.includes('redis') && e.includes('service and a database')
      )
    ).toBe(true);
  });
});

describe('validateKubernetesName', () => {
  it('returns null for valid DNS-1123 names', () => {
    expect(validateKubernetesName('api', 'Service')).toBeNull();
    expect(validateKubernetesName('api-gateway', 'Service')).toBeNull();
    expect(validateKubernetesName('auth-service-v2', 'Service')).toBeNull();
    expect(validateKubernetesName('a', 'Service')).toBeNull();
    expect(validateKubernetesName('a1b2c3', 'Service')).toBeNull();
  });

  it('returns an error for empty strings', () => {
    expect(validateKubernetesName('', 'Service')).toMatch(/must not be empty/);
  });

  it('returns an error for names longer than 63 chars', () => {
    const long = 'a'.repeat(64);
    const result = validateKubernetesName(long, 'Service');
    expect(result).toMatch(/63/);
  });

  it('accepts names exactly 63 chars long', () => {
    const exact = 'a'.repeat(63);
    expect(validateKubernetesName(exact, 'Service')).toBeNull();
  });

  it('rejects uppercase letters', () => {
    expect(validateKubernetesName('Api', 'Service')).toMatch(/DNS-1123/);
    expect(validateKubernetesName('AUTH', 'Service')).toMatch(/DNS-1123/);
  });

  it('rejects underscores and other non-alphanumeric chars', () => {
    expect(validateKubernetesName('api_service', 'Service')).toMatch(/DNS-1123/);
    expect(validateKubernetesName('api.service', 'Service')).toMatch(/DNS-1123/);
    expect(validateKubernetesName('api/service', 'Service')).toMatch(/DNS-1123/);
  });

  it('rejects names starting or ending with a hyphen', () => {
    expect(validateKubernetesName('-api', 'Service')).toMatch(/DNS-1123/);
    expect(validateKubernetesName('api-', 'Service')).toMatch(/DNS-1123/);
  });

  it('rejects names that are only a hyphen', () => {
    expect(validateKubernetesName('-', 'Service')).toMatch(/DNS-1123/);
  });
});
