import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { indexProject, visibleWorkItems } from '../src/index';

it('indexes the English community garden corpus adapted from the installed dummy, retaining distinct artifact families', () => {
  const root = fileURLToPath(new URL('../../../tests/fixtures/community-garden/', import.meta.url));
  const files: Record<string, string> = {};
  function walk(prefix = '') {
    for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else files[path] = readFileSync(join(root, path), 'utf8');
    }
  }
  walk();
  const before = JSON.stringify(files);
  const revisions = Object.fromEntries(
    Object.entries(files).map(([path, text]) => [
      path,
      createHash('sha256').update(text).digest('hex'),
    ]),
  );
  const index = indexProject(files, revisions),
    visible = visibleWorkItems(index);
  expect(index.name).toBe('Community Garden');
  expect(index.compatibility).toBe('6.12.0');
  expect(index.documents.length).toBeGreaterThanOrEqual(26);
  expect(index.documents.filter((doc) => doc.kind === 'prd')).toHaveLength(2);
  expect(index.documents.some((doc) => doc.kind === 'spec' && doc.derived)).toBe(true);
  expect(visible.filter((item) => item.family === 'sprint' && item.kind === 'story')).toHaveLength(
    6,
  );
  expect(
    visible.find((item) => item.family === 'sprint' && item.nativeId === '1.2')?.status?.raw,
  ).toBe('review');
  expect(
    visible.find((item) => item.kind === 'build' && item.nativeId === '1.2')?.status?.raw,
  ).toBe('done');
  expect(visible.find((item) => item.family === 'build-auto')?.status?.raw).toBe('blocked');
  expect(
    visible.find((item) => item.nativeId === '2.3' && item.family === 'sprint')?.status,
  ).toMatchObject({ raw: 'paused', valid: false });
  expect(index.workItems.filter((item) => item.family === 'spec-story')).toHaveLength(2);
  expect(index.agents.map((agent) => agent.code)).toContain('gardener');
  expect(JSON.stringify(files)).toBe(before);
});
