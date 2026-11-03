import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, safeArtifact, startNightServer } from './night-capture-server.mjs';

test('collector allows controlled flat artifact names and refuses traversal, absolute paths and null bytes', () => {
  assert.equal(safeArtifact('arrange-neutral-string-orchestra-run-a', 'a-parts-01-Violin-I.mid'), true);
  for (const name of ['../source.mid', '/source.mid', 'parts/source.mid', 'a..mid', 'a\0.mid', 'a.js']) assert.equal(safeArtifact('safe-case', name), false);
  for (const id of ['../case', '/case', 'a\0', 'UPPER', 'a'.repeat(161)]) assert.equal(safeArtifact(id, 'a.zip'), false);
});
test('collector writes exact supplied bytes locally and rejects non-POST without a server or API request', async () => {
  const output = await mkdtemp(join(tmpdir(), 'motifold-night-collector-'));
  try {
    const response = { status: 0, writeHead(code) { this.status = code; }, end() {} };
    const request = Object.assign(Readable.from([Buffer.from('exact zip bytes')]), { url: '/__night/artifacts/local-case/a.zip', method: 'POST' });
    assert.equal(await collect(request, response, output), true); assert.equal(response.status, 204);
    assert.equal(await readFile(join(output, 'local-case/a.zip'), 'utf8'), 'exact zip bytes');
    await collect({ url: '/__night/artifacts/local-case/a.zip', method: 'GET' }, response, output); assert.equal(response.status, 400);
  } finally { await rm(output, { recursive: true, force: true }); }
});
test('matrix export freezes the exact source and102 recipes without opening a listener or calling API', async () => {
  const result = await startNightServer({ listen: false });
  assert.equal(result.recipes.length, 102); assert.equal(result.outcomes, 204);
  assert.equal(result.source.sha256, 'a8b4ee04a41ee125b8e7e042fe6c5dd3baf82fe65fd588eac6823770a9b8304f');
});
