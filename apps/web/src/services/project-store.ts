import { RecoveryBackups, type RecoveryCopy } from './recovery-backups';
import {
  indexProject,
  hasMergeConflict,
  type ProjectIndex,
} from '../../../../packages/domain/src/index';

export interface StoreDiagnostic {
  code: string;
  message: string;
  path?: string;
}
export interface ProjectSnapshot {
  name: string;
  files: Record<string, string>;
  revisions: Record<string, string>;
  diagnostics: StoreDiagnostic[];
  index: ProjectIndex;
}
export interface SharedInstallationPreview {
  name: string;
  index: ProjectIndex;
}
export interface RecoveryEntry {
  path: string;
  before: string | null;
  after: string;
}
export interface RecoveryRecord {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  entries: RecoveryEntry[];
}
export interface RecoveryStatus {
  id: string;
  entries: (RecoveryEntry & { actual: string | null; state: 'original' | 'saved' | 'changed' })[];
  corrupt: boolean;
  backupsAvailable: boolean;
  backupsPersistent: boolean;
}
// Historical data-format namespace, retained across the Agile Project UI rename.
// Changing it would hide pending recovery records and split existing project state.
const recoveryPath = '.bmad-project-ui/local/write-recovery.json';
export class ProjectError extends Error {
  constructor(
    public code: string,
    message: string,
    public path?: string,
  ) {
    super(message);
  }
}
export const LIMITS = {
  files: 5000,
  depth: 20,
  bytesPerFile: 2 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
};
const excluded = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '.venv',
  'vendor',
  '.agents',
  '.codex',
  '.claude',
  '.idea',
  '.vscode',
]);
const textTypes = /\.(md|mdx|txt|yaml|yml|toml|json|csv|html|xml)$/i;
// Read only the metadata already understood by the domain adapter. An explicitly
// selected shared installation never grants a document scan of its parent tree.
const installationMetadataPaths = [
  '_bmad/_config/manifest.yaml',
  '_bmad/_config/bmad-help.csv',
  '_bmad/config.toml',
  '_bmad/config.user.toml',
  '_bmad/custom/config.toml',
  '_bmad/custom/config.user.toml',
  '_bmad/bmm/config.yaml',
  '_bmad/bmm/config.user.yaml',
  '_bmad/core/config.yaml',
  '_bmad/core/config.user.yaml',
];
export function safePath(path: string): string[] {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    /[<>:"|?*]/.test(path)
  )
    throw new ProjectError('unsafe-path', 'The path must be relative to the project.', path);
  const parts = path.split('/');
  if (
    parts.some(
      (p) =>
        !p ||
        p === '.' ||
        p === '..' ||
        excluded.has(p.toLowerCase().replace(/[ .]+$/, '')) ||
        /^\.env(?:\.|$)/i.test(p) ||
        /^(secrets?|\.secrets)$/i.test(p) ||
        /\.(pem|key|p12|pfx|keystore)$/i.test(p),
    )
  )
    throw new ProjectError('unsafe-path', 'This path is outside the document scope.', path);
  return parts;
}
export async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
/** Only browser-authorized handles access document bytes. No connector fallback. */
export class ProjectStore {
  mode: 'read' | 'edit' = 'read';
  readonly name: string;
  private saving = false;
  private queuedMutations = 0;
  get mutationPending() {
    return this.queuedMutations > 0 || this.saving;
  }
  private lastSnapshot?: ProjectSnapshot;
  private additionalRoots: string[] = [];
  private sharedInstallation?: {
    handle: FileSystemDirectoryHandle;
    projectRelativePath: string;
  };
  get sharedInstallationName(): string | undefined {
    return this.sharedInstallation?.handle.name;
  }
  private recovery: RecoveryRecord | null = null;
  private backups = new RecoveryBackups();
  private corruptRecovery = false;
  private mutationGuard?: () => Promise<void>;
  get recoveryPending() {
    return this.recovery !== null || this.corruptRecovery;
  }
  setMutationGuard(guard?: () => Promise<void>) {
    this.mutationGuard = guard;
  }
  private async assertMutation() {
    if (this.recoveryPending)
      throw new ProjectError(
        'recovery-pending',
        'Review the pending save before modifying files again.',
      );
    await this.mutationGuard?.();
  }
  private async assertConflictFree(path: string, proposed: string) {
    let current = '';
    try {
      current = await this.read(path);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
    if (hasMergeConflict(current) || hasMergeConflict(proposed))
      throw new ProjectError(
        'merge-conflict',
        'The file contains conflict markers. Resolve them with Git or your editor and reload the files before saving.',
        path,
      );
  }
  private async loadRecovery() {
    try {
      const text = await this.read(recoveryPath);
      const record = JSON.parse(text) as RecoveryRecord;
      if (
        record.schemaVersion !== 1 ||
        typeof record.id !== 'string' ||
        !Array.isArray(record.entries) ||
        !record.entries.length
      )
        throw new Error('invalid');
      for (const entry of record.entries) {
        safePath(entry.path);
        if (
          entry.path === recoveryPath ||
          !(entry.before === null || /^[a-f0-9]{64}$/.test(entry.before)) ||
          !/^[a-f0-9]{64}$/.test(entry.after)
        )
          throw new Error('invalid');
      }
      this.recovery = record;
      this.corruptRecovery = false;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') {
        this.recovery = null;
        this.corruptRecovery = false;
      } else this.corruptRecovery = true;
    }
  }
  async recoveryStatus(): Promise<RecoveryStatus | null> {
    await this.loadRecovery();
    if (!this.recoveryPending) return null;
    const entries = await Promise.all(
      (this.recovery?.entries ?? []).map(async (entry) => {
        const actual = await this.revision(entry.path);
        return {
          ...entry,
          actual,
          state:
            actual === entry.after
              ? ('saved' as const)
              : actual === entry.before
                ? ('original' as const)
                : ('changed' as const),
        };
      }),
    );
    const copies = await this.validRecoveryCopies();
    return {
      id: this.recovery?.id ?? 'unreadable',
      entries,
      corrupt: this.corruptRecovery,
      backupsAvailable: !!copies,
      backupsPersistent: copies?.persistent ?? false,
    };
  }
  private async validRecoveryCopies() {
    if (!this.recovery) return null;
    const result = await this.backups.read(this.recovery.id);
    if (!result || result.copies.length !== this.recovery.entries.length) return null;
    for (let i = 0; i < result.copies.length; i++) {
      const copy = result.copies[i],
        entry = this.recovery.entries[i];
      if (
        !copy ||
        copy.path !== entry.path ||
        typeof copy.after !== 'string' ||
        !(copy.before === null || typeof copy.before === 'string') ||
        (await contentHash(copy.after)) !== entry.after ||
        (copy.before === null ? null : await contentHash(copy.before)) !== entry.before
      )
        return null;
    }
    return result;
  }
  async recoveryCopies(): Promise<RecoveryCopy[] | null> {
    await this.loadRecovery();
    return (await this.validRecoveryCopies())?.copies ?? null;
  }
  async restoreRecovery(reviewed: RecoveryStatus, version: 'before' | 'after') {
    return this.lock(async () => {
      if (this.mode !== 'edit')
        throw new ProjectError('read-only', 'Enable Editor mode to restore files.');
      const current = await this.recoveryStatus();
      if (!current || JSON.stringify(current) !== JSON.stringify(reviewed))
        throw new ProjectError('stale-recovery', 'The files changed after review.');
      if (current.entries.some((entry) => entry.state === 'changed'))
        throw new ProjectError(
          'external-recovery-change',
          'External changes occurred after the interrupted save. Export the copies and review the files before restoring; that version will not be overwritten.',
        );
      const result = await this.validRecoveryCopies();
      if (!result)
        throw new ProjectError(
          'backup-unavailable',
          'No verifiable private copies are available in this browser.',
        );
      if (version === 'before' && result.copies.some((copy) => copy.before === null))
        throw new ProjectError(
          'new-file-recovery',
          'This plan created a new file. Export the copies and review that file before removing it manually.',
        );
      await this.mutationGuard?.();
      for (let i = 0; i < result.copies.length; i++) {
        const copy = result.copies[i];
        await this.saveUnlocked(copy.path, copy[version]!, current.entries[i].actual);
      }
      await this.clearRecovery();
    });
  }
  async reconcileRecovery(reviewed: RecoveryStatus) {
    return this.lock(async () => {
      if (this.mode !== 'edit')
        throw new ProjectError('read-only', 'Enable Editor mode before confirming recovery.');
      const current = await this.recoveryStatus();
      if (!current || current.corrupt)
        throw new ProjectError(
          'corrupt-recovery',
          'The recovery record is unreadable. Keep a copy and review it externally before removing it.',
        );
      if (JSON.stringify(current) !== JSON.stringify(reviewed))
        throw new ProjectError(
          'stale-recovery',
          'The files changed after the recovery review. Check them again.',
        );
      await this.mutationGuard?.();
      await this.clearRecovery();
    });
  }
  private async clearRecovery() {
    let dir = this.handle;
    for (const part of safePath(recoveryPath).slice(0, -1))
      dir = await dir.getDirectoryHandle(part);
    await dir.removeEntry('write-recovery.json');
    if (this.recovery) await this.backups.remove(this.recovery.id);
    this.recovery = null;
    this.corruptRecovery = false;
  }
  private async prepareRecovery(entries: RecoveryEntry[], copies: RecoveryCopy[]) {
    this.recovery = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entries,
    };
    await this.backups.save(this.recovery.id, copies);
    const text = JSON.stringify(this.recovery, null, 2) + '\n';
    let stream: FileSystemWritableFileStream | undefined;
    try {
      stream = await (await this.file(recoveryPath, true)).createWritable();
      await stream.write(text);
      await stream.close();
      stream = undefined;
      if ((await this.read(recoveryPath)) !== text)
        throw new Error('The recovery record could not be verified.');
    } catch (e) {
      if (stream) await stream.abort().catch(() => undefined);
      throw e;
    }
  }
  constructor(
    readonly handle: FileSystemDirectoryHandle,
    readonly readOnly = false,
  ) {
    this.name = handle.name;
  }
  static async pick(): Promise<ProjectStore> {
    if (!('showDirectoryPicker' in window))
      throw new ProjectError(
        'unsupported-browser',
        'Open the project in desktop Chrome or Edge to access the original folder.',
      );
    const handle = await window.showDirectoryPicker({ mode: 'read', id: 'bmad-project' });
    return new ProjectStore(handle);
  }
  static async pickInstallation(): Promise<ProjectStore> {
    if (!('showDirectoryPicker' in window))
      throw new ProjectError(
        'unsupported-browser',
        'Open the installation in desktop Chrome or Edge.',
      );
    const handle = await window.showDirectoryPicker({ mode: 'read', id: 'bmad-installation' });
    try {
      await handle.getDirectoryHandle('_bmad');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      throw new ProjectError(
        'installation-absent',
        'Select the parent folder that contains the _bmad installation.',
      );
    }
    return new ProjectStore(handle);
  }
  private async installationFiles(): Promise<Record<string, string>> {
    const files: Record<string, string> = Object.create(null);
    for (const path of installationMetadataPaths) {
      try {
        files[path] = await this.read(path);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') continue;
        throw error;
      }
    }
    return files;
  }
  async previewInstallation(): Promise<SharedInstallationPreview> {
    await this.handle.getDirectoryHandle('_bmad');
    const index = indexProject(await this.installationFiles(), {}, { projectName: this.name });
    return { name: this.name, index };
  }
  static async pickChildProject(installation: ProjectStore): Promise<ProjectStore> {
    if (installation.readOnly)
      throw new ProjectError('read-only', 'Select an original installation folder.');
    const handle = await window.showDirectoryPicker({ mode: 'read', id: 'bmad-project-child' });
    const relative = await installation.handle.resolve(handle);
    if (!relative?.length)
      throw new ProjectError(
        'outside-installation',
        'Select a project folder inside the chosen BMAD installation folder.',
      );
    const projectRelativePath = relative.join('/');
    safePath(projectRelativePath);
    const project = new ProjectStore(handle);
    project.sharedInstallation = { handle: installation.handle, projectRelativePath };
    return project;
  }
  async attachSharedInstallation(): Promise<void> {
    if (this.readOnly)
      throw new ProjectError('read-only', 'Open the original project folder first.');
    const installation = await ProjectStore.pickInstallation();
    const relative = await installation.handle.resolve(this.handle);
    if (!relative?.length)
      throw new ProjectError(
        'outside-installation',
        'Select an installation folder that contains this project folder.',
      );
    const projectRelativePath = relative.join('/');
    safePath(projectRelativePath);
    // Do not retain the shared handle until a valid metadata read has succeeded.
    await installation.installationFiles();
    this.sharedInstallation = { handle: installation.handle, projectRelativePath };
  }
  async setMode(mode: 'read' | 'edit') {
    if (mode === 'edit' && this.readOnly)
      throw new ProjectError(
        'read-only',
        'This snapshot is read-only. Open the original folder in desktop Chrome or Edge to edit.',
      );
    if (this.saving) throw new ProjectError('busy', 'Wait for the save to finish.');
    if (
      mode === 'edit' &&
      (await this.handle.requestPermission({ mode: 'readwrite' })) !== 'granted'
    )
      throw new ProjectError(
        'permission-denied',
        'Write permission was not granted. Your draft is preserved.',
      );
    this.mode = mode;
  }
  private async file(path: string, create = false): Promise<FileSystemFileHandle> {
    const parts = safePath(path);
    let dir = this.handle;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
    return dir.getFileHandle(parts.at(-1)!, { create });
  }
  async read(path: string): Promise<string> {
    const file = await (await this.file(path)).getFile();
    if (file.size > LIMITS.bytesPerFile)
      throw new ProjectError('file-too-large', 'The file exceeds the 2 MiB limit.', path);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      await file.arrayBuffer(),
    );
  }
  async readImage(path: string): Promise<Blob> {
    const parts = safePath(path);
    const snapshot = this.lastSnapshot;
    const outside = () =>
      new ProjectError(
        'image-outside-scope',
        'The image is outside the authorized document roots.',
        path,
      );
    if (
      !snapshot ||
      parts.some((part) => part.startsWith('.')) ||
      !snapshot.index.roots.some(
        (root) => root.exists && (!root.path || path.startsWith(root.path + '/')),
      ) ||
      snapshot.diagnostics.some(
        (d) =>
          d.code === 'nested-repository' &&
          d.path &&
          (path === d.path || path.startsWith(d.path + '/')),
      )
    )
      throw outside();
    // The inventory may be partial or stale. Check every live ancestor, including
    // a worktree's .git file, without reading the marker or relying on diagnostics.
    const ancestors: FileSystemDirectoryHandle[] = [];
    let dir = this.handle;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part);
      ancestors.push(dir);
    }
    const assertNoNestedRepository = async () => {
      for (const ancestor of ancestors)
        for (const kind of ['directory', 'file'] as const) {
          try {
            if (kind === 'directory') await ancestor.getDirectoryHandle('.git');
            else await ancestor.getFileHandle('.git');
          } catch (error) {
            if (error instanceof DOMException && error.name === 'NotFoundError') continue;
            if (error instanceof DOMException && error.name === 'TypeMismatchError')
              throw outside();
            throw error;
          }
          throw outside();
        }
    };
    await assertNoNestedRepository();
    const file = await (await dir.getFileHandle(parts.at(-1)!)).getFile();
    if (file.size > 8 * 1024 * 1024)
      throw new ProjectError('image-too-large', 'The image exceeds the 8 MiB limit.', path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await assertNoNestedRepository();
    const ascii = (start: number, end: number) =>
      String.fromCharCode(...bytes.subarray(start, end));
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
    const mime = png
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'image/jpeg'
        : ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
          ? 'image/gif'
          : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
            ? 'image/webp'
            : null;
    if (!mime)
      throw new ProjectError(
        'unsupported-image',
        'Preview supports PNG, JPEG, GIF, and WebP. SVG and other formats are kept as references.',
        path,
      );
    return new Blob([bytes], { type: mime });
  }
  async addDocumentationFolder(): Promise<void> {
    if (this.readOnly)
      throw new ProjectError('read-only', 'Import a new snapshot to change its scope.');
    const selected = await window.showDirectoryPicker({ mode: 'read', id: 'bmad-documentation' });
    const relative = await this.handle.resolve(selected);
    if (!relative?.length)
      throw new ProjectError(
        'outside-project',
        'Select a document folder within the current project.',
      );
    const path = relative.join('/');
    safePath(path);
    if (!this.additionalRoots.includes(path)) this.additionalRoots.push(path);
  }
  async revision(path: string): Promise<string | null> {
    try {
      return await contentHash(await this.read(path));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return null;
      throw e;
    }
  }
  async refresh(): Promise<ProjectSnapshot> {
    await this.loadRecovery();
    let localInstallationPresent = false;
    try {
      await this.handle.getDirectoryHandle('_bmad');
      localInstallationPresent = true;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
    const files: Record<string, string> = Object.create(null),
      revisions: Record<string, string> = Object.create(null);
    const diagnostics: StoreDiagnostic[] = [];
    let count = 0,
      total = 0,
      unsupportedCount = 0;
    const unsupportedPaths: string[] = [];
    let stopped = false;
    const walk = async (
      dir: FileSystemDirectoryHandle,
      prefix: string,
      depth: number,
    ): Promise<void> => {
      if (depth > LIMITS.depth) {
        diagnostics.push({
          code: 'depth-limit',
          path: prefix,
          message: 'The depth limit was reached; the inventory is partial.',
        });
        return;
      }
      for await (const [name, entry] of dir.entries()) {
        if (stopped) return;
        const path = prefix ? `${prefix}/${name}` : name;
        if (path === '.bmad-project-ui/local') continue;
        try {
          safePath(path);
        } catch {
          continue;
        }
        if (name.startsWith('.') && !['.bmad-project-ui', '.memlog.md'].includes(name)) continue;
        // Installation content is data only; do not scan executable skills/scripts.
        if (
          prefix === '_bmad' &&
          entry.kind === 'directory' &&
          !['_config', 'bmm', 'core', 'custom'].includes(name)
        )
          continue;
        if (prefix.startsWith('_bmad/') && entry.kind === 'directory') continue;
        if (entry.kind === 'directory') {
          const child = entry as FileSystemDirectoryHandle;
          let nestedRepository = false;
          try {
            await child.getDirectoryHandle('.git');
            nestedRepository = true;
          } catch {
            /* may be a worktree marker file */
          }
          if (!nestedRepository) {
            try {
              await child.getFileHandle('.git');
              nestedRepository = true;
            } catch {
              /* ordinary directory */
            }
          }
          if (nestedRepository) {
            diagnostics.push({
              code: 'nested-repository',
              path,
              message: 'Nested repository skipped. Open it as a separate project.',
            });
            continue;
          }
          await walk(child, path, depth + 1);
          continue;
        }
        if (!textTypes.test(name)) {
          unsupportedCount++;
          if (unsupportedPaths.length < 20) unsupportedPaths.push(path);
          continue;
        }
        if (++count > LIMITS.files) {
          stopped = true;
          diagnostics.push({
            code: 'file-limit',
            message: 'The file limit was reached; the inventory is partial.',
          });
          return;
        }
        try {
          const f = await (entry as FileSystemFileHandle).getFile();
          if (f.size > LIMITS.bytesPerFile || total + f.size > LIMITS.totalBytes) {
            diagnostics.push({
              code: 'size-limit',
              path,
              message: 'File skipped because of the size limit; the inventory is partial.',
            });
            continue;
          }
          const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
            await f.arrayBuffer(),
          );
          if (text.includes('\0')) {
            diagnostics.push({
              code: 'binary-file',
              path,
              message: 'Binary file cannot be displayed as text.',
            });
            continue;
          }
          total += f.size;
          files[path] = text;
          revisions[path] = await contentHash(text);
        } catch (e) {
          diagnostics.push({ code: 'read-error', path, message: message(e) });
        }
      }
    };
    try {
      await walk(this.handle, '', 0);
    } catch (e) {
      throw new ProjectError('permission-lost', `Could not reload the folder: ${message(e)}`);
    }
    const sharedInstallation = this.sharedInstallation
      ? {
          files: await new ProjectStore(this.sharedInstallation.handle).installationFiles(),
          projectRelativePath: this.sharedInstallation.projectRelativePath,
        }
      : undefined;
    const index = indexProject(files, revisions, {
      projectName: this.name,
      additionalRoots: this.additionalRoots,
      sharedInstallation,
      localInstallationPresent,
    });
    if (unsupportedCount)
      diagnostics.push({
        code: 'unsupported-formats',
        message: `${unsupportedCount} files are outside the text inventory. Attachments are not edited as documents: ${unsupportedPaths.join(', ')}${unsupportedCount > unsupportedPaths.length ? '…' : ''}`,
      });
    if (diagnostics.length) {
      index.coverage.partial = true;
      index.coverage.exclusions.push(
        ...diagnostics.map((d) => [d.code, d.path].filter(Boolean).join(': ')),
      );
    }
    this.lastSnapshot = { name: this.name, files, revisions, diagnostics, index };
    return this.lastSnapshot;
  }
  async assertCommentLocation(): Promise<void> {
    const snapshot = this.lastSnapshot ?? (await this.refresh());
    const insideOutput = snapshot.index.roots.some(
      (root) =>
        root.role === 'output' &&
        (root.path === '.' ||
          root.path === '' ||
          '.bmad-project-ui'.startsWith(root.path + '/') ||
          root.path === '.bmad-project-ui'),
    );
    let projectRoot = false;
    for (const marker of ['_bmad', '.git']) {
      try {
        await this.handle.getDirectoryHandle(marker);
        projectRoot = true;
      } catch {
        /* worktree may have a .git file */
      }
    }
    if (!projectRoot) {
      try {
        await this.handle.getFileHandle('.git');
        projectRoot = true;
      } catch {
        /* no root marker */
      }
    }
    if (!projectRoot || insideOutput || this.name === '_bmad-output')
      throw new ProjectError(
        'comment-location',
        'Select the project root to save comments outside BMAD output folders.',
      );
  }
  async withProjectLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.lock(fn);
  }
  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    // Cross-tab exclusion supplements optimistic revision checks. External editors
    // cannot participate: the revision is rechecked immediately before close.
    if (typeof navigator !== 'undefined' && navigator.locks)
      return navigator.locks.request(`bmad-project:${this.name}`, { mode: 'exclusive' }, fn);
    return fn();
  }
  async save(path: string, text: string, expectedRevision: string | null): Promise<void> {
    this.queuedMutations++;
    try {
      return await this.lock(async () => {
        await this.loadRecovery();
        await this.assertMutation();
        if ((await this.handle.queryPermission({ mode: 'readwrite' })) !== 'granted')
          throw new ProjectError(
            'permission-denied',
            'Write permission was lost. Your draft is preserved.',
          );
        if (this.mode !== 'edit')
          throw new ProjectError('read-only', 'Enable Editor mode before saving.', path);
        if ((await this.revision(path)) !== expectedRevision)
          throw new ProjectError(
            'stale-revision',
            'The file changed on disk. Your draft is preserved.',
            path,
          );
        await this.assertConflictFree(path, text);
        safePath(path);
        if (path === recoveryPath)
          throw new ProjectError('unsafe-path', 'The recovery record is internal.');
        if (new TextEncoder().encode(text).byteLength > LIMITS.bytesPerFile)
          throw new ProjectError('file-too-large', 'The draft exceeds the 2 MiB limit.');
        await this.prepareRecovery(
          [{ path, before: expectedRevision, after: await contentHash(text) }],
          [{ path, before: expectedRevision === null ? null : await this.read(path), after: text }],
        );
        await this.saveUnlocked(path, text, expectedRevision);
        await this.clearRecovery();
      });
    } finally {
      this.queuedMutations--;
    }
  }
  /** Remove only a verified connection marker; never a general delete API. */
  async removeTransientBinding(path: string): Promise<void> {
    if (
      this.mode !== 'edit' ||
      !/^\.bmad-project-ui\/local\/git-bindings\/[a-zA-Z0-9-]+\.json$/.test(path)
    )
      throw new ProjectError(
        'unsafe-path',
        'Only the temporary binding marker can be removed.',
        path,
      );
    const parts = safePath(path);
    let dir = this.handle;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    await dir.removeEntry(parts.at(-1)!);
  }
  private async saveUnlocked(path: string, text: string, expectedRevision: string | null) {
    safePath(path);
    if (path === recoveryPath)
      throw new ProjectError('unsafe-path', 'The recovery record is internal.', path);
    if (this.mode !== 'edit')
      throw new ProjectError('read-only', 'Enable Editor mode before saving.', path);
    if (this.saving)
      throw new ProjectError('busy', 'Another save is in progress. Your draft is preserved.', path);
    if (new TextEncoder().encode(text).byteLength > LIMITS.bytesPerFile)
      throw new ProjectError('file-too-large', 'The draft exceeds the 2 MiB limit.', path);
    this.saving = true;
    let stream: FileSystemWritableFileStream | undefined;
    try {
      if ((await this.handle.queryPermission({ mode: 'readwrite' })) !== 'granted')
        throw new ProjectError(
          'permission-denied',
          'Write permission was lost. Your draft is preserved.',
          path,
        );
      if ((await this.revision(path)) !== expectedRevision)
        throw new ProjectError(
          'stale-revision',
          'The file changed on disk. Review the differences before saving; your draft is preserved.',
          path,
        );
      await this.assertConflictFree(path, text);
      await this.mutationGuard?.();
      const target = await this.file(path, expectedRevision === null);
      stream = await target.createWritable({ keepExistingData: false });
      await stream.write(text);
      const currentRevision = await this.revision(path);
      const emptyCreated = expectedRevision === null && currentRevision === (await contentHash(''));
      if (currentRevision !== expectedRevision && !emptyCreated)
        throw new ProjectError(
          'stale-revision',
          'The file changed during the save. Your draft is preserved.',
          path,
        );
      await this.mutationGuard?.();
      await stream.close();
      stream = undefined;
      if ((await this.revision(path)) !== (await contentHash(text)))
        throw new ProjectError(
          'verification-failed',
          'The saved content could not be verified. Reload the file before continuing.',
          path,
        );
    } catch (e) {
      if (stream) await stream.abort().catch(() => undefined);
      throw e;
    } finally {
      this.saving = false;
    }
  }
  async applyChanges(
    changes: { path: string; before: string; after: string; expectedRevision: string }[],
  ) {
    if (!changes.length) return;
    this.queuedMutations++;
    try {
      return await this.lock(async () => {
        await this.loadRecovery();
        await this.assertMutation();
        if ((await this.handle.queryPermission({ mode: 'readwrite' })) !== 'granted')
          throw new ProjectError(
            'permission-denied',
            'Write permission was lost. Your draft is preserved.',
          );
        if (this.mode !== 'edit')
          throw new ProjectError('read-only', 'Enable Editor mode before saving.');
        if (new Set(changes.map((c) => c.path)).size !== changes.length)
          throw new ProjectError('duplicate-path', 'The plan contains a duplicate file.');
        for (const change of changes)
          if (
            (await this.revision(change.path)) !== change.expectedRevision ||
            (await this.read(change.path)) !== change.before
          )
            throw new ProjectError(
              'stale-revision',
              'The plan no longer matches the files. Review the change again.',
              change.path,
            );
        for (const change of changes) {
          safePath(change.path);
          await this.assertConflictFree(change.path, change.after);
        }
        await this.prepareRecovery(
          await Promise.all(
            changes.map(async (c) => ({
              path: c.path,
              before: c.expectedRevision,
              after: await contentHash(c.after),
            })),
          ),
          changes.map((c) => ({ path: c.path, before: c.before, after: c.after })),
        );
        const saved: string[] = [];
        try {
          for (const change of changes) {
            await this.saveUnlocked(change.path, change.after, change.expectedRevision);
            saved.push(change.path);
          }
          await this.clearRecovery();
        } catch (e) {
          throw new ProjectError(
            'partial-save',
            `Save interrupted. Verified files: ${saved.join(', ') || 'none'}. ${message(e)}`,
          );
        }
      });
    } finally {
      this.queuedMutations--;
    }
  }
}
