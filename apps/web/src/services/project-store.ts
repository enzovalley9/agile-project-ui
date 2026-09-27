import {RecoveryBackups,type RecoveryCopy} from './recovery-backups';
import { indexProject, type ProjectIndex } from '../../../../packages/domain/src/index';

export interface StoreDiagnostic { code: string; message: string; path?: string }
export interface ProjectSnapshot {
  name: string;
  files: Record<string, string>;
  revisions: Record<string, string>;
  diagnostics: StoreDiagnostic[];
  index: ProjectIndex;
}
export interface RecoveryEntry {path:string;before:string|null;after:string}
export interface RecoveryRecord {schemaVersion:1;id:string;createdAt:string;entries:RecoveryEntry[]}
export interface RecoveryStatus {id:string;entries:(RecoveryEntry & {actual:string|null;state:'original'|'saved'|'changed'})[];corrupt:boolean;backupsAvailable:boolean;backupsPersistent:boolean}
const recoveryPath='.bmad-project-ui/local/write-recovery.json';
export class ProjectError extends Error {
  constructor(public code: string, message: string, public path?: string) { super(message); }
}
export const LIMITS = { files: 5000, depth: 20, bytesPerFile: 2 * 1024 * 1024, totalBytes: 32 * 1024 * 1024 };
const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache', '.venv', 'vendor', '.agents', '.codex', '.claude', '.idea', '.vscode']);
const textTypes = /\.(md|mdx|txt|yaml|yml|toml|json|csv|html|xml)$/i;
export function safePath(path: string): string[] {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || /[<>:"|?*]/.test(path)) throw new ProjectError('unsafe-path', 'La ruta debe ser relativa al proyecto.', path);
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || excluded.has(p.toLowerCase().replace(/[ .]+$/,'')) || /^\.env(?:\.|$)/i.test(p) || /^(secrets?|\.secrets)$/i.test(p) || /\.(pem|key|p12|pfx|keystore)$/i.test(p))) throw new ProjectError('unsafe-path', 'Esta ruta queda fuera del ámbito documental.', path);
  return parts;
}
export async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
/** Only browser-authorized handles access document bytes. No connector fallback. */
export class ProjectStore {
  mode: 'read' | 'edit' = 'read';
  readonly name: string;
  private saving = false;
  private queuedMutations=0;
  get mutationPending(){return this.queuedMutations>0||this.saving;}
  private lastSnapshot?: ProjectSnapshot;
  private additionalRoots: string[] = [];
  private recovery: RecoveryRecord | null = null;
  private backups=new RecoveryBackups();
  private corruptRecovery = false;
  private mutationGuard?: () => Promise<void>;
  get recoveryPending(){return this.recovery!==null||this.corruptRecovery;}
  setMutationGuard(guard?:()=>Promise<void>){this.mutationGuard=guard;}
  private async assertMutation(){if(this.recoveryPending)throw new ProjectError('recovery-pending','Revisa el guardado pendiente antes de volver a modificar archivos.');await this.mutationGuard?.();}
  private async loadRecovery(){
    try{const text=await this.read(recoveryPath);const record=JSON.parse(text) as RecoveryRecord;
      if(record.schemaVersion!==1||typeof record.id!=='string'||!Array.isArray(record.entries)||!record.entries.length)throw new Error('invalid');
      for(const entry of record.entries){safePath(entry.path);if(entry.path===recoveryPath||!(entry.before===null||/^[a-f0-9]{64}$/.test(entry.before))||!/^[a-f0-9]{64}$/.test(entry.after))throw new Error('invalid');}
      this.recovery=record;this.corruptRecovery=false;
    }catch(e){if(e instanceof DOMException&&e.name==='NotFoundError'){this.recovery=null;this.corruptRecovery=false;}else this.corruptRecovery=true;}
  }
  async recoveryStatus():Promise<RecoveryStatus|null>{
    await this.loadRecovery();if(!this.recoveryPending)return null;
    const entries=await Promise.all((this.recovery?.entries??[]).map(async entry=>{const actual=await this.revision(entry.path);return {...entry,actual,state:actual===entry.after?'saved' as const:actual===entry.before?'original' as const:'changed' as const};}));
    const copies=await this.validRecoveryCopies();
    return {id:this.recovery?.id??'unreadable',entries,corrupt:this.corruptRecovery,backupsAvailable:!!copies,backupsPersistent:copies?.persistent??false};
  }
  private async validRecoveryCopies(){
    if(!this.recovery)return null;const result=await this.backups.read(this.recovery.id);if(!result||result.copies.length!==this.recovery.entries.length)return null;
    for(let i=0;i<result.copies.length;i++){const copy=result.copies[i],entry=this.recovery.entries[i];if(!copy||copy.path!==entry.path||typeof copy.after!=='string'||!(copy.before===null||typeof copy.before==='string')||await contentHash(copy.after)!==entry.after||(copy.before===null?null:await contentHash(copy.before))!==entry.before)return null;}
    return result;
  }
  async recoveryCopies():Promise<RecoveryCopy[]|null>{await this.loadRecovery();return (await this.validRecoveryCopies())?.copies??null;}
  async restoreRecovery(reviewed:RecoveryStatus,version:'before'|'after'){
    return this.lock(async()=>{
      if(this.mode!=='edit')throw new ProjectError('read-only','Activa Editor para restaurar.');
      const current=await this.recoveryStatus();if(!current||JSON.stringify(current)!==JSON.stringify(reviewed))throw new ProjectError('stale-recovery','Los archivos cambiaron después de la revisión.');
      if(current.entries.some(entry=>entry.state==='changed'))throw new ProjectError('external-recovery-change','Hay cambios externos posteriores al guardado interrumpido. Exporta las copias y revisa los archivos antes de restaurar; no se sobrescribirá esa versión.');
      const result=await this.validRecoveryCopies();if(!result)throw new ProjectError('backup-unavailable','No hay copias privadas verificables en este navegador.');
      if(version==='before'&&result.copies.some(copy=>copy.before===null))throw new ProjectError('new-file-recovery','Este plan creó un archivo nuevo. Exporta las copias y revisa ese archivo antes de retirarlo manualmente.');
      await this.mutationGuard?.();
      for(let i=0;i<result.copies.length;i++){const copy=result.copies[i];await this.saveUnlocked(copy.path,copy[version]!,current.entries[i].actual);}
      await this.clearRecovery();
    });
  }
  async reconcileRecovery(reviewed:RecoveryStatus){
    return this.lock(async()=>{if(this.mode!=='edit')throw new ProjectError('read-only','Activa Editor antes de confirmar la recuperación.');
      const current=await this.recoveryStatus();if(!current||current.corrupt)throw new ProjectError('corrupt-recovery','El registro de recuperación no es legible. Conserva una copia y revísalo externamente antes de retirarlo.');
      if(JSON.stringify(current)!==JSON.stringify(reviewed))throw new ProjectError('stale-recovery','Los archivos cambiaron después de revisar la recuperación. Vuelve a comprobarlos.');
      await this.mutationGuard?.();await this.clearRecovery();
    });
  }
  private async clearRecovery(){let dir=this.handle;for(const part of safePath(recoveryPath).slice(0,-1))dir=await dir.getDirectoryHandle(part);await dir.removeEntry('write-recovery.json');if(this.recovery)await this.backups.remove(this.recovery.id);this.recovery=null;this.corruptRecovery=false;}
  private async prepareRecovery(entries:RecoveryEntry[],copies:RecoveryCopy[]){
    this.recovery={schemaVersion:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),entries};
    await this.backups.save(this.recovery.id,copies);
    const text=JSON.stringify(this.recovery,null,2)+'\n';let stream:FileSystemWritableFileStream|undefined;
    try{stream=await (await this.file(recoveryPath,true)).createWritable();await stream.write(text);await stream.close();stream=undefined;if(await this.read(recoveryPath)!==text)throw new Error('No se pudo verificar el registro de recuperación.');}
    catch(e){if(stream)await stream.abort().catch(()=>undefined);throw e;}
  }
  constructor(readonly handle: FileSystemDirectoryHandle) { this.name = handle.name; }
  static async pick(): Promise<ProjectStore> {
    if (!('showDirectoryPicker' in window)) throw new ProjectError('unsupported-browser', 'Abre el proyecto en Chrome o Edge de escritorio para acceder a la carpeta original.');
    const handle = await window.showDirectoryPicker({ mode: 'read', id: 'bmad-project' });
    return new ProjectStore(handle);
  }
  async setMode(mode: 'read' | 'edit') {
    if (this.saving) throw new ProjectError('busy', 'Espera a que termine el guardado.');
    if (mode === 'edit' && await this.handle.requestPermission({mode: 'readwrite'}) !== 'granted') throw new ProjectError('permission-denied', 'No se ha concedido permiso de escritura. El borrador se conserva.');
    this.mode = mode;
  }
  private async file(path: string, create = false): Promise<FileSystemFileHandle> {
    const parts = safePath(path); let dir = this.handle;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, {create});
    return dir.getFileHandle(parts.at(-1)!, {create});
  }
  async read(path: string): Promise<string> {
    const file = await (await this.file(path)).getFile();
    if (file.size > LIMITS.bytesPerFile) throw new ProjectError('file-too-large', 'El archivo supera el límite de 2 MiB.', path);
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
  }
  async readImage(path:string):Promise<Blob> {
    safePath(path);
    const snapshot=this.lastSnapshot;
    if(!snapshot||path.startsWith('.bmad-project-ui/')||!snapshot.index.roots.some(root=>root.exists&&(!root.path||path.startsWith(root.path+'/')))||snapshot.diagnostics.some(d=>d.code==='nested-repository'&&d.path&&(path===d.path||path.startsWith(d.path+'/'))))throw new ProjectError('image-outside-scope','La imagen queda fuera de las raíces documentales autorizadas.',path);
    const file=await(await this.file(path)).getFile();
    if(file.size>8*1024*1024)throw new ProjectError('image-too-large','La imagen supera el límite de 8 MiB.',path);
    const bytes=new Uint8Array(await file.arrayBuffer());
    const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.subarray(start,end));
    const png=[137,80,78,71,13,10,26,10].every((value,i)=>bytes[i]===value);
    const mime=png?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':['GIF87a','GIF89a'].includes(ascii(0,6))?'image/gif':ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'?'image/webp':null;
    if(!mime)throw new ProjectError('unsupported-image','Vista previa disponible para PNG, JPEG, GIF y WebP. SVG y otros formatos se conservan como referencias.',path);
    return new Blob([bytes],{type:mime});
  }
  async addDocumentationFolder(): Promise<void> {
    const selected=await window.showDirectoryPicker({mode:'read',id:'bmad-documentation'});
    const relative=await this.handle.resolve(selected);
    if(!relative?.length) throw new ProjectError('outside-project','Selecciona una carpeta documental dentro del proyecto actual.');
    const path=relative.join('/');safePath(path);
    if(!this.additionalRoots.includes(path))this.additionalRoots.push(path);
  }
  async revision(path: string): Promise<string | null> {
    try { return await contentHash(await this.read(path)); } catch (e) { if (e instanceof DOMException && e.name === 'NotFoundError') return null; throw e; }
  }
  async refresh(): Promise<ProjectSnapshot> {
    await this.loadRecovery();
    const files: Record<string, string> = Object.create(null), revisions: Record<string, string> = Object.create(null);
    const diagnostics: StoreDiagnostic[] = []; let count = 0, total = 0, unsupportedCount=0;
    const unsupportedPaths:string[]=[];
    let stopped=false;
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<void> => {
      if (depth > LIMITS.depth) { diagnostics.push({code: 'depth-limit', path: prefix, message: 'Se alcanzó el límite de profundidad; el inventario es parcial.'}); return; }
      for await (const [name, entry] of dir.entries()) {
        if(stopped)return;
        const path = prefix ? `${prefix}/${name}` : name;
        if(path==='.bmad-project-ui/local')continue;
        try { safePath(path); } catch { continue; }
        if (name.startsWith('.') && !['.bmad-project-ui', '.memlog.md'].includes(name)) continue;
        // Installation content is data only; do not scan executable skills/scripts.
        if (prefix === '_bmad' && entry.kind === 'directory' && !['_config', 'bmm', 'core', 'custom'].includes(name)) continue;
        if (prefix.startsWith('_bmad/') && entry.kind === 'directory') continue;
        if (entry.kind === 'directory') {
          const child=entry as FileSystemDirectoryHandle;let nestedRepository=false;
          try { await child.getDirectoryHandle('.git'); nestedRepository=true; } catch { /* may be a worktree marker file */ }
          if(!nestedRepository) { try { await child.getFileHandle('.git'); nestedRepository=true; } catch { /* ordinary directory */ } }
          if(nestedRepository) { diagnostics.push({code:'nested-repository',path,message:'Repositorio anidado omitido. Ábrelo como proyecto independiente.'}); continue; }
          await walk(child, path, depth + 1); continue;
        }
        if (!textTypes.test(name)) {unsupportedCount++;if(unsupportedPaths.length<20)unsupportedPaths.push(path);continue;}
        if (++count > LIMITS.files) { stopped=true;diagnostics.push({code: 'file-limit', message: 'Se alcanzó el límite de archivos; el inventario es parcial.'}); return; }
        try {
          const f = await (entry as FileSystemFileHandle).getFile();
          if (f.size > LIMITS.bytesPerFile || total + f.size > LIMITS.totalBytes) { diagnostics.push({code: 'size-limit', path, message: 'Archivo omitido por límite de tamaño; el inventario es parcial.'}); continue; }
          const text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await f.arrayBuffer());
          if (text.includes('\0')) { diagnostics.push({code: 'binary-file', path, message: 'Archivo binario no representable como texto.'}); continue; }
          total += f.size; files[path] = text; revisions[path] = await contentHash(text);
        } catch (e) { diagnostics.push({code: 'read-error', path, message: message(e)}); }
      }
    };
    try { await walk(this.handle, '', 0); } catch (e) { throw new ProjectError('permission-lost', `No se ha podido releer la carpeta: ${message(e)}`); }
    const index=indexProject(files,revisions,{projectName:this.name,additionalRoots:this.additionalRoots});
    if(unsupportedCount)diagnostics.push({code:'unsupported-formats',message:`${unsupportedCount} archivos fuera del inventario de texto. Los adjuntos no se editan como documentos: ${unsupportedPaths.join(', ')}${unsupportedCount>unsupportedPaths.length?'…':''}`});
    if(diagnostics.length){index.coverage.partial=true;index.coverage.exclusions.push(...diagnostics.map(d=>[d.code,d.path].filter(Boolean).join(': ')));}
    this.lastSnapshot = {name:this.name,files,revisions,diagnostics,index};
    return this.lastSnapshot;
  }
  async assertCommentLocation(): Promise<void> {
    const snapshot=this.lastSnapshot ?? await this.refresh();
    const insideOutput=snapshot.index.roots.some(root=>root.role==='output' && (root.path==='.' || root.path==='' || '.bmad-project-ui'.startsWith(root.path+'/') || root.path==='.bmad-project-ui'));
    let projectRoot=false;
    for(const marker of ['_bmad','.git']) {
      try { await this.handle.getDirectoryHandle(marker); projectRoot=true; } catch { /* worktree may have a .git file */ }
    }
    if(!projectRoot) { try { await this.handle.getFileHandle('.git'); projectRoot=true; } catch { /* no root marker */ } }
    if(!projectRoot || insideOutput || this.name==='_bmad-output') throw new ProjectError('comment-location', 'Selecciona la raíz del proyecto para guardar comentarios fuera de las carpetas de salida BMAD.');
  }
  async withProjectLock<T>(fn: () => Promise<T>): Promise<T> {return this.lock(fn);}
  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    // Cross-tab exclusion supplements optimistic revision checks. External editors
    // cannot participate: the revision is rechecked immediately before close.
    if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(`bmad-project:${this.name}`, {mode:'exclusive'}, fn);
    return fn();
  }
  async save(path: string, text: string, expectedRevision: string | null): Promise<void> {
    this.queuedMutations++;try{return await this.lock(async()=>{
      await this.loadRecovery();await this.assertMutation();
      if(await this.handle.queryPermission({mode:'readwrite'})!=='granted')throw new ProjectError('permission-denied','Se ha perdido el permiso de escritura. El borrador se conserva.');
      if(this.mode!=='edit')throw new ProjectError('read-only','Activa el modo editor antes de guardar.',path);
      if(await this.revision(path)!==expectedRevision)throw new ProjectError('stale-revision','El archivo cambió en disco. Tu borrador se conserva.',path);
      safePath(path);if(path===recoveryPath)throw new ProjectError('unsafe-path','El registro de recuperación es interno.');
      if(new TextEncoder().encode(text).byteLength>LIMITS.bytesPerFile)throw new ProjectError('file-too-large','El borrador supera el límite de 2 MiB.');
      await this.prepareRecovery([{path,before:expectedRevision,after:await contentHash(text)}],[{path,before:expectedRevision===null?null:await this.read(path),after:text}]);
      await this.saveUnlocked(path,text,expectedRevision);await this.clearRecovery();
    });}finally{this.queuedMutations--;}
  }
  /** Remove only a verified connection marker; never a general delete API. */
  async removeTransientBinding(path: string): Promise<void> {
    if (this.mode !== 'edit' || !/^\.bmad-project-ui\/local\/git-bindings\/[a-zA-Z0-9-]+\.json$/.test(path)) throw new ProjectError('unsafe-path', 'Solo se puede retirar el marcador temporal de vinculación.', path);
    const parts=safePath(path); let dir=this.handle;
    for(const part of parts.slice(0,-1)) dir=await dir.getDirectoryHandle(part);
    await dir.removeEntry(parts.at(-1)!);
  }
  private async saveUnlocked(path: string, text: string, expectedRevision: string | null) {
    safePath(path);
    if(path===recoveryPath)throw new ProjectError('unsafe-path','El registro de recuperación es interno.',path);
    if (this.mode !== 'edit') throw new ProjectError('read-only', 'Activa el modo editor antes de guardar.', path);
    if (this.saving) throw new ProjectError('busy', 'Hay otro guardado en curso. El borrador se conserva.', path);
    if (new TextEncoder().encode(text).byteLength > LIMITS.bytesPerFile) throw new ProjectError('file-too-large', 'El borrador supera el límite de 2 MiB.', path);
    this.saving = true; let stream: FileSystemWritableFileStream | undefined;
    try {
      if (await this.handle.queryPermission({mode:'readwrite'}) !== 'granted') throw new ProjectError('permission-denied', 'Se ha perdido el permiso de escritura. El borrador se conserva.', path);
      if (await this.revision(path) !== expectedRevision) throw new ProjectError('stale-revision', 'El archivo cambió en disco. Revisa las diferencias antes de guardar; tu borrador se conserva.', path);
      await this.mutationGuard?.();
      const target = await this.file(path, expectedRevision === null);
      stream = await target.createWritable({keepExistingData: false});
      await stream.write(text);
      const currentRevision = await this.revision(path);
      const emptyCreated = expectedRevision === null && currentRevision === await contentHash('');
      if (currentRevision !== expectedRevision && !emptyCreated) throw new ProjectError('stale-revision', 'El archivo cambió durante el guardado. El borrador se conserva.', path);
      await this.mutationGuard?.();
      await stream.close(); stream = undefined;
      if (await this.revision(path) !== await contentHash(text)) throw new ProjectError('verification-failed', 'No se pudo verificar el contenido guardado. Relee el archivo antes de continuar.', path);
    } catch (e) {
      if (stream) await stream.abort().catch(() => undefined);
      throw e;
    } finally { this.saving = false; }
  }
  async applyChanges(changes: {path: string; before: string; after: string; expectedRevision: string}[]) {
    if (!changes.length) return;
    this.queuedMutations++;try{return await this.lock(async () => {
      await this.loadRecovery();await this.assertMutation();
      if(await this.handle.queryPermission({mode:'readwrite'})!=='granted')throw new ProjectError('permission-denied','Se ha perdido el permiso de escritura. El borrador se conserva.');
      if(this.mode!=='edit')throw new ProjectError('read-only','Activa el modo editor antes de guardar.');
      if(new Set(changes.map(c=>c.path)).size!==changes.length)throw new ProjectError('duplicate-path','El plan repite un archivo.');
      for (const change of changes) if (await this.revision(change.path) !== change.expectedRevision || await this.read(change.path) !== change.before) throw new ProjectError('stale-revision', 'El plan ya no coincide con los archivos. Vuelve a revisar el cambio.', change.path);
      for(const change of changes)safePath(change.path);
      await this.prepareRecovery(await Promise.all(changes.map(async c=>({path:c.path,before:c.expectedRevision,after:await contentHash(c.after)}))),changes.map(c=>({path:c.path,before:c.before,after:c.after})));
      const saved: string[] = [];
      try {
        for (const change of changes) { await this.saveUnlocked(change.path, change.after, change.expectedRevision); saved.push(change.path); }
        await this.clearRecovery();
      } catch (e) { throw new ProjectError('partial-save', `Guardado interrumpido. Archivos verificados: ${saved.join(', ') || 'ninguno'}. ${message(e)}`); }
    });}finally{this.queuedMutations--;}
  }
}
