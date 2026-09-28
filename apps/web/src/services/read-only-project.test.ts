import { describe, expect, it, vi } from 'vitest';
import { ProjectStore } from './project-store';
import { importReadOnlyFiles, readOnlyDirectory } from './read-only-project';
import example from '../../../../examples/community-garden.json';

function selected(path: string, text: string) {
  const file = new File([text], path.split('/').at(-1)!);
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}
describe('read-only snapshots', () => {
  it('indexes the original example with stories, epics and sprint data without write capability', async () => {
    const store = new ProjectStore(readOnlyDirectory(example, 'Example'), true);
    const snapshot = await store.refresh();
    expect(snapshot.index.documents.length).toBeGreaterThan(8);
    expect(snapshot.index.workItems.length).toBeGreaterThan(3);
    await expect(store.setMode('edit')).rejects.toThrow('read-only');
    await expect(store.handle.getFileHandle('new.md', { create: true })).rejects.toThrow(
      'read-only',
    );
    await expect((await store.handle.getFileHandle('README.md')).createWritable()).rejects.toThrow(
      'read-only',
    );
    await expect(store.handle.removeEntry('README.md')).rejects.toThrow('read-only');
    await expect(store.handle.requestPermission({ mode: 'readwrite' })).resolves.toBe('denied');
  });
  it('imports selected UTF-8 files without secrets, tool paths, binary attachments or nested repositories', async () => {
    const result = await importReadOnlyFiles([
      selected('garden/docs/notes.md', '# Local only'),
      selected('garden/.env.local', 'not loaded'),
      selected('garden/.codex/settings.json', '{}'),
      selected('garden/vendor/project.md', '# Skip'),
      selected('garden/nested/.git/config', 'marker'),
      selected('garden/nested/docs/private.md', '# Skip'),
      selected('garden/image.png', 'image'),
    ]);
    const store = new ProjectStore(result.handle, true);
    expect((await store.refresh()).files).toEqual({ 'docs/notes.md': '# Local only' });
    expect(result.skipped).toBe(6);
  });
  it('rejects ambiguous, oversized and invalid paths before exposing a snapshot', async () => {
    await expect(
      importReadOnlyFiles([selected('p/a.md', 'a'), selected('p/a.md', 'b')]),
    ).rejects.toThrow('duplicate');
    await expect(
      importReadOnlyFiles([selected('p/a.md', 'x'.repeat(2 * 1024 * 1024 + 1))]),
    ).rejects.toThrow('2 MiB');
    expect(() => readOnlyDirectory({ '../escape.md': 'x' }, 'Bad')).toThrow();
    expect(() => readOnlyDirectory({ 'a.md': 'x', 'a.md/b.md': 'y' }, 'Bad')).toThrow(
      'Conflicting',
    );
  });
  it('accepts 100,000 selected files without reading excluded dependency content', async () => {
    const dependency = selected('project/node_modules/package/README.md', 'not read');
    const read = vi.spyOn(dependency, 'arrayBuffer');
    const selection = Array<File>(99_999).fill(dependency);
    selection.push(selected('project/docs/notes.md', '# Local notes'));
    const result = await importReadOnlyFiles(selection);
    expect(read).not.toHaveBeenCalled();
    expect(result.skipped).toBe(99_999);
    expect((await new ProjectStore(result.handle, true).refresh()).files).toEqual({
      'docs/notes.md': '# Local notes',
    });
  });
  it('rejects more than 100,000 selected files before reading content', async () => {
    const file = selected('project/docs/notes.md', '# Local notes');
    const read = vi.spyOn(file, 'arrayBuffer');
    await expect(importReadOnlyFiles(Array<File>(100_001).fill(file))).rejects.toThrow(
      'at most 100,000 files',
    );
    expect(read).not.toHaveBeenCalled();
  });
  it('imports and indexes more than the previous 5,000-document limit', async () => {
    const result = await importReadOnlyFiles(
      Array.from({ length: 5_001 }, (_, index) =>
        selected(`project/docs/note-${index}.md`, '# Note'),
      ),
    );
    const snapshot = await new ProjectStore(result.handle, true).refresh();
    expect(Object.keys(snapshot.files)).toHaveLength(5_001);
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.code === 'file-limit')).toBe(false);
  });
});
