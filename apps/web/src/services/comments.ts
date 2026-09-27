import {
  COMMENTS_ROOT,
  createThread,
  parseThread,
  serializeThread,
  threadPath,
  updateThread,
  type Actor,
  type Anchor,
  type Thread,
  type ThreadAction,
} from '../../../../packages/comments/src/index';
import { type ProjectSnapshot, ProjectStore } from './project-store';
export * from '../../../../packages/comments/src/index';
export interface StoredThread {
  thread: Thread;
  path: string;
  revision: string;
}
export function loadThreads(snapshot: ProjectSnapshot): {
  threads: StoredThread[];
  errors: string[];
} {
  const threads: StoredThread[] = [],
    errors: string[] = [];
  for (const [path, text] of Object.entries(snapshot.files)) {
    if (!path.startsWith(COMMENTS_ROOT + '/') || !path.endsWith('.json')) continue;
    try {
      const thread = parseThread(text);
      if (path !== threadPath(thread.id)) throw new Error('The identity does not match the path.');
      threads.push({ thread, path, revision: snapshot.revisions[path] });
    } catch (e) {
      errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  threads.sort((a, b) => a.thread.createdAt.localeCompare(b.thread.createdAt));
  return { threads, errors };
}
const pendingThreads = new WeakMap<ProjectStore, Map<string, Thread>>();
export async function addThread(
  store: ProjectStore,
  anchor: Anchor,
  actor: Actor,
  text: string,
): Promise<Thread> {
  await store.assertCommentLocation();
  const key = JSON.stringify({ anchor, actor, text });
  let intents = pendingThreads.get(store);
  if (!intents) {
    intents = new Map();
    pendingThreads.set(store, intents);
  }
  const thread = intents.get(key) ?? createThread(anchor, actor, text);
  intents.set(key, thread);
  const path = threadPath(thread.id),
    serialized = serializeThread(thread);
  if ((await store.revision(path)) !== null) {
    if ((await store.read(path)) === serialized) {
      intents.delete(key);
      return thread;
    }
    throw new Error(
      'The pending thread differs from the saved file. Review recovery before creating another.',
    );
  }
  if ((await store.revision(anchor.path)) !== anchor.revision)
    throw new Error(
      'The document changed; reload it and select the lines again before commenting.',
    );
  await store.save(path, serialized, null);
  intents.delete(key);
  return thread;
}
export async function mutateThread(
  store: ProjectStore,
  stored: StoredThread,
  actor: Actor,
  action: ThreadAction,
): Promise<Thread> {
  await store.assertCommentLocation();
  if (
    action.type === 'reanchor' &&
    (await store.revision(action.anchor.path)) !== action.anchor.revision
  )
    throw new Error('The document changed; select the passage again to reanchor it.');
  const thread = updateThread(stored.thread, actor, action);
  await store.save(stored.path, serializeThread(thread), stored.revision);
  return thread;
}
export function getActor(): Actor {
  const saved = localStorage.getItem('bmad-ui:actor');
  if (saved) {
    try {
      const actor = JSON.parse(saved);
      if (
        typeof actor.id === 'string' &&
        actor.id.length > 0 &&
        typeof actor.name === 'string' &&
        actor.name.trim() &&
        actor.name.length <= 80
      )
        return { id: actor.id, name: actor.name };
    } catch {
      /* recover preference */
    }
  }
  return { id: crypto.randomUUID(), name: '' };
}
export function saveActor(actor: Actor) {
  if (!actor.name.trim()) throw new Error('Enter your name to comment.');
  localStorage.setItem('bmad-ui:actor', JSON.stringify(actor));
}
