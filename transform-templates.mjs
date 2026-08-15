// Rewrite every template in templates.ts so that variable tags use <% %>
// (matching the `{{=<% %>=}}` delimiter change) and `{{...}}` in the output
// is literal. The original templates mixed both styles, which is the bug
// that caused Mustache to render 13 tests as the literal-string raw template.

import { readFileSync, writeFileSync } from 'fs';

const path = process.argv[2] || '/root/devforge/src/templates.ts';
const src = readFileSync(path, 'utf-8');

function convertTemplate(body) {
  // Step 1: Convert `{{{var}}}` (triple-mustache, raw) -> `<%{var}%>`
  body = body.replace(/\{\{\{([A-Za-z0-9_.]+)\}\}\}/g, '<%{$1}%>');
  // Step 2: Convert `{{var}}` (variable) -> `<%var%>` (must come AFTER
  // triple-mustache so the `{{{` isn't mistakenly consumed as `{{` + `{`).
  body = body.replace(/\{\{([A-Za-z0-9_.]+)\}\}/g, '<%$1%>');
  // Step 3: Convert section/inverted tags
  body = body.replace(/\{\{([#\/\^])([A-Za-z0-9_.]+)\}\}/g, '<%$1$2%>');
  body = body.replace(/\{\{\.\}\}/g, '<%.%>');
  // Step 4: Drop Mustache comments `{{! ... }}` (entire-line, optional).
  body = body.replace(/\{\{![^}]*\}\}\n?/g, '');
  return body;
}

// Find every `const NAME = \`...\`;` template literal and transform it.
const out = [];
let pos = 0;
const templatePattern = /const\s+(\w+)\s*=\s*`\{\{=\s*<%\s*%>\s*=\}\}([\s\S]*?)`\s*;/g;
let m;
let count = 0;
while ((m = templatePattern.exec(src)) !== null) {
  out.push(src.slice(pos, m.index));
  const name = m[1];
  const body = m[2];
  const transformedBody = convertTemplate(body);
  out.push('const ' + name + ' = `' + transformedBody + '`;');
  pos = m.index + m[0].length;
  count++;
}
out.push(src.slice(pos));

writeFileSync(path, out.join(''), 'utf-8');
console.log('Transformed', count, 'template(s).');
