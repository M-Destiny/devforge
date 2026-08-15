import { ProjectGenerator } from './src/generator.js';

const spec = {
  name: 'test-project',
  namespace: 'default',
  services: [
    {
      name: 'api',
      language: 'node' as const,
      port: 3000,
      dependencies: ['auth'],
      env: { NODE_ENV: 'test' },
      healthCheck: { path: '/health', interval: '30s', timeout: '10s', retries: 3 },
      scaling: { minReplicas: 1, maxReplicas: 5, targetCPUUtilization: 70 },
    },
    {
      name: 'auth',
      language: 'node' as const,
      port: 3001,
      dependencies: [],
      env: { JWT_SECRET: 'test' },
    },
  ],
  databases: [{ name: 'postgres', type: 'postgres' as const, version: '15', port: 5432 }],
};

const g = new ProjectGenerator(spec, '/tmp/devforge-diag-' + Date.now());
const r = await g.generate();
console.log('success:', r.success);
console.log('errors:', JSON.stringify(r.errors, null, 2));
console.log('warnings (first 5):', JSON.stringify(r.warnings.slice(0, 5), null, 2));
console.log('filesGenerated count:', r.filesGenerated.length);
