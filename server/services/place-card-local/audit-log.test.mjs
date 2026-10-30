import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The log writes to a directory, so each test gets its own.
process.env.GEV_AUDIT_DIR = mkdtempSync(path.join(os.tmpdir(), 'gev-audit-'));
process.env.GEV_AUDIT_SALT = 'test-salt-not-a-secret';

const {
  auditFile,
  hashQuery,
  queryKind,
  readEntries,
  record,
  tail,
  verifyChain,
} = await import('./audit-log.mjs');

test('a query is stored as a hash, never as text', async () => {
  const entry = await record({ action: 'locate', query: '+62-812-3456-7890', mode: 'target' });
  assert.match(entry.queryHash, /^q_[0-9a-f]{32}$/);
  assert.equal(entry.queryKind, 'phone');
  const raw = readFileSync(auditFile(), 'utf8');
  assert.equal(raw.includes('812-3456'), false, 'the number never reaches the disk');
  assert.equal(raw.includes('+62'), false);
});

test('the same query always hashes the same way', () => {
  assert.equal(hashQuery('+62 812 3456 7890'), hashQuery('+62 812 3456 7890'));
  assert.notEqual(hashQuery('+62 812 3456 7890'), hashQuery('+62 812 3456 7891'));
});

test('query kinds are recognised', () => {
  assert.equal(queryKind('510-10-10062-106271263'), 'cell');
  assert.equal(queryKind('+62-812-3456-7890'), 'phone');
  assert.equal(queryKind('@tolikara.desk'), 'text');
});

test('each entry carries the hash of the one before it', async () => {
  const before = readEntries().length;
  const first = await record({ action: 'locate', query: 'a', mode: 'cell' });
  const second = await record({ action: 'locate', query: 'b', mode: 'cell' });
  assert.equal(first.prevHash, readEntries()[before - 1]?.hash || 'genesis');
  assert.equal(second.prevHash, first.hash);
  assert.equal(second.seq, first.seq + 1);
});

test('the chain verifies when nothing was touched', async () => {
  await record({ action: 'locate', query: 'c', mode: 'cell' });
  const result = verifyChain();
  assert.equal(result.ok, true);
  assert.equal(result.brokenAt, null);
  assert.ok(result.entries > 0);
  assert.match(result.head, /^[0-9a-f]{64}$/);
});

test('an edited line breaks the chain at that line', async () => {
  await record({ action: 'locate', query: 'd', mode: 'cell' });
  const lines = readFileSync(auditFile(), 'utf8').split('\n').filter(Boolean);
  const victim = JSON.parse(lines[1]);
  victim.actor = 'someone-else';
  lines[1] = JSON.stringify(victim);
  writeFileSync(auditFile(), `${lines.join('\n')}\n`);
  const result = verifyChain();
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 2);
  assert.equal(result.reason, 'hash_mismatch');
});

test('a deleted line breaks the chain too', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gev-audit-del-'));
  const previous = process.env.GEV_AUDIT_DIR;
  process.env.GEV_AUDIT_DIR = dir;
  try {
    await record({ action: 'locate', query: 'e', mode: 'cell' });
    await record({ action: 'locate', query: 'f', mode: 'cell' });
    await record({ action: 'locate', query: 'g', mode: 'cell' });
    const lines = readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').split('\n').filter(Boolean);
    writeFileSync(path.join(dir, 'audit.jsonl'), `${[lines[0], lines[2]].join('\n')}\n`);
    const result = verifyChain();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'sequence_gap');
  } finally {
    process.env.GEV_AUDIT_DIR = previous;
  }
});

test('the tail is newest first and bounded', async () => {
  await record({ action: 'locate', query: 'h', mode: 'cell' });
  await record({ action: 'locate', query: 'i', mode: 'cell' });
  const entries = tail(2);
  assert.equal(entries.length, 2);
  assert.ok(entries[0].seq > entries[1].seq, 'newest first');
});
