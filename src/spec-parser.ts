import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { ProjectSpec, ServiceSpec } from './types.js';

// Zod schemas
const HealthCheckSchema = z.object({
  path: z.string().optional(),
  port: z.number().optional(),
  interval: z.string().optional(),
  timeout: z.string().optional(),
  retries: z.number().optional(),
});

const ScalingSchema = z.object({
  minReplicas: z.number().min(1).optional(),
  maxReplicas: z.number().min(1).optional(),
  targetCPUUtilization: z.number().min(1).max(100).optional(),
  targetMemoryUtilization: z.number().min(1).max(100).optional(),
});

const ServiceSpecSchema = z.object({
  name: z.string().min(1),
  language: z.enum(['node', 'python', 'go', 'rust', 'java']),
  port: z.number().min(1).max(65535),
  dependencies: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  healthCheck: HealthCheckSchema.optional(),
  scaling: ScalingSchema.optional(),
  image: z.string().optional(),
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
});

const DatabaseSpecSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch']),
  version: z.string().min(1),
  size: z.string().optional(),
  port: z.number().min(1).max(65535).optional(),
});

const IngressRuleSchema = z.object({
  host: z.string(),
  path: z.string(),
  service: z.string(),
  servicePort: z.number(),
});

const IngressTLSSchema = z.object({
  hosts: z.array(z.string()),
  secretName: z.string(),
});

const IngressSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(IngressRuleSchema).optional(),
  tls: z.array(IngressTLSSchema).optional(),
});

const GithubSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().optional(),
});

const ProjectSpecSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().min(1),
  services: z.array(ServiceSpecSchema).min(1),
  databases: z.array(DatabaseSpecSchema).optional(),
  ingress: IngressSchema.optional(),
  github: GithubSchema.optional(),
});

export function parseSpec(yamlContent: string): ProjectSpec {
  const raw = parseYaml(yamlContent);
  const result = ProjectSpecSchema.safeParse(raw);

  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
    throw new Error(`Invalid spec: ${errors.join('; ')}`);
  }

  return result.data as ProjectSpec;
}

/**
 * Validates a string against the Kubernetes DNS-1123 label rules that apply
 * to most resource names (Deployment, Service, ConfigMap, Ingress, etc.).
 *
 *   - max 63 characters
 *   - lowercase alphanumeric and `-`
 *   - must start and end with an alphanumeric character
 *
 * We deliberately reject names that pass the Zod `.min(1)` check but will
 * cause `kubectl apply` to reject the generated manifest — catching the
 * problem at validation time is much friendlier than debugging it after a
 * failed rollout.
 */
export function validateKubernetesName(
  value: string,
  kind: string
): string | null {
  if (value.length === 0) return `${kind} name must not be empty`;
  if (value.length > 63) return `${kind} name "${value}" is ${value.length} chars; Kubernetes DNS-1123 labels allow at most 63`;
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value)) {
    return `${kind} name "${value}" is not a valid Kubernetes DNS-1123 label (use lowercase letters, digits, and '-' only; must start and end with a letter or digit)`;
  }
  return null;
}

export function validateSpec(spec: ProjectSpec): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate Kubernetes-safe names for every resource that ends up in a
  // `metadata.name` field. Without this, `devforge init` happily produces
  // manifests that `kubectl apply` refuses to accept.
  const projectNameErr = validateKubernetesName(spec.name, 'Project');
  if (projectNameErr) errors.push(projectNameErr);
  const namespaceErr = validateKubernetesName(spec.namespace, 'Namespace');
  if (namespaceErr) errors.push(namespaceErr);

  for (const service of spec.services) {
    const err = validateKubernetesName(service.name, `Service "${service.name}"`);
    if (err) errors.push(err);
  }

  if (spec.databases) {
    for (const db of spec.databases) {
      const err = validateKubernetesName(db.name, `Database "${db.name}"`);
      if (err) errors.push(err);
    }
  }

  // Catch duplicate service names. Two services with the same name produce
  // identical k8s label selectors (`app: <name>`), so a Service for the
  // second one would silently route to the first one's pods. The Zod schema
  // allows duplicates; we have to detect them ourselves.
  const serviceNames = new Set<string>();
  for (const service of spec.services) {
    if (serviceNames.has(service.name)) {
      errors.push(`Duplicate service name "${service.name}" — service names must be unique (they become k8s label selectors)`);
    }
    serviceNames.add(service.name);
  }

  // Catch duplicate database names for the same reason: a Deployment, PVC,
  // and Service are all emitted under the database name.
  if (spec.databases) {
    const dbNames = new Set<string>();
    for (const db of spec.databases) {
      if (dbNames.has(db.name)) {
        errors.push(`Duplicate database name "${db.name}" — database names must be unique`);
      }
      dbNames.add(db.name);
    }

    // Cross-namespace collisions: a service and database sharing a name will
    // collide on the `app:` label selector that NetworkPolicy, Prometheus
    // relabel_configs, and the HPA scaleTargetRef all use.
    for (const db of spec.databases) {
      if (serviceNames.has(db.name)) {
        errors.push(`Name "${db.name}" is used by both a service and a database — these would collide on the "app:" label selector in NetworkPolicy / Prometheus scrape configs`);
      }
    }
  }

  // Check port conflicts
  const ports = new Map<number, string>();
  for (const service of spec.services) {
    if (ports.has(service.port)) {
      errors.push(`Port ${service.port} conflict: ${service.name} and ${ports.get(service.port)}`);
    } else {
      ports.set(service.port, service.name);
    }
  }

  // Check database port conflicts
  if (spec.databases) {
    for (const db of spec.databases) {
      if (db.port && ports.has(db.port)) {
        errors.push(`Database port ${db.port} conflict with service using same port`);
      }
      if (db.port) ports.set(db.port, `db:${db.name}`);
    }
  }
  for (const service of spec.services) {
    if (service.dependencies) {
      for (const dep of service.dependencies) {
        if (!serviceNames.has(dep)) {
          errors.push(`Service ${service.name} depends on unknown service: ${dep}`);
        }
      }
    }
  }

  // Check circular dependencies
  const circularDeps = findCircularDependencies(spec.services);
  if (circularDeps.length > 0) {
    errors.push(`Circular dependencies detected: ${circularDeps.join(' -> ')}`);
  }

  // Check scaling ranges
  for (const service of spec.services) {
    if (service.scaling) {
      if (
        service.scaling.minReplicas !== undefined &&
        service.scaling.maxReplicas !== undefined &&
        service.scaling.minReplicas > service.scaling.maxReplicas
      ) {
        errors.push(`Service ${service.name}: minReplicas > maxReplicas`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function findCircularDependencies(services: ServiceSpec[]): string[] {
  const graph = new Map<string, string[]>();

  for (const service of services) {
    graph.set(service.name, service.dependencies || []);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        path.push(neighbor);
        return true;
      }
    }

    path.pop();
    recursionStack.delete(node);
    return false;
  }

  for (const service of services) {
    if (!visited.has(service.name)) {
      if (dfs(service.name)) {
        return path;
      }
    }
  }

  return [];
}
