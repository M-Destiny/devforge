#!/usr/bin/env node

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { parseSpec, validateSpec } from './spec-parser.js';
import { ProjectGenerator } from './generator.js';
import {
  listTemplatesWithMetadata,
  getTemplateMetadata,
  getTemplatePlaceholders,
  renderTemplate,
} from './templates.js';
import type { ProjectSpec, ServiceSpec, DatabaseSpec } from './types.js';

/**
 * Renders a template with a minimal but representative stub ProjectSpec so
 * `info-template --sample` can show what a real output looks like. We don't
 * read from a spec file because the goal is to show the template's *shape*,
 * not validate a specific spec.
 */
function renderSampleForTemplate(name: string): string {
  const sampleService: ServiceSpec = {
    name: 'api-gateway',
    language: 'node',
    port: 3000,
    dependencies: ['auth-service'],
    env: { NODE_ENV: 'production', LOG_LEVEL: 'info' },
    healthCheck: { path: '/health', interval: '30s', timeout: '10s', retries: 3 },
    scaling: { minReplicas: 2, maxReplicas: 10, targetCPUUtilization: 70 },
  };
  const sampleDb: DatabaseSpec = {
    name: 'postgres',
    type: 'postgres',
    version: '15',
    size: '10Gi',
    port: 5432,
  };
  const sampleSpec: ProjectSpec = {
    name: 'demo',
    namespace: 'production',
    services: [sampleService],
    databases: [sampleDb],
    ingress: { enabled: true },
    github: { owner: 'acme', repo: 'demo' },
  };

  const ctx = {
    project: sampleSpec,
    service: sampleService,
    services: [sampleService],
    allServices: [sampleService],
    databases: [sampleDb],
    allDatabases: [sampleDb],
    generatedAt: new Date().toISOString(),
  };
  return renderTemplate(name, ctx);
}

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
  .option('--verbose', 'Show description, category, and output path for each template')
  .option('--json', 'Print metadata as JSON (machine-readable)')
  .option(
    '--category <category>',
    'Filter by category (docker, kubernetes, helm, ci, observability, infra, documentation)'
  )
  .action((options: { verbose?: boolean; json?: boolean; category?: string }) => {
    const all = listTemplatesWithMetadata();
    const filtered = options.category
      ? all.filter((t) => t.category === options.category)
      : all;

    if (options.json) {
      console.log(JSON.stringify(filtered, null, 2));
      return;
    }

    if (options.verbose) {
      const byCategory = new Map<string, typeof filtered>();
      for (const t of filtered) {
        if (!byCategory.has(t.category)) byCategory.set(t.category, []);
        byCategory.get(t.category)!.push(t);
      }
      console.log(`Available templates (${filtered.length} total, grouped by category):`);
      for (const [category, items] of byCategory) {
        console.log(`\n  ${category} (${items.length})`);
        for (const t of items) {
          const suffix = t.perService ? ' [per-service]' : '';
          console.log(`    - ${t.name}${suffix}`);
          console.log(`        ${t.description}`);
          console.log(`        → ${t.outputPath}`);
        }
      }
      return;
    }

    console.log('Available templates:');
    filtered.forEach((t) => console.log(`  - ${t.name}`));
  });

program
  .command('info-template')
  .alias('describe')
  .description('Show details for a single template (description, placeholders, sample render)')
  .argument('<name>', 'Template name (e.g. k8s-deployment)')
  .option('--placeholders', 'Only show the placeholder list')
  .option('--sample', 'Also show a sample render using a stub ProjectSpec')
  .option('--json', 'Print output as JSON')
  .action(
    (
      name: string,
      options: { placeholders?: boolean; sample?: boolean; json?: boolean }
    ) => {
      const meta = getTemplateMetadata(name);
      if (!meta) {
        console.error(`❌ Unknown template: ${name}`);
        console.error(`Run \`devforge list-templates\` to see available names.`);
        process.exit(1);
      }

      const placeholders = getTemplatePlaceholders(name);

      if (options.json) {
        const out: Record<string, unknown> = { ...meta, placeholders };
        if (options.sample) {
          out.sample = renderSampleForTemplate(name);
        }
        console.log(JSON.stringify(out, null, 2));
        return;
      }

      if (options.placeholders) {
        console.log(placeholders.join('\n'));
        return;
      }

      console.log(`\n📄 ${meta.name}`);
      console.log(`   ${meta.description}\n`);
      console.log(`   category:    ${meta.category}`);
      console.log(`   per-service: ${meta.perService ? 'yes' : 'no'}`);
      console.log(`   output:      ${meta.outputPath}`);
      console.log(`   placeholders (${placeholders.length}):`);
      for (const p of placeholders) {
        console.log(`     - ${p}`);
      }

      if (options.sample) {
        const sample = renderSampleForTemplate(name);
        const lines = sample.split('\n');
        console.log(`\n   sample render (${lines.length} lines):`);
        console.log('   ' + '─'.repeat(60));
        for (const line of lines.slice(0, 30)) {
          console.log(`   ${line}`);
        }
        if (lines.length > 30) {
          console.log(`   ... (${lines.length - 30} more lines truncated)`);
        }
      }
      console.log('');
    }
  );

program
  .command('scaffold')
  .description('Interactively scaffold a new project')
  .argument('<name>', 'Project name')
  .action(async (name: string) => {
    // `prompts` uses `export = prompts` (CJS) which TS resolves to a
    // callable namespace. With `esModuleInterop`, the default import gives
    // us the callable directly without `any` casts.
    import prompts from 'prompts';
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

    const databases: Array<{
      name: string;
      type: string;
      version: string;
      port: number;
      size: string;
    }> = [];
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
