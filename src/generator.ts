import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import * as Diff from 'diff';
import { Listr, ListrTask } from 'listr2';
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

  private getGoVersion(): string {
    return '1.22';
  }

  private getAlpineVersion(): string {
    return '3.20';
  }

  private getRustVersion(): string {
    return '1.79';
  }

  private getDebianVersion(): string {
    return '12';
  }

  private getJavaVersion(): string {
    return '21-slim';
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

      // Create progress tasks using listr2
      const tasks: ListrTask[] = [
        {
          title: 'Generating docker-compose.yml',
          task: async () => {
            await this.generateDockerCompose();
          },
        },
        {
          title: 'Generating Makefile',
          task: async () => {
            await this.generateMakefile();
          },
        },
        {
          title: 'Generating per-service files',
          task: async (_, task) => {
            for (const service of this.spec.services) {
              await this.generateServiceFiles(service);
              task.title = `Generated service: ${service.name}`;
            }
          },
        },
        {
          title: 'Generating database manifests',
          task: async () => {
            if (this.spec.databases) {
              await this.generateDatabaseFiles();
            }
          },
        },
        {
          title: 'Generating ingress',
          task: async () => {
            if (this.spec.ingress?.enabled) {
              await this.generateIngress();
            }
          },
        },
        {
          title: 'Generating GitHub Actions workflow',
          task: async () => {
            await this.generateGitHubActions();
          },
        },
        {
          title: 'Generating Prometheus ConfigMap',
          task: async () => {
            await this.generatePrometheusConfig();
          },
        },
        {
          title: 'Generating nginx config',
          task: async () => {
            await this.generateNginxConfig();
          },
        },
        {
          title: 'Generating .dockerignore',
          task: async () => {
            await this.generateDockerignore();
          },
        },
        {
          title: 'Generating k8s hardening (PDB + NetworkPolicy)',
          task: async () => {
            await this.generateK8sHardening();
          },
        },
        {
          title: 'Generating Grafana provisioning',
          task: async () => {
            await this.generateGrafana();
          },
        },
        {
          title: 'Generating Terraform (AWS EKS + RDS)',
          task: async () => {
            await this.generateTerraform();
          },
        },
        {
          title: 'Generating platform configs (Vercel, Fly.io, Railway, Render, Cloudflare)',
          task: async () => {
            await this.generatePlatformConfigs();
          },
        },
        {
          title: 'Generating GitOps configs (ArgoCD, ServiceMonitors, KEDA)',
          task: async () => {
            await this.generateGitOpsConfigs();
          },
        },
        {
          title: 'Generating Docker Swarm stack',
          task: async () => {
            await this.generateDockerSwarm();
          },
        },
        {
          title: 'Generating OpenTelemetry Node.js instrumentation',
          task: async () => {
            await this.generateOpenTelemetryNode();
          },
        },
        {
          title: 'Generating Kubernetes Secrets',
          task: async () => {
            await this.generateK8sSecrets();
          },
        },
      ];

      const listr = new Listr(tasks, {
        concurrent: false,
        rendererOptions: {
          collapse: false,
          collapseErrors: false,
          clearOutput: false,
        },
      });

      await listr.run();

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

      const isGrpc = service.protocol === 'grpc';

      // Generate Dockerfile
      let dockerfileTemplate: string;
      const dockerfileContext = {
        ...this.buildContext(service),
        nodeVersion: this.getNodeVersion(),
        pythonVersion: this.getPythonVersion(),
        pythonMajor: this.getPythonMajor(),
        goVersion: this.getGoVersion(),
        alpineVersion: this.getAlpineVersion(),
        rustVersion: this.getRustVersion(),
        debianVersion: this.getDebianVersion(),
        javaVersion: this.getJavaVersion(),
      };

      if (isGrpc) {
        switch (service.language) {
          case 'node':
            dockerfileTemplate = 'grpc-dockerfile-node';
            break;
          case 'go':
            dockerfileTemplate = 'grpc-dockerfile-go';
            break;
          default:
            dockerfileTemplate = 'grpc-dockerfile-node';
        }
      } else {
        switch (service.language) {
          case 'node':
            dockerfileTemplate = 'dockerfile-node';
            break;
          case 'python':
            dockerfileTemplate = 'dockerfile-python';
            break;
          case 'go':
            dockerfileTemplate = 'dockerfile-go';
            break;
          case 'rust':
            dockerfileTemplate = 'dockerfile-rust';
            break;
          case 'java':
            dockerfileTemplate = 'dockerfile-java';
            break;
          default:
            dockerfileTemplate = 'dockerfile-node';
        }
      }

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

      // Generate protocol-specific files
      if (isGrpc) {
        await this.ensureDir(join(serviceDir, 'proto'));
      
        // Generate gRPC proto file
        const protoContent = renderTemplate('grpc-proto', this.buildContext(service));
        await this.writeRenderedFile(join(serviceDir, 'proto', `${service.name}.proto`), protoContent);

        // Generate gRPC service implementation
        let grpcServiceTemplate: string;
        let grpcPackageJson: string | null = null;
        let grpcGoMod: string | null = null;

        switch (service.language) {
          case 'node':
            grpcServiceTemplate = 'grpc-node-service';
            grpcPackageJson = renderTemplate('grpc-node-package-json', this.buildContext(service));
            break;
          case 'go':
            grpcServiceTemplate = 'grpc-go-service';
            grpcGoMod = renderTemplate('grpc-go-mod', this.buildContext(service));
            break;
          default:
            grpcServiceTemplate = 'grpc-node-service';
            grpcPackageJson = renderTemplate('grpc-node-package-json', this.buildContext(service));
        }

        const grpcServiceContent = renderTemplate(grpcServiceTemplate, this.buildContext(service));
        await this.writeRenderedFile(join(serviceDir, 'src', 'index.ts'), grpcServiceContent);

        if (grpcPackageJson) {
          await this.writeRenderedFile(join(serviceDir, 'package.json'), grpcPackageJson);
        }

        if (grpcGoMod) {
          await this.writeRenderedFile(join(serviceDir, 'go.mod'), grpcGoMod);
        }

        // Generate gRPC README
        const grpcReadmeContent = renderTemplate('grpc-readme', this.buildContext(service));
        await this.writeRenderedFile(join(serviceDir, 'README.md'), grpcReadmeContent);
      } else {
        // Standard HTTP service README
        const readmeContent = renderTemplate('service-readme', this.buildContext(service));
        await this.writeRenderedFile(join(serviceDir, 'README.md'), readmeContent);
      }

      if (service.language === 'node' && !isGrpc) {
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
          'fastapi==0.109.0\\nuvicorn==0.27.0\\npydantic==2.5.0\\n'
        );
      }

      // Generate OpenTelemetry instrumentation for supported languages
      if (service.language === 'go') {
        const otelContent = renderTemplate('opentelemetry-go', this.buildContext(service));
        await this.writeRenderedFile(join(serviceDir, 'otel.go'), otelContent);
      } else if (service.language === 'rust') {
        const otelContent = renderTemplate('opentelemetry-rust', this.buildContext(service));
        await this.ensureDir(join(serviceDir, 'src'));
        await this.writeRenderedFile(join(serviceDir, 'src', 'otel.rs'), otelContent);
        
        // Generate Rust service implementation
        const rustServiceContent = renderTemplate('rust-service', this.buildContext(service));
        await this.writeRenderedFile(join(serviceDir, 'src', 'main.rs'), rustServiceContent);
      } else if (service.language === 'java') {
        const otelContent = renderTemplate('opentelemetry-java', this.buildContext(service));
        await this.ensureDir(join(serviceDir, 'src', 'main', 'java', 'otel'));
        await this.writeRenderedFile(join(serviceDir, 'src', 'main', 'java', 'otel', 'OpenTelemetryConfig.java'), otelContent);
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

  private async generatePlatformConfigs(): Promise<void> {
    // Vercel config (for Next.js / frontend frameworks)
    if (this.spec.framework) {
      const vercelContext = this.buildContext(this.spec.services[0]);
      await this.writeRenderedFile(
        join(this.outputDir, 'vercel.json'),
        renderTemplate('vercel', vercelContext)
      );
    }

    // Fly.io config
    if (this.spec.region) {
      for (const service of this.spec.services) {
        const flyContext = this.buildContext(service);
        const flyDir = join(this.outputDir, 'services', service.name);
        await this.ensureDir(flyDir);
        await this.writeRenderedFile(
          join(flyDir, 'fly.toml'),
          renderTemplate('fly', flyContext)
        );
      }
    }

    // Railway config
    if (this.spec.framework || this.spec.region) {
      for (const service of this.spec.services) {
        const railwayContext = this.buildContext(service);
        const railwayDir = join(this.outputDir, 'services', service.name);
        await this.ensureDir(railwayDir);
        await this.writeRenderedFile(
          join(railwayDir, 'railway.json'),
          renderTemplate('railway', railwayContext)
        );
      }
    }

    // Render.com config
    if (this.spec.framework) {
      for (const service of this.spec.services) {
        const renderContext = this.buildContext(service);
        const renderDir = join(this.outputDir, 'services', service.name);
        await this.ensureDir(renderDir);
        await this.writeRenderedFile(
          join(renderDir, 'render.yaml'),
          renderTemplate('render', renderContext)
        );
      }
    }

    // Cloudflare Workers config
    for (const service of this.spec.services) {
      const cfContext = this.buildContext(service);
      const cfDir = join(this.outputDir, 'services', service.name);
      await this.ensureDir(cfDir);
      await this.writeRenderedFile(
        join(cfDir, 'wrangler.toml'),
        renderTemplate('cloudflare-workers', cfContext)
      );
    }
  }

  private async generateGitOpsConfigs(): Promise<void> {
    // ArgoCD Application
    if (this.spec.github) {
      const argocdContext = this.buildContext(this.spec.services[0]);
      const argocdDir = join(this.outputDir, 'k8s', 'argocd');
      await this.ensureDir(argocdDir);
      await this.writeRenderedFile(
        join(argocdDir, 'application.yaml'),
        renderTemplate('argocd-application', argocdContext)
      );
    }

    // ServiceMonitors for Prometheus Operator
    for (const service of this.spec.services) {
      const svcContext = this.buildContext(service);
      const svcMonitorDir = join(this.outputDir, 'k8s', 'servicemonitors');
      await this.ensureDir(svcMonitorDir);
      await this.writeRenderedFile(
        join(svcMonitorDir, `${service.name}.yaml`),
        renderTemplate('service-monitor', svcContext)
      );
    }

    // KEDA ScaledObjects for event-driven autoscaling
    for (const service of this.spec.services) {
      if (service.scaling) {
        const kedaContext = this.buildContext(service);
        const kedaDir = join(this.outputDir, 'k8s', 'keda');
        await this.ensureDir(kedaDir);
        await this.writeRenderedFile(
          join(kedaDir, `${service.name}-scaledobject.yaml`),
          renderTemplate('keda-scaledobject', kedaContext)
        );
      }
    }
  }

  private async generateDockerSwarm(): Promise<void> {
    const context = this.buildContext(this.spec.services[0]);
    await this.writeRenderedFile(
      join(this.outputDir, 'docker-compose.swarm.yml'),
      renderTemplate('docker-swarm', context)
    );
  }

  private async generateOpenTelemetryNode(): Promise<void> {
    // Generate OpenTelemetry Node.js instrumentation for Node.js services
    for (const service of this.spec.services) {
      if (service.language === 'node') {
        const otelContext = this.buildContext(service);
        const serviceDir = join(this.outputDir, 'services', service.name, 'src');
        await this.ensureDir(serviceDir);
        await this.writeRenderedFile(
          join(serviceDir, 'otel.ts'),
          renderTemplate('opentelemetry-node', otelContext)
        );
      }
    }
  }

  private async generateK8sSecrets(): Promise<void> {
    for (const service of this.spec.services) {
      const secretContext = this.buildContext(service);
      const k8sDir = join(this.outputDir, 'k8s', 'services', service.name);
      await this.ensureDir(k8sDir);
      await this.writeRenderedFile(
        join(k8sDir, 'secret.yaml'),
        renderTemplate('k8s-secret', secretContext)
      );
    }
  }
}
