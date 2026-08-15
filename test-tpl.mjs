// Use the actual generator
import { ProjectGenerator } from '/root/devforge/src/generator.js';
import { readFileSync } from 'fs';

const ctx = {
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

const gen = new ProjectGenerator(ctx, '/tmp/devforge-debug-test');
const result = await gen.generate();
console.log('SUCCESS:', result.success);
console.log('ERRORS:', result.errors);
console.log('FILES:', result.filesGenerated.length);

const dockerCompose = readFileSync('/tmp/devforge-debug-test/docker-compose.yml', 'utf-8');
console.log('--- DOCKER COMPOSE ---');
console.log(dockerCompose);
console.log('--- CONTAINS api:', dockerCompose.includes('api'));
console.log('--- CONTAINS postgres:', dockerCompose.includes('postgres'));
console.log('--- CONTAINS healthcheck:', dockerCompose.includes('healthcheck'));
