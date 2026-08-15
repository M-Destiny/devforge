import { ProjectGenerator } from './dist/generator.js';
import { readFile } from 'fs/promises';

const spec = {
  name: 'test-project',
  namespace: 'default',
  services: [
    {
      name: 'api',
      language: 'node',
      port: 3000,
      dependencies: [],
      env: { NODE_ENV: 'test' },
      healthCheck: { path: '/health', interval: '30s', timeout: '10s', retries: 3 },
      scaling: { minReplicas: 1, maxReplicas: 5, targetCPUUtilization: 70 },
    },
  ],
  databases: [],
};

const gen = new ProjectGenerator(spec, '/tmp/devforge-inspect');
const result = await gen.generate();
console.log('SUCCESS:', result.success);
console.log('ERRORS:', result.errors);
if (result.success) {
  const c = await readFile('/tmp/devforge-inspect/docker-compose.yml', 'utf-8');
  console.log('--- docker-compose.yml ---');
  console.log(c);
  console.log('--- contains /health:', c.includes('/health'));
  console.log('--- contains healthcheck:', c.includes('healthcheck'));
}
