#!/usr/bin/env node

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { parseSpec, validateSpec } from './spec-parser.js';
import { ProjectGenerator } from './generator.js';
import { listTemplates } from './templates.js';

const program = new Command();

program
  .name('devforge')
  .description('AI-powered scaffolding CLI for microservices')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new DevForge project from a spec file')
  .argument('<spec.yaml>', 'Path to the spec YAML file')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('--dry-run', 'Preview what would be generated without writing any files', false)
  .option('--diff', 'Show a unified diff for every file that would be modified', false)
  .option('--overwrite', 'Overwrite existing files without prompting', false)
  .action(
    async (
      specFile: string,
      options: { output: string; dryRun: boolean; diff: boolean; overwrite: boolean }
    ) => {
      try {
        const content = await readFile(specFile, 'utf-8');
        const spec = parseSpec(content);

        console.log(`Generating project: ${spec.name}`);
        const generator = new ProjectGenerator(spec, options.output, {
          dryRun: options.dryRun,
          diff: options.diff,
          overwrite: options.overwrite,
        });
        const result = await generator.generate();

        if (options.diff) {
          const diffs = generator.getDiffs();
          const meaningful = diffs.filter(d => d.diff);
          if (meaningful.length > 0) {
            console.log('\nDiffs:');
            for (const entry of meaningful) {
              console.log(`\n--- ${entry.path} (${entry.status}) ---`);
              console.log(entry.diff);
            }
          } else {
            console.log('\nNo diffs (clean output).');
          }
        }

        if (result.success) {
          console.log(`\n${generator.formatSummary()}`);
          result.filesGenerated.forEach(f => console.log(`  + ${f}`));
          if (result.warnings.length > 0) {
            console.log('\nWarnings:');
            result.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
          }
          if (options.dryRun) {
            console.log('\n(dry-run: no files were written)');
          }
        } else {
          console.error('\n❌ Generation failed:');
          result.errors.forEach(e => console.error(`  - ${e}`));
          process.exit(1);
        }
      } catch (err) {
        console.error('❌ Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }
  );

program
  .command('validate')
  .description('Validate a spec file')
  .argument('<spec.yaml>', 'Path to the spec YAML file')
  .action(async (specFile: string) => {
    try {
      const content = await readFile(specFile, 'utf-8');
      const spec = parseSpec(content);
      const validation = validateSpec(spec);

      if (validation.valid) {
        console.log('✅ Spec is valid');
        console.log(`  - ${spec.services.length} services`);
        if (spec.databases) {
          console.log(`  - ${spec.databases.length} databases`);
        }
      } else {
        console.error('❌ Spec validation failed:');
        validation.errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }
    } catch (err) {
      console.error('❌ Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('list-templates')
  .description('List all available templates')
  .action(() => {
    const templates = listTemplates();
    console.log('Available templates:');
    templates.forEach(t => console.log(`  - ${t}`));
  });

program
  .command('scaffold')
  .description('Interactively scaffold a new project')
  .argument('<name>', 'Project name')
  .action(async (name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompts = (await import('prompts')) as any;
    const questions: Array<{
      type: 'text' | 'list';
      name: string;
      message: string;
      initial: string;
    }> = [
      {
        type: 'text',
        name: 'namespace',
        message: 'Kubernetes namespace:',
        initial: 'default',
      },
      {
        type: 'list',
        name: 'services',
        message: 'Service names (comma-separated):',
        initial: 'api-gateway,auth-service',
      },
      {
        type: 'list',
        name: 'databases',
        message: 'Database types (comma-separated, leave empty for none):',
        initial: 'postgres',
      },
    ];

    const answers = await prompts(questions, {
      onCancel: () => {
        console.log('Cancelled');
        process.exit(0);
      },
    });

    const serviceNames = answers.services.split(',').map((s: string) => s.trim());
    const dbTypes = answers.databases ? answers.databases.split(',').map((s: string) => s.trim()) : [];

    const services = serviceNames.map((svcName: string) => ({
      name: svcName,
      language: 'node' as const,
      port: 3000 + serviceNames.indexOf(svcName),
      dependencies: [] as string[],
      env: {} as Record<string, string>,
      healthCheck: { path: '/health', interval: '30s', timeout: '10s', retries: 3 },
      scaling: { minReplicas: 1, maxReplicas: 5, targetCPUUtilization: 70 },
    }));

    const databases: any[] = [];
    if (dbTypes.length > 0) {
      dbTypes.forEach((dbType: string, idx: number) => {
        databases.push({
          name: dbType,
          type: dbType,
          version: dbType === 'postgres' ? '15' : 'latest',
          port: 5432 + idx,
          size: '1Gi',
        });
      });
    }

    const spec = {
      name,
      namespace: answers.namespace,
      services,
      databases: databases.length > 0 ? databases : undefined,
      ingress: {
        enabled: true,
        rules: serviceNames.map((svcName: string, idx: number) => ({
          host: `api.${svcName}.example.com`,
          path: `/${svcName}`,
          service: svcName,
          servicePort: services[idx].port,
        })),
      },
    };

    console.log(`\nGenerating project: ${name}`);
    const generator = new ProjectGenerator(spec, `./${name}`);
    const result = await generator.generate();

    if (result.success) {
      console.log(`\n✅ Generated ${result.filesGenerated.length} files`);
      console.log(`\nTo get started:`);
      console.log(`  cd ${name}`);
      console.log(`  make up`);
    } else {
      console.error('\n❌ Generation failed:');
      result.errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }
  });

program.parse();
