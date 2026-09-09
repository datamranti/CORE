const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('GitHub Pages entrypoint references every local asset', () => {
  const localSources = [...html.matchAll(/(?:src|href)="((?:src\/)[^"]+)"/g)].map(match => match[1].split('?')[0]);
  assert.ok(localSources.length >= 7);
  localSources.forEach(source => assert.ok(fs.existsSync(path.join(root, source)), `missing ${source}`));
});

test('application scripts are deferred in dependency order', () => {
  const scripts = [...html.matchAll(/<script defer src="(src\/[^"]+)"><\/script>/g)].map(match => match[1]);
  assert.deepEqual(scripts, [
    'src/config.js', 'src/search.js', 'src/calendar.js',
    'src/crm.js', 'src/contacts.js', 'src/auth.js'
  ]);
});

test('CORE and Context are the user-facing product labels', () => {
  assert.match(html, /<title>MRANTI CORE<\/title>/);
  assert.match(html, />Context<\/span>/);
  assert.doesNotMatch(html, />CRM Contacts</);
  assert.doesNotMatch(html, />MRANTI CRM Workspace</i);
});

test('Context and Relationship Graph expose Share actions', () => {
  assert.match(html, /shareCoreView\('contacts'/);
  assert.match(html, /shareCoreView\('relationships'/);
});
