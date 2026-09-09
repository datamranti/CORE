const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../src/search.js');

test('Aina matches Aina by token prefix', () => {
  assert.ok(search.recordScore({ personName: 'Aina A Rahman' }, 'aina') >= 400);
});

test('Aina does not match Zainal by internal substring', () => {
  assert.equal(search.recordScore({ personName: 'Zainal' }, 'aina'), 0);
});

test('email and domain searches remain useful', () => {
  assert.ok(search.recordScore({ email: 'aina@mranti.my' }, 'aina@mranti') > 0);
  assert.ok(search.recordScore({ email: 'aina@mida.gov.my' }, 'mida') > 0);
});

test('partial numeric phone search remains supported', () => {
  assert.ok(search.recordScore({ phone: '+60 12-345 6789' }, '3456') > 0);
});

test('BM and English Search Index terms use token boundaries', () => {
  const record = { searchIndex: 'pelaburan investment pembangunan development' };
  assert.equal(search.recordScore(record, 'pelab'), 100);
  assert.equal(search.recordScore(record, 'invest'), 100);
});

test('direct MIDA organisation match outranks contextual Search Index match', () => {
  const direct = search.graphScore({ companyFull: 'Malaysian Investment Development Authority', clientShort: 'MIDA' }, 'MIDA');
  const contextual = search.graphScore({ companyFull: 'Unrelated Organisation', searchIndex: 'discussion about MIDA investment' }, 'MIDA');
  assert.ok(direct > contextual);
  assert.equal(direct, 500);
  assert.equal(contextual, 100);
});

test('meeting date wins, otherwise submission date is used, with invalid dates safe', () => {
  const meetingFirst = search.recordOrderingScore({ meetingDate: '2026-08-01', timeUploaded: '2026-09-01' });
  const inputFallback = search.recordOrderingScore({ meetingDate: 'not-a-date', timeUploaded: '2026-09-01' });
  assert.equal(meetingFirst, Date.parse('2026-08-01'));
  assert.equal(inputFallback, Date.parse('2026-09-01'));
  assert.equal(search.recordOrderingScore({ meetingDate: 'bad', timeUploaded: 'also-bad' }), 0);
});
