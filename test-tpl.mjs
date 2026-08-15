import { createRequire } from 'module';
const nodeRequire = createRequire(import.meta.url);
const Mustache = nodeRequire('mustache');

// Read templates.ts and look at one template
const tpl = `{{=<% %>=}}apiVersion: v1
kind: Service
metadata:
  name: {{service.name}}
  namespace: {{project.namespace}}
spec:
  ports:
    - port: {{service.port}}
`;

const r = Mustache.render(tpl, { service: { name: 'api', port: 3000 }, project: { namespace: 'default' } });
console.log('Current broken output:', JSON.stringify(r));
