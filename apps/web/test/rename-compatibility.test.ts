import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryDirectory } from '../../../tests/support/memory-handles';
import { getActor, loadThreads, saveActor } from '../src/services/comments';
import { loadIntegrationState } from '../src/services/integration-state';
import { contentHash, ProjectStore } from '../src/services/project-store';
import { readTheme } from '../src/hooks/use-theme';

afterEach(() => vi.unstubAllGlobals());

describe('Agile Project UI retains historical user data across the rename', () => {
  it('keeps an existing author identity and theme instead of silently creating new preferences', () => {
    const actor = { id: 'existing-author', name: 'Existing Author' };
    const values = new Map([
      ['bmad-ui:actor', JSON.stringify(actor)],
      ['bmad-project-ui.theme', 'dark'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(getActor()).toEqual(actor);
    expect(readTheme()).toBe('dark');
    saveActor({ ...actor, name: 'Updated Author' });
    expect(getActor()).toEqual({ ...actor, name: 'Updated Author' });
    expect([...values.keys()]).toEqual(['bmad-ui:actor', 'bmad-project-ui.theme']);
  });

  it('loads original comments and integration state and blocks writes until old recovery is reviewed', async () => {
    const before = '# Project\n',
      after = '# Reviewed project\n';
    const revision = await contentHash(before);
    const id = '12345678-1234-1234-1234-123456789abc';
    const at = '2026-09-27T12:00:00.000Z';
    const thread = {
      schemaVersion: 1,
      id,
      anchor: {
        path: 'docs/project.md',
        revision,
        startLine: 1,
        endLine: 1,
        quote: '# Project',
        prefix: '',
        suffix: '',
      },
      status: 'open',
      messages: [
        {
          id: 'original-message',
          author: { id: 'existing-author', name: 'Existing Author' },
          text: 'Discussion saved before the rename.',
          createdAt: at,
          reactions: [],
        },
      ],
      createdAt: at,
      updatedAt: at,
    };
    const integration = {
      schemaVersion: 1,
      projectId: 'original-project',
      bindings: [],
      bases: {},
    };
    const recovery = {
      schemaVersion: 1,
      id,
      createdAt: at,
      entries: [{ path: 'docs/project.md', before: revision, after: await contentHash(after) }],
    };
    const copies = [{ path: 'docs/project.md', before, after }];
    const project = memoryDirectory({
      '.git/config': 'project marker',
      'docs/project.md': before,
      [`.bmad-project-ui/comments/threads/${id}.json`]: JSON.stringify(thread),
      '.bmad-project-ui/integrations/jira.json': JSON.stringify(integration),
      '.bmad-project-ui/local/write-recovery.json': JSON.stringify(recovery),
    });
    const browser = memoryDirectory({
      [`bmad-project-ui-recovery/${id}.json`]: JSON.stringify({ schemaVersion: 1, id, copies }),
    });
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => browser.handle } });
    const store = new ProjectStore(project.handle);
    const snapshot = await store.refresh();
    expect(loadThreads(snapshot)).toMatchObject({ errors: [], threads: [{ thread }] });
    expect(loadIntegrationState(snapshot, 'jira').state).toEqual(integration);
    const status = await store.recoveryStatus();
    expect(status).toMatchObject({
      id,
      corrupt: false,
      backupsAvailable: true,
      backupsPersistent: true,
    });
    expect(await store.recoveryCopies()).toEqual(copies);
    await store.setMode('edit');
    await expect(store.save('docs/project.md', 'Unreviewed edit', revision)).rejects.toThrow(
      'pending save',
    );
    expect(project.state.writes).toBe(0);
    expect(browser.state.writes).toBe(0);
    await store.restoreRecovery(status!, 'after');
    expect(project.files.get('docs/project.md')).toBe(after);
    expect(project.files.has('.bmad-project-ui/local/write-recovery.json')).toBe(false);
    expect(browser.files.has(`bmad-project-ui-recovery/${id}.json`)).toBe(false);
    expect(loadThreads(await store.refresh()).threads[0].thread).toEqual(thread);
  });
});
