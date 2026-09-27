import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exampleZip } from '../../scripts/build-example.mjs';
test('published example ZIP preserves exact reviewed file bytes and paths', async () => {
  const source = JSON.parse(
    await readFile(new URL('../../examples/community-garden.json', import.meta.url), 'utf8'),
  );
  const zip = exampleZip(source);
  let offset = 0;
  const actual = {};
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18),
      nameLength = zip.readUInt16LE(offset + 26);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    assert.ok(name.startsWith('community-garden/'));
    actual[name.slice('community-garden/'.length)] = zip
      .subarray(offset + 30 + nameLength, offset + 30 + nameLength + size)
      .toString();
    offset += 30 + nameLength + size;
  }
  assert.deepEqual(actual, source);
  assert.match(actual.LICENSE, /MIT License/);
  assert.match(
    actual['_bmad-output/implementation-artifacts/sprint-status.yaml'],
    /development_status/,
  );
  assert.throws(() => exampleZip({ '../evil': 'no' }));
});
