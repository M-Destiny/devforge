export interface HealthCheck {
  path?: string;
  port?: number;
  interval?: string;
  timeout?: string;
  retries?: number;
}

export interface ResourceRequirements {
  requests?: {
    cpu?: string;
    memory?: string;
  };
  limits?: {
    cpu?: string;
    memory?: string;
  };
}

export interface Scaling {
  minReplicas?: number;
  maxReplicas?: number;
  targetCPUUtilization?: number;
  targetMemoryUtilization?: number;
}

export interface ServiceSpec {
  name: string;
  language: 'node' | 'python' | 'go' | 'rust' | 'java';
  protocol?: 'http' | 'grpc';
  port: number;
  dependencies?: string[];
  env?: Record<string, string>;
  healthCheck?: HealthCheck;
  scaling?: Scaling;
  resources?: ResourceRequirements;
  image?: string;
  command?: string[];
  args?: string[];
}

export interface DatabaseSpec {
  name: string;
  type: 'postgres' | 'mysql' | 'mongodb' | 'redis' | 'elasticsearch';
  version: string;
  size?: string;
  port?: number;
}

export interface IngressRule {
  host: string;
  path: string;
  service: string;
  servicePort: number;
}

export interface IngressTLS {
  hosts: string[];
  secretName: string;
}

export interface ProjectSpec {
  name: string;
  namespace: string;
  services: ServiceSpec[];
  databases?: DatabaseSpec[];
  ingress?: {
    enabled: boolean;
    rules?: IngressRule[];
    tls?: IngressTLS[];
  };
  github?: {
    owner: string;
    repo: string;
    branch?: string;
  };
  /** Optional framework identifier for platform configs (e.g. vercel, nextjs) */
  framework?: string;
  /** Optional region for platform configs (e.g. fly.io, vercel) */
  region?: string;
}

export interface IngressSpec {
  enabled: boolean;
  rules?: IngressRule[];
  tls?: IngressTLS[];
}

export interface TemplateContext {
  project: ProjectSpec;
  service: ServiceSpec;
  services: ServiceSpec[];
  allServices: ServiceSpec[];
  databases: DatabaseSpec[];
  allDatabases: DatabaseSpec[];
  generatedAt: string;
  ingress?: IngressSpec;
}

export interface GenerationResult {
  success: boolean;
  filesGenerated: string[];
  errors: string[];
  warnings: string[];
}
