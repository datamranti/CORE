const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const workflowPath = path.resolve(__dirname, '..', 'n8n', 'MRANTI CORE Batch 1.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const node = name => workflow.nodes.find(item => item.name === name);

test('all existing Search Index generators remain present', () => {
  [
    'Generate Search Index Manual',
    'Generate Search Index OCR',
    'Generate Search Index Meeting',
    'Generate Search Index Backfill'
  ].forEach(name => assert.ok(node(name), `missing ${name}`));
});

test('Relationship Graph uses ranked token-aware search', () => {
  const code = node('Build Relationship Graph Page')?.parameters?.jsCode || '';
  assert.match(code, /function recordSearchScore/);
  assert.match(code, /tokenPrefixMatch/);
  assert.match(code, /priorityFloor/);
  assert.doesNotMatch(code, /haystack\.includes\(q\)/);
});

test('Relationship Graph builder and generated browser script compile', () => {
  const code = node('Build Relationship Graph Page')?.parameters?.jsCode || '';
  const build = new Function('items', code);
  const result = build([{ json: { records: [], user: { email: 'reviewer@mranti.my' } } }]);
  const html = result?.[0]?.json?.html || '';
  assert.match(html, /<!DOCTYPE html>/i);
  const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(inlineScripts.length, 'generated page has no inline application script');
  inlineScripts.forEach(script => assert.doesNotThrow(() => new Function(script)));
});

test('Context data response exposes input date fallback', () => {
  const code = node('Format CRM Contacts Data')?.parameters?.jsCode || '';
  assert.match(code, /timeUploaded:row\['Time Uploaded'\]/);
  assert.match(code, /createdAt:row\['Time Uploaded'\]/);
});

test('credential assignments are unchanged from the supplied workflow', () => {
  const assignments = workflow.nodes
    .flatMap(item => Object.entries(item.credentials || {}).map(([type, value]) => [item.name, type, value.id, value.name]))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const digest = crypto.createHash('sha256').update(JSON.stringify(assignments)).digest('hex');
  assert.equal(assignments.length, 23);
  assert.equal(digest, 'a53d781fb790e99516b048cea26f12e449eea21504264d2442e2524410260dba');
});
