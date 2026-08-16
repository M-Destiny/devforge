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
});
