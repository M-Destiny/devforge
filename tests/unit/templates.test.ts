import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  listTemplates,
  getTemplatePlaceholders,
  templates,
} from '../../src/templates.js';
import type { ProjectSpec, TemplateContext } from '../../src/types.js';

const spec: ProjectSpec = {
  name: 'demo',
  namespace: 'dev',
  services: [
    {
      name: 'api',
      language: 'node',
      port: 3000,
      dependencies: [],
      env: { NODE_ENV: 'production' },
      healthCheck: { path: '/health', interval: '30s', timeout: '10s', retries: 3 },
      scaling: { minReplicas: 1, maxReplicas: 5, targetCPUUtilization: 70 },
    },
  ],
  databases: [],
  github: { owner: 'acme', repo: 'demo' },
};

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    project: spec,
    service: spec.services[0],
    services: spec.services,
    allServices: spec.services,
    databases: [],
    allDatabases: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('renderTemplate', () => {
  it('renders docker-compose with the project services', () => {
    const out = renderTemplate('docker-compose', ctx());
    expect(out).toContain('api:');
    expect(out).toContain('container_name: api');
    expect(out).toContain('3000:3000');
    expect(out).toContain('devforge-network');
  });

  it('renders the k8s deployment with the service port and namespace', () => {
    const out = renderTemplate('k8s-deployment', ctx());
    expect(out).toContain('kind: Deployment');
    expect(out).toContain('namespace: dev');
    expect(out).toContain('containerPort: 3000');
    expect(out).toContain('name: api');
  });

  it('renders the k8s HPA from service.scaling', () => {
    const out = renderTemplate('k8s-hpa', ctx());
    expect(out).toContain('kind: HorizontalPodAutoscaler');
    expect(out).toContain('minReplicas: 1');
    expect(out).toContain('maxReplicas: 5');
  });

  it('renders the github-actions matrix', () => {
    const out = renderTemplate('github-actions', ctx());
    expect(out).toContain('matrix:');
    expect(out).toContain('- api');
    expect(out).toContain('docker/build-push-action@v5');
  });

  it('renders the Makefile with target names', () => {
    const out = renderTemplate('Makefile', ctx());
    expect(out).toContain('up:');
    expect(out).toContain('down:');
    expect(out).toContain('logs:');
  });

  it('renders the Grafana dashboard JSON with no leaked template tags', () => {
    const out = renderTemplate('grafana-dashboard', ctx());
    // Mustache 4 with HTML-escape default can silently drop missing keys;
    // a leaked <%...%> substring means a placeholder wasn't resolved.
    expect(out).not.toMatch(/<%[^%]*%>/);
    // Sanity-check structural pieces of the Grafana JSON.
    expect(out).toContain('"title": "demo');
    expect(out).toContain('Services Running');
    expect(out).toContain('Per-Service Metrics');
    // The single service in the spec ("api") should drive one set of panels.
    expect(out).toContain('api — Request Rate');
  });

  it('renders the Grafana datasource ConfigMap pointing at the in-cluster Prometheus', () => {
    const out = renderTemplate('grafana-datasource', ctx());
    expect(out).toContain('kind: ConfigMap');
    expect(out).toContain('prometheus.monitoring.svc.cluster.local:9090');
    expect(out).toContain('uid: prometheus');
  });

  it('throws on unknown template names', () => {
    expect(() => renderTemplate('not-a-real-template', ctx())).toThrowError(
      /Unknown template/
    );
  });

  it('escapes mustache special characters in variable values', () => {
    // Mustache HTML-escapes values by default; a string containing < or > should
    // come back with those characters preserved as-is (Mustache only escapes
    // for HTML contexts, and our delimiter <% %> is non-standard). The point of
    // this test is to lock down current behaviour so a future Mustache upgrade
    // can't silently start mangling service names.
    const out = renderTemplate(
      'k8s-service',
      ctx({ service: { ...spec.services[0], name: 'api<v1>' } })
    );
    expect(out).toContain('name: api<v1>');
  });
});

describe('listTemplates', () => {
  it('returns a non-empty list', () => {
    const list = listTemplates();
    expect(list.length).toBeGreaterThan(5);
  });

  it('includes the core templates', () => {
    const list = listTemplates();
    for (const name of [
      'docker-compose',
      'k8s-deployment',
      'k8s-hpa',
      'github-actions',
      'Makefile',
    ]) {
      expect(list).toContain(name);
    }
  });

  it('includes the Grafana provisioning templates', () => {
    const list = listTemplates();
    expect(list).toContain('grafana-dashboard');
    expect(list).toContain('grafana-datasource');
    expect(list).toContain('grafana-dashboard-provider');
  });
});

describe('getTemplatePlaceholders', () => {
  it('returns the dotted placeholder paths used in a template', () => {
    const placeholders = getTemplatePlaceholders('k8s-service');
    expect(placeholders).toContain('service.name');
    expect(placeholders).toContain('service.port');
    expect(placeholders).toContain('project.namespace');
  });

  it('ignores Mustache section / comment / lambda tags', () => {
    const placeholders = getTemplatePlaceholders('k8s-deployment');
    // Control-flow tags like <%#service.healthCheck%> must not leak into the
    // placeholder list. (The variables they wrap — e.g. service.env — are
    // captured separately when they appear as bare <%service.env%> tags.)
    expect(placeholders.every(p => !p.startsWith('#'))).toBe(true);
    expect(placeholders.every(p => !p.startsWith('^'))).toBe(true);
    expect(placeholders.every(p => !p.startsWith('/'))).toBe(true);
  });

  it('throws on unknown template names', () => {
    expect(() => getTemplatePlaceholders('bogus')).toThrowError(/Unknown template/);
  });

  it('returns a sorted, deduplicated list', () => {
    for (const name of Object.keys(templates)) {
      const placeholders = getTemplatePlaceholders(name);
      const sorted = [...placeholders].sort();
      expect(placeholders).toEqual(sorted);
      expect(new Set(placeholders).size).toBe(placeholders.length);
    }
  });
});
