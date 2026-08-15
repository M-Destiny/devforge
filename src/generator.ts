import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type {
  ProjectSpec,
  ServiceSpec,
  DatabaseSpec,
  TemplateContext,
  GenerationResult,
} from './types.js';
import { renderTemplate } from './templates.js';
import { validateSpec } from './spec-parser.js';

export class ProjectGenerator {
  private spec: ProjectSpec;
  private outputDir: string;
  private filesGenerated: string[] = [];
  private errors: string[] = [];
  private warnings: string[] = [];

  constructor(spec: ProjectSpec, outputDir: string = './output') {
    this.spec = spec;
    this.outputDir = outputDir;
  }

  private getNodeVersion(): string {
    return '20-alpine';
  }

  private getPythonVersion(): string {
    return '3.12-slim';
  }

  private getPythonMajor(): string {
    return '3.12'.split('.')[0];
  }

  private async ensureDir(path: string): Promise<void> {
    try {
      await mkdir(path, { recursive: true });
    } catch {
      // ignore
    }
  }

  private buildContext(service: ServiceSpec): TemplateContext {
    return {
      project: this.spec,
      service,
      allServices: this.spec.services,
      allDatabases: this.spec.databases || [],
      generatedAt: new Date().toISOString(),
    };
  }

  validate(): string[] {
    const validation = validateSpec(this.spec);
    if (!validation.valid) {
      return validation.errors;
    }

    const errors: string[] = [];

    // Check for port conflicts
    const ports = new Map<number, string>();
    for (const service of this.spec.services) {
      if (ports.has(service.port)) {
        errors.push(`Port ${service.port} conflict: ${service.name} and ${ports.get(service.port)}`);
      }
      ports.set(service.port, service.name);
    }

    return errors;
  }

  async generate(): Promise<GenerationResult> {
    this.filesGenerated = [];
    this.errors = [];
    this.warnings = [];

    const validationErrors = this.validate();
    if (validationErrors.length > 0) {
      return {
        success: false,
        filesGenerated: [],
        errors: validationErrors,
        warnings: [],
      };
    }

    try {
      await this.ensureDir(this.outputDir);

      // Generate docker-compose.yml
      await this.generateDockerCompose();

      // Generate Makefile
      await this.generateMakefile();

      // Generate per-service files
      for (const service of this.spec.services) {
        await this.generateServiceFiles(service);
      }

      // Generate database files
      if (this.spec.databases) {
        await this.generateDatabaseFiles();
      }

      // Generate ingress
      if (this.spec.ingress?.enabled) {
        await this.generateIngress();
      }

      // Generate GitHub Actions
      await this.generateGitHubActions();

      // Generate Prometheus ConfigMap
      await this.generatePrometheusConfig();

      // Generate nginx config
      await this.generateNginxConfig();

      return {
        success: true,
        filesGenerated: this.filesGenerated,
        errors: this.errors,
        warnings: this.warnings,
      };
    } catch (err) {
      return {
        success: false,
        filesGenerated: this.filesGenerated,
        errors: [...this.errors, err instanceof Error ? err.message : String(err)],
        warnings: this.warnings,
      };
    }
  }

  private async generateDockerCompose(): Promise<void> {
    const context: TemplateContext = {
      project: this.spec,
      service: this.spec.services[0],
      allServices: this.spec.services,
      allDatabases: this.spec.databases || [],
      generatedAt: new Date().toISOString(),
    };

    const content = renderTemplate('docker-compose', context);
    const path = join(this.outputDir, 'docker-compose.yml');
    await writeFile(path, content, 'utf-8');
    this.filesGenerated.push(path);
  }

  private async generateMakefile(): Promise<void> {
    const context: TemplateContext = {
      project: this.spec,
      service: this.spec.services[0],
      allServices: this.spec.services,
      allDatabases: this.spec.databases || [],
      generatedAt: new Date().toISOString(),
    };

    const content = renderTemplate('Makefile', context);
    const path = join(this.outputDir, 'Makefile');
    await writeFile(path, content, 'utf-8');
    this.filesGenerated.push(path);
  }

  private async generateServiceFiles(service: ServiceSpec): Promise<void> {
    const serviceDir = join(this.outputDir, 'services', service.name);
    await this.ensureDir(serviceDir);
    await this.ensureDir(join(serviceDir, 'src'));

    // Generate Dockerfile
    const dockerfileTemplate = service.language === 'node' ? 'dockerfile-node' : 'dockerfile-python';
    const dockerfileContext = {
      ...this.buildContext(service),
      nodeVersion: this.getNodeVersion(),
      pythonVersion: this.getPythonVersion(),
      pythonMajor: this.getPythonMajor(),
    };
    const dockerfileContent = renderTemplate(dockerfileTemplate, dockerfileContext);
    await writeFile(join(serviceDir, 'Dockerfile'), dockerfileContent, 'utf-8');
    this.filesGenerated.push(join(serviceDir, 'Dockerfile'));

    // Generate k8s manifests
    const k8sDir = join(this.outputDir, 'k8s', 'services', service.name);
    await this.ensureDir(k8sDir);

    // Deployment
    const deploymentContent = renderTemplate('k8s-deployment', this.buildContext(service));
    await writeFile(join(k8sDir, 'deployment.yaml'), deploymentContent, 'utf-8');
    this.filesGenerated.push(join(k8sDir, 'deployment.yaml'));

    // Service
    const serviceContent = renderTemplate('k8s-service', this.buildContext(service));
    await writeFile(join(k8sDir, 'service.yaml'), serviceContent, 'utf-8');
    this.filesGenerated.push(join(k8sDir, 'service.yaml'));

    // HPA
    const hpaContent = renderTemplate('k8s-hpa', this.buildContext(service));
    await writeFile(join(k8sDir, 'hpa.yaml'), hpaContent, 'utf-8');
    this.filesGenerated.push(join(k8sDir, 'hpa.yaml'));

    // ConfigMap
    const configMapContent = renderTemplate('k8s-configmap', this.buildContext(service));
    await writeFile(join(k8sDir, 'configmap.yaml'), configMapContent, 'utf-8');
    this.filesGenerated.push(join(k8sDir, 'configmap.yaml'));

    // README
    const readmeContent = renderTemplate('service-readme', this.buildContext(service));
    await writeFile(join(serviceDir, 'README.md'), readmeContent, 'utf-8');
    this.filesGenerated.push(join(serviceDir, 'README.md'));

    // package.json for node services
    if (service.language === 'node') {
      const pkgJson = {
        name: service.name,
        version: '0.1.0',
        description: `${service.name} microservice`,
        main: 'dist/index.js',
        scripts: {
          build: 'tsc',
          start: 'node dist/index.js',
          dev: 'tsx src/index.ts',
          test: 'vitest',
          lint: 'eslint src --ext .ts',
        },
        dependencies: {},
        devDependencies: {
          typescript: '^5.0.0',
          '@types/node': '^20.0.0',
          tsx: '^4.0.0',
          vitest: '^1.0.0',
        },
      };
      await writeFile(join(serviceDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf-8');
      this.filesGenerated.push(join(serviceDir, 'package.json'));
    }

    // requirements.txt for python services
    if (service.language === 'python') {
      await writeFile(join(serviceDir, 'requirements.txt'), 'fastapi==0.109.0\nuvicorn==0.27.0\npydantic==2.5.0\n', 'utf-8');
      this.filesGenerated.push(join(serviceDir, 'requirements.txt'));
    }
  }

  private async generateDatabaseFiles(): Promise<void> {
    const dbDir = join(this.outputDir, 'k8s', 'databases');
    await this.ensureDir(dbDir);

    for (const db of this.spec.databases!) {
      const dbManifest = this.generateDatabaseManifest(db);
      const path = join(dbDir, `${db.name}.yaml`);
      await writeFile(path, dbManifest, 'utf-8');
      this.filesGenerated.push(path);
    }
  }

  private generateDatabaseManifest(db: DatabaseSpec): string {
    const storageSize = db.size || '1Gi';
    return `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${db.name}
  namespace: ${this.spec.namespace}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: ${storageSize}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${db.name}
  namespace: ${this.spec.namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${db.name}
  template:
    metadata:
      labels:
        app: ${db.name}
    spec:
      containers:
        - name: ${db.name}
          image: ${db.type}:${db.version}
          ports:
            - containerPort: ${db.port || 5432}
              name: ${db.type}
          env:
            - name: POSTGRES_DB
              value: ${this.spec.name}
          volumeMounts:
            - name: ${db.name}-data
              mountPath: /var/lib/${db.type}
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "1Gi"
              cpu: "500m"
      volumes:
        - name: ${db.name}-data
          persistentVolumeClaim:
            claimName: ${db.name}
---
apiVersion: v1
kind: Service
metadata:
  name: ${db.name}
  namespace: ${this.spec.namespace}
spec:
  type: ClusterIP
  ports:
    - port: ${db.port || 5432}
      targetPort: ${db.type}
      protocol: TCP
      name: ${db.type}
  selector:
    app: ${db.name}
`;
  }

  private async generateIngress(): Promise<void> {
    const context: TemplateContext = {
      project: this.spec,
      service: this.spec.services[0],
      allServices: this.spec.services,
      allDatabases: this.spec.databases || [],
      generatedAt: new Date().toISOString(),
    };

    const content = renderTemplate('k8s-ingress', {
      ...context,
      ingress: this.spec.ingress,
    });
    const path = join(this.outputDir, 'k8s', 'ingress.yaml');
    await writeFile(path, content, 'utf-8');
    this.filesGenerated.push(path);
  }

  private async generateGitHubActions(): Promise<void> {
    const context: TemplateContext = {
      project: this.spec,
      service: this.spec.services[0],
      allServices: this.spec.services,
      allDatabases: this.spec.databases || [],
      generatedAt: new Date().toISOString(),
    };

    const content = renderTemplate('github-actions', context);
    const workflowDir = join(this.outputDir, '.github', 'workflows');
    await this.ensureDir(workflowDir);
    await writeFile(join(workflowDir, 'deploy.yml'), content, 'utf-8');
    this.filesGenerated.push(join(workflowDir, 'deploy.yml'));
  }

  private async generatePrometheusConfig(): Promise<void> {
    const context: TemplateContext = {
      project: this.spec,
      service: this.spec.services[0],
      allServices: this.spec.services,
      allDatabases: this.spec.databases || [],
      generatedAt: new Date().toISOString(),
    };

    const content = renderTemplate('prometheus-cm', context);
    const promDir = join(this.outputDir, 'k8s', 'monitoring');
    await this.ensureDir(promDir);
    await writeFile(join(promDir, 'prometheus-configmap.yaml'), content, 'utf-8');
    this.filesGenerated.push(join(promDir, 'prometheus-configmap.yaml'));
  }

  private async generateNginxConfig(): Promise<void> {
    const context: TemplateContext = {
      project: this.spec,
      service: this.spec.services[0],
      allServices: this.spec.services,
      allDatabases: this.spec.databases || [],
      generatedAt: new Date().toISOString(),
    };

    const content = renderTemplate('nginx-conf', context);
    await writeFile(join(this.outputDir, 'nginx.conf'), content, 'utf-8');
    this.filesGenerated.push(join(this.outputDir, 'nginx.conf'));
  }
}
