import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import * as Diff from 'diff';
import type {
  ProjectSpec,
  ServiceSpec,
  DatabaseSpec,
  TemplateContext,
  GenerationResult,
} from './types.js';
import { renderTemplate } from './templates.js';
import { validateSpec } from './spec-parser.js';

export interface GenerateOptions {
  /** When true, do not write any files. The result still lists what would be written. */
  dryRun?: boolean;
  /** When true, return a diff for each existing file vs. the new content. */
  diff?: boolean;
  /** Overwrite existing files without prompting. Required when diff is false and files exist. */
  overwrite?: boolean;
}

export interface FileDiff {
  path: string;
  status: 'created' | 'unchanged' | 'modified' | 'skipped';
  diff?: string;
}

export const DEFAULT_GENERATE_OPTIONS: GenerateOptions = {
  dryRun: false,
  diff: false,
  overwrite: false,
};

export class ProjectGenerator {
  private spec: ProjectSpec;
  private outputDir: string;
  private filesGenerated: string[] = [];
  private filesSkipped: string[] = [];
  private filesUnchanged: string[] = [];
  private diffs: FileDiff[] = [];
  private errors: string[] = [];
  private warnings: string[] = [];
  private options: GenerateOptions;

  constructor(spec: ProjectSpec, outputDir: string = './output', options: GenerateOptions = {}) {
    this.spec = spec;
    this.outputDir = outputDir;
    this.options = { ...DEFAULT_GENERATE_OPTIONS, ...options };
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
    if (this.options.dryRun) return;
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
      services: this.spec.services,
      allServices: this.spec.services,
      databases: this.spec.databases || [],
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

  /**
   * Writes (or, in dry-run mode, pretends to write) a file to disk. Returns
   * the resulting FileDiff entry so the caller can render a summary.
   */
  private async writeRenderedFile(filePath: string, content: string): Promise<void> {
    let status: FileDiff['status'] = 'created';
    let diffOutput: string | undefined;

    try {
      const existing = await readFile(filePath, 'utf-8');
      if (existing === content) {
        status = 'unchanged';
      } else {
        const fileDiffs = Diff.createTwoFilesPatch(
          filePath,
          filePath,
          existing,
          content,
          'existing',
          'generated'
        );
        diffOutput = fileDiffs;
        if (this.options.overwrite) {
          status = 'modified';
        } else {
          status = 'skipped';
          this.warnings.push(
            `File exists and would be overwritten: ${filePath} (use --overwrite to replace, --diff to preview)`
          );
        }
      }
    } catch {
      // File doesn't exist — that's fine, we'll create it.
      status = 'created';
    }

    if (status === 'skipped') {
      this.filesSkipped.push(filePath);
    } else if (status === 'unchanged') {
      this.filesUnchanged.push(filePath);
    } else {
      this.filesGenerated.push(filePath);
    }
    this.diffs.push({ path: filePath, status, diff: diffOutput });

    if (status !== 'skipped' && status !== 'unchanged' && !this.options.dryRun) {
      await writeFile(filePath, content, 'utf-8');
    }
  }

  async generate(): Promise<GenerationResult> {
    this.filesGenerated = [];
    this.filesSkipped = [];
    this.filesUnchanged = [];
    this.diffs = [];
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

      // Generate .dockerignore
      await this.generateDockerignore();

      // Generate k8s hardening (PDB + NetworkPolicy)
      await this.generateK8sHardening();

      // Generate Grafana provisioning (dashboard + datasource + provider)
      await this.generateGrafana();

      // Generate Terraform (AWS platform: VPC + EKS + RDS per database)
      await this.generateTerraform();

      const success = this.errors.length === 0;
      return {
        success,
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

  /** Returns the per-file diffs captured during the most recent generate() call. */
  getDiffs(): FileDiff[] {
    return this.diffs;
  }

  /** Returns a human-readable summary of the most recent generation. */
  formatSummary(): string {
    const lines: string[] = [];
    const verb = this.options.dryRun ? 'Would generate' : 'Generated';
    lines.push(`${verb} ${this.filesGenerated.length} file(s)`);
    if (this.filesUnchanged.length > 0) {
      lines.push(`Unchanged: ${this.filesUnchanged.length}`);
    }
    if (this.filesSkipped.length > 0) {
      lines.push(`Skipped (would overwrite): ${this.filesSkipped.length}`);
    }
    if (this.warnings.length > 0) {
      lines.push(`Warnings: ${this.warnings.length}`);
    }
    return lines.join('\n');
  }

  private async generateDockerCompose(): Promise<void> {
    const context = this.buildContext(this.spec.services[0]);
    const content = renderTemplate('docker-compose', context);
    const filePath = join(this.outputDir, 'docker-compose.yml');
    await this.writeRenderedFile(filePath, content);
  }

  private async generateMakefile(): Promise<void> {
    const context = this.buildContext(this.spec.services[0]);
    const content = renderTemplate('Makefile', context);
    const filePath = join(this.outputDir, 'Makefile');
    await this.writeRenderedFile(filePath, content);
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
    await this.writeRenderedFile(join(serviceDir, 'Dockerfile'), dockerfileContent);

    // Generate k8s manifests
    const k8sDir = join(this.outputDir, 'k8s', 'services', service.name);
    await this.ensureDir(k8sDir);

    const deploymentContent = renderTemplate('k8s-deployment', this.buildContext(service));
    await this.writeRenderedFile(join(k8sDir, 'deployment.yaml'), deploymentContent);

    const serviceContent = renderTemplate('k8s-service', this.buildContext(service));
    await this.writeRenderedFile(join(k8sDir, 'service.yaml'), serviceContent);

    const hpaContent = renderTemplate('k8s-hpa', this.buildContext(service));
    await this.writeRenderedFile(join(k8sDir, 'hpa.yaml'), hpaContent);

    const pdbContent = renderTemplate('k8s-pdb', this.buildContext(service));
    await this.writeRenderedFile(join(k8sDir, 'pdb.yaml'), pdbContent);

    const netpolContent = renderTemplate('k8s-networkpolicy', this.buildContext(service));
    await this.writeRenderedFile(join(k8sDir, 'networkpolicy.yaml'), netpolContent);

    const configMapContent = renderTemplate('k8s-configmap', this.buildContext(service));
    await this.writeRenderedFile(join(k8sDir, 'configmap.yaml'), configMapContent);

    const readmeContent = renderTemplate('service-readme', this.buildContext(service));
    await this.writeRenderedFile(join(serviceDir, 'README.md'), readmeContent);

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
      await this.writeRenderedFile(join(serviceDir, 'package.json'), JSON.stringify(pkgJson, null, 2));
    }

    if (service.language === 'python') {
      await this.writeRenderedFile(
        join(serviceDir, 'requirements.txt'),
        'fastapi==0.109.0\nuvicorn==0.27.0\npydantic==2.5.0\n'
      );
    }
  }

  private async generateDatabaseFiles(): Promise<void> {
    const dbDir = join(this.outputDir, 'k8s', 'databases');
    await this.ensureDir(dbDir);

    for (const db of this.spec.databases!) {
      const dbManifest = this.generateDatabaseManifest(db);
      await this.writeRenderedFile(join(dbDir, `${db.name}.yaml`), dbManifest);
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
    const context = this.buildContext(this.spec.services[0]);
    const content = renderTemplate('k8s-ingress', {
      ...context,
      ingress: this.spec.ingress,
    });
    await this.writeRenderedFile(join(this.outputDir, 'k8s', 'ingress.yaml'), content);
  }

  private async generateGitHubActions(): Promise<void> {
    const context = this.buildContext(this.spec.services[0]);
    const content = renderTemplate('github-actions', context);
    const workflowDir = join(this.outputDir, '.github', 'workflows');
    await this.ensureDir(workflowDir);
    await this.writeRenderedFile(join(workflowDir, 'deploy.yml'), content);
  }

  private async generatePrometheusConfig(): Promise<void> {
    const context = this.buildContext(this.spec.services[0]);
    const content = renderTemplate('prometheus-cm', context);
    const promDir = join(this.outputDir, 'k8s', 'monitoring');
    await this.ensureDir(promDir);
    await this.writeRenderedFile(join(promDir, 'prometheus-configmap.yaml'), content);
  }

  private async generateNginxConfig(): Promise<void> {
    const context = this.buildContext(this.spec.services[0]);
    const content = renderTemplate('nginx-conf', context);
    await this.writeRenderedFile(join(this.outputDir, 'nginx.conf'), content);
  }

  private async generateDockerignore(): Promise<void> {
    const content = `# Dev / build artifacts
node_modules/
dist/
build/
__pycache__/
*.pyc
*.pyo
coverage/
.nyc_output/

# Editor / IDE
.vscode/
.idea/
*.swp
*.swo
.DS_Store

# Git / CI
.git/
.gitignore
.github/

# Project-specific generated files
output/
devforge-output/
k8s/
docker-compose.yml
nginx.conf
*.log

# Tests / fixtures
tests/fixtures/
*.test.*
`;
    await this.writeRenderedFile(join(this.outputDir, '.dockerignore'), content);
  }

  private async generateK8sHardening(): Promise<void> {
    const context = this.buildContext(this.spec.services[0]);

    // Cluster-wide NetworkPolicy: default-deny + allow ingress + allow DNS
    const netpolDir = join(this.outputDir, 'k8s', 'networkpolicies');
    await this.ensureDir(netpolDir);
    const defaultDeny = renderTemplate('k8s-netpol-default-deny', context);
    await this.writeRenderedFile(join(netpolDir, 'default-deny.yaml'), defaultDeny);

    // Per-service strict NetworkPolicy
    const svcNetpolDir = join(this.outputDir, 'k8s', 'service-networkpolicies');
    await this.ensureDir(svcNetpolDir);
    for (const service of this.spec.services) {
      const content = renderTemplate('k8s-networkpolicy-strict', this.buildContext(service));
      await this.writeRenderedFile(join(svcNetpolDir, `${service.name}.yaml`), content);
    }
  }

  // Grafana sidecar provisioning: dashboard JSON + Prometheus datasource +
  // dashboard provider. Drop these into k8s/monitoring so a fresh `kubectl
  // apply` ships working visualizations alongside Prometheus.
  private async generateGrafana(): Promise<void> {
    const monitoringDir = join(this.outputDir, 'k8s', 'monitoring');
    await this.ensureDir(monitoringDir);
    const baseContext = this.buildContext(this.spec.services[0]);

    // Datasource + dashboard-provider ConfigMaps — cluster-scoped, no
    // per-service data, so a single render with the first service's context
    // is sufficient.
    await this.writeRenderedFile(
      join(monitoringDir, 'grafana-datasource.yaml'),
      renderTemplate('grafana-datasource', baseContext)
    );
    await this.writeRenderedFile(
      join(monitoringDir, 'grafana-dashboard-provider.yaml'),
      renderTemplate('grafana-dashboard-provider', baseContext)
    );

    // Dashboard — needs per-service numeric ids and y-coordinates that the
    // template can't compute itself (Mustache has no arithmetic). Inject
    // those here so the rendered JSON is valid Grafana. We spread each
    // ServiceSpec so the result still satisfies the TemplateContext type.
    const dashboardServices = this.spec.services.map((svc, idx) => {
      const base = 1000 + idx * 100;
      const y = 6 + idx * 8;
      return {
        ...svc,
        id: {
          request: base + 1,
          error: base + 2,
          latency: base + 3,
          y,
        },
      };
    });
    const dashboardContext: TemplateContext = {
      ...baseContext,
      services: dashboardServices as unknown as ServiceSpec[],
      allServices: dashboardServices as unknown as ServiceSpec[],
    };
    await this.writeRenderedFile(
      join(monitoringDir, 'grafana-dashboard.json'),
      renderTemplate('grafana-dashboard', dashboardContext)
    );
  }

  // Terraform: emit `terraform/main.tf` (AWS EKS + per-database RDS) plus a
  // variables.tf and a `.gitignore` so users don't accidentally commit
  // `.terraform/` and `*.tfstate` files. The template is rendered once,
  // using the first service's context (the template only references project
  // + databases).
  private async generateTerraform(): Promise<void> {
    const terraformDir = join(this.outputDir, 'terraform');
    await this.ensureDir(terraformDir);

    const context = this.buildContext(this.spec.services[0]);
    await this.writeRenderedFile(
      join(terraformDir, 'main.tf'),
      renderTemplate('terraform-aws', context)
    );

    // Variables file - small and worth keeping separate so users can
    // override region / cluster name without touching the EKS module.
    const variablesContent = `# Override defaults with terraform.tfvars or by passing -var flags.
aws_region          = "us-east-1"
cluster_name        = "${this.spec.name}"
kubernetes_version  = "1.29"
node_instance_type  = "m6i.large"
node_min_size       = 2
node_max_size       = 10
node_desired_size   = 3
`;
    await this.writeRenderedFile(join(terraformDir, 'variables.tf'), variablesContent);

    // .gitignore - never commit Terraform state or local plugin cache.
    const gitignore = `# Local Terraform state
.terraform/
.terraform.lock.hcl

# State files (use remote backend; never commit)
*.tfstate
*.tfstate.*
crash.log
crash.*.log

# Variable files containing secrets
*.tfvars
!example.tfvars

# Override files
override.tf
override.tf.json
*_override.tf
*_override.tf.json
`;
    await this.writeRenderedFile(join(terraformDir, '.gitignore'), gitignore);
  }
}
