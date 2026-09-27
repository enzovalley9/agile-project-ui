/** Temporary copies live in the browser's private filesystem, never in Git sidecars. */
export interface RecoveryCopy {
  path: string;
  before: string | null;
  after: string;
}
export class RecoveryBackups {
  private memory = new Map<string, RecoveryCopy[]>();
  private async directory(create = false) {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory)
      throw new Error('Private browser storage unavailable');
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('bmad-project-ui-recovery', { create });
  }
  async save(id: string, copies: RecoveryCopy[]): Promise<boolean> {
    this.memory.set(id, structuredClone(copies));
    try {
      const dir = await this.directory(true),
        file = await dir.getFileHandle(id + '.json', { create: true }),
        text = JSON.stringify({ schemaVersion: 1, id, copies });
      const stream = await file.createWritable();
      try {
        await stream.write(text);
        await stream.close();
      } catch (e) {
        await stream.abort().catch(() => undefined);
        throw e;
      }
      if ((await (await file.getFile()).text()) !== text)
        throw new Error('Backup verification failed');
      return true;
    } catch {
      return false;
    }
  }
  async read(id: string): Promise<{ copies: RecoveryCopy[]; persistent: boolean } | null> {
    if (!/^[\da-f-]{36}$/i.test(id)) return null;
    try {
      const file = await (await this.directory()).getFileHandle(id + '.json'),
        data = JSON.parse(await (await file.getFile()).text());
      if (data.schemaVersion !== 1 || data.id !== id || !Array.isArray(data.copies)) return null;
      return { copies: data.copies, persistent: true };
    } catch {
      const copies = this.memory.get(id);
      return copies ? { copies: structuredClone(copies), persistent: false } : null;
    }
  }
  async remove(id: string) {
    this.memory.delete(id);
    try {
      await (await this.directory()).removeEntry(id + '.json');
    } catch {
      /* A revoked private-storage permission must not turn a verified project save into failure. */
    }
  }
}
