import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectGenerator } from '../../src/generator.js';
import type { ProjectSpec } from '../../src/types.js';
import { readdir, access, constants } from 'fs/promises';
import { join } from 'path';

const validSpec: ProjectSpec = {
  name: 'test-project',
  namespace: 'default',
  services: [
    {
      name: 'api',
      language: 'node',
      port: 3000,
      dependencies: ['auth'],
      env: { NODE_ENV: 'test' },
      healthCheck: { path: '/health', interval: '30s', timeout: '10s', retries: 3 },
      scaling: { minReplicas: 1, maxReplicas: 5, targetCPUUtilization: 70 },
    },
    {
      name: 'auth',
      language: 'node',
      port: 3001,
      dependencies: [],
      env: { JWT_SECRET: 'test' },
    },
  ],
  databases: [
    { name: 'postgres', type: 'postgres', version: '15', port: 5432 },
  ],
};

describe('ProjectGenerator', () => {
  let generator: ProjectGenerator;
  let outputDir: string;

  beforeEach(() => {
    outputDir = `/tmp/devforge-test-${Date.now()}`;
    generator = new ProjectGenerator(validSpec, outputDir);
  });

  describe('validate', () => {
    it('returns no errors for valid spec', () => {
      const errors = generator.validate();
      expect(errors).toHaveLength(0);
    });

    it('returns errors for port conflicts', () => {
      const conflictSpec: ProjectSpec = {
        ...validSpec,
        services: [
          { ...validSpec.services[0], port: 3001 },
          { ...validSpec.services[1], port: 3001 },
        ],
      };
      const gen = new ProjectGenerator(conflictSpec, outputDir);
      const errors = gen.validate();
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('generate', () => {
    it('generates docker-compose.yml', async () => {
      const result = await generator.generate();
      expect(result.success).toBe(true);

      const dockerComposeExists = await checkFileExists(
        join(outputDir, 'docker-compose.yml')
      );
      expect(dockerComposeExists).toBe(true);
    });

    it('generates Makefile', async () => {
      const result = await generator.generate();
      expect(result.success).toBe(true);

      const makefileExists = await checkFileExists(join(outputDir, 'Makefile'));
      expect(makefileExists).toBe(true);
    });

    it('generates k8s manifests per service', async () => {
      const result = await generator.generate();
      expect(result.success).toBe(true);

      const k8sDir = join(outputDir, 'k8s', 'services', 'api');
      const deploymentExists = await checkFileExists(join(k8sDir, 'deployment.yaml'));
      const serviceExists = await checkFileExists(join(k8sDir, 'service.yaml'));
      const hpaExists = await checkFileExists(join(k8sDir, 'hpa.yaml'));
      const configMapExists = await checkFileExists(join(k8sDir, 'configmap.yaml'));

      expect(deploymentExists).toBe(true);
      expect(serviceExists).toBe(true);
      expect(hpaExists).toBe(true);
      expect(configMapExists).toBe(true);
    });

    it('generates GitHub Actions workflow', async () => {
      const result = await generator.generate();
      expect(result.success).toBe(true);

      const workflowExists = await checkFileExists(
        join(outputDir, '.github', 'workflows', 'deploy.yml')
      );
      expect(workflowExists).toBe(true);
    });

    it('generates nginx config', async () => {
      const result = await generator.generate();
      expect(result.success).toBe(true);

      const nginxExists = await checkFileExists(join(outputDir, 'nginx.conf'));
      expect(nginxExists).toBe(true);
    });

    it('generates database manifests', async () => {
      const result = await generator.generate();
      expect(result.success).toBe(true);

      const dbManifestExists = await checkFileExists(
        join(outputDir, 'k8s', 'databases', 'postgres.yaml')
      );
      expect(dbManifestExists).toBe(true);
    });

    it('returns list of generated files', async () => {
      const result = await generator.generate();
      expect(result.success).toBe(true);
      expect(result.filesGenerated.length).toBeGreaterThan(0);
    });

    it('fails for invalid spec', async () => {
      const invalidSpec: ProjectSpec = {
        name: 'test',
        namespace: 'default',
        services: [
          { name: 'api', language: 'node', port: 3000 },
          { name: 'auth', language: 'node', port: 3000 }, // port conflict
        ],
      };
      const gen = new ProjectGenerator(invalidSpec, outputDir);
      const result = await gen.generate();
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('docker-compose content', () => {
    it('includes all services', async () => {
      await generator.generate();

      const { readFile } = await import('fs/promises');
      const content = await readFile(
        join(outputDir, 'docker-compose.yml'),
        'utf-8'
      );

      expect(content).toContain('api');
      expect(content).toContain('auth');
    });

    it('includes database services', async () => {
      await generator.generate();

      const { readFile } = await import('fs/promises');
      const content = await readFile(
        join(outputDir, 'docker-compose.yml'),
        'utf-8'
      );

      expect(content).toContain('postgres');
    });

    it('includes health checks', async () => {
      await generator.generate();

      const { readFile } = await import('fs/promises');
      const content = await readFile(
        join(outputDir, 'docker-compose.yml'),
        'utf-8'
      );

      expect(content).toContain('healthcheck');
      expect(content).toContain('/health');
    });
  });

  describe('k8s manifests content', () => {
    it('deployment has correct port', async () => {
      await generator.generate();

      const { readFile } = await import('fs/promises');
      const content = await readFile(
        join(outputDir, 'k8s', 'services', 'api', 'deployment.yaml'),
        'utf-8'
      );

      expect(content).toContain('containerPort: 3000');
    });

    it('deployment has HPA configuration', async () => {
      await generator.generate();

      const { readFile } = await import('fs/promises');
      const content = await readFile(
        join(outputDir, 'k8s', 'services', 'api', 'hpa.yaml'),
        'utf-8'
      );

      expect(content).toContain('HorizontalPodAutoscaler');
      expect(content).toContain('minReplicas: 1');
      expect(content).toContain('maxReplicas: 5');
    });

    it('service has correct port', async () => {
      await generator.generate();

      const { readFile } = await import('fs/promises');
      const content = await readFile(
        join(outputDir, 'k8s', 'services', 'api', 'service.yaml'),
        'utf-8'
      );

      expect(content).toContain('port: 3000');
    });
  });
});

async function checkFileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
