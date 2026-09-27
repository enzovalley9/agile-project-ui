import {describe,it,expect,vi} from 'vitest';
import {ProjectStore,contentHash,safePath} from '../src/services/project-store';
import {memoryDirectory} from '../../../tests/support/memory-handles';
import {addThread,loadThreads,mutateThread,makeAnchor} from '../src/services/comments';
const initial={'_bmad/config.toml':'[core]\nproject_name="Fixture"\noutput_folder="_bmad-output"\n','docs/a.md':'# Documento\n\nContenido original.\n','.env':'SECRET=not-read','.git/config':'not-read','node_modules/a.md':'not-read'};
describe('browser project boundary',()=>{
 it('opens and refreshes in read mode with zero writes, excluding secrets and tool internals',async()=>{
  const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);const snapshot=await store.refresh();
  expect(snapshot.files['docs/a.md']).toBe(initial['docs/a.md']);expect(snapshot.files['.env']).toBeUndefined();expect(snapshot.files['.git/config']).toBeUndefined();expect(snapshot.files['node_modules/a.md']).toBeUndefined();
  expect(fs.state.writes).toBe(0);expect(store.mode).toBe('read');await expect(store.save('docs/a.md','changed',snapshot.revisions['docs/a.md'])).rejects.toThrow('editor');
 });
 it('writes only after permission and verifies saved bytes',async()=>{
  const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);const s=await store.refresh();await store.setMode('edit');await store.save('docs/a.md','Changed\r\n',s.revisions['docs/a.md']);
  expect(fs.files.get('docs/a.md')).toBe('Changed\r\n');expect(await store.revision('docs/a.md')).toBe(await contentHash('Changed\r\n'));
 });
 it('rejects external changes before or during save and preserves disk content',async()=>{
  const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);const s=await store.refresh();await store.setMode('edit');fs.files.set('docs/a.md','External');
  await expect(store.save('docs/a.md','Draft',s.revisions['docs/a.md'])).rejects.toThrow('cambió');expect(fs.files.get('docs/a.md')).toBe('External');
  fs.state.beforeWrite=(path)=>{if(path==='docs/a.md')fs.files.set('docs/a.md','Raced');};await expect(store.save('docs/a.md','Draft',await contentHash('External'))).rejects.toThrow('durante');expect(fs.files.get('docs/a.md')).toBe('Raced');expect(fs.state.abort).toBe(1);
 });
 it('rejects permission loss and disk failure without accepting the draft',async()=>{
  const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);const s=await store.refresh();await store.setMode('edit');fs.state.permission='denied';await expect(store.save('docs/a.md','draft',s.revisions['docs/a.md'])).rejects.toThrow('permiso');
  fs.state.permission='granted';fs.state.failWrite=true;await expect(store.save('docs/a.md','draft',s.revisions['docs/a.md'])).rejects.toThrow('disk full');expect(fs.files.get('docs/a.md')).toBe(initial['docs/a.md']);
 });
 it('blocks traversal, absolute paths, system paths and secret files',()=>{
  for(const path of ['../a','a/../b','/etc/passwd','C:/x','a\\b','.git/config','.GIT/config','.Git/config','.env','secrets/key.json','cert.pem','a//b'])expect(()=>safePath(path)).toThrow();
 });
 it('does not apply a stale multi-file plan',async()=>{
  const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);await store.setMode('edit');await expect(store.applyChanges([{path:'docs/a.md',before:'wrong',after:'new',expectedRevision:await contentHash(initial['docs/a.md'])}])).rejects.toThrow('plan');expect(fs.state.writes).toBe(0);
 });
 it('stores comments outside BMAD output, roundtrips them, rejects concurrent replies',async()=>{
  const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);const s=await store.refresh();await store.setMode('edit');const anchor=makeAnchor('docs/a.md',initial['docs/a.md'],s.revisions['docs/a.md'],3);const actor={id:'a',name:'Ana'};
  await addThread(store,anchor,actor,'Revisar riego');const loaded=loadThreads(await store.refresh());expect(loaded.threads).toHaveLength(1);expect(loaded.errors).toHaveLength(0);
  const stale=loaded.threads[0];await mutateThread(store,stale,actor,{type:'reply',text:'Hecho'});await expect(mutateThread(store,stale,actor,{type:'reply',text:'Concurrente'})).rejects.toThrow('cambió');
  expect(fs.files.get('docs/a.md')).toBe(initial['docs/a.md']);expect([...fs.files.keys()].filter(x=>x.includes('/comments/')).every(x=>x.startsWith('.bmad-project-ui/'))).toBe(true);
 });
 it('rejects sidecars inside an output-only selected folder',async()=>{
  const fs=memoryDirectory({'story.md':'# Story'},'_bmad-output'),store=new ProjectStore(fs.handle);await store.setMode('edit');await expect(store.assertCommentLocation()).rejects.toThrow('raíz del proyecto');expect(fs.state.writes).toBe(0);
 });
 it('restricts transient deletion to binding markers',async()=>{
  const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);await store.setMode('edit');await expect(store.removeTransientBinding('docs/a.md')).rejects.toThrow('marcador');
 });
});

describe('persistent write recovery',()=>{
 it('blocks further edits after partial save across store reloads until exact state is reviewed',async()=>{
  const fs=memoryDirectory({...initial,'docs/b.md':'B'}),store=new ProjectStore(fs.handle);await store.setMode('edit');
  fs.state.beforeWrite=(path)=>{if(path==='docs/b.md')throw new Error('disk full');};
  await expect(store.applyChanges([{path:'docs/a.md',before:initial['docs/a.md'],after:'A changed',expectedRevision:await contentHash(initial['docs/a.md'])},{path:'docs/b.md',before:'B',after:'B changed',expectedRevision:await contentHash('B')}])).rejects.toThrow('interrumpido');
  expect(fs.files.get('docs/a.md')).toBe('A changed');expect(fs.files.get('docs/b.md')).toBe('B');expect(store.recoveryPending).toBe(true);
  const reloaded=new ProjectStore(fs.handle);await reloaded.refresh();expect(reloaded.recoveryPending).toBe(true);await reloaded.setMode('edit');
  await expect(reloaded.save('docs/c.md','C',null)).rejects.toThrow('pendiente');
  const reviewed=(await reloaded.recoveryStatus())!;expect(reviewed.entries.map(e=>e.state)).toEqual(['saved','original']);
  fs.files.set('docs/b.md','External');await expect(reloaded.reconcileRecovery(reviewed)).rejects.toThrow('cambiaron');
  await reloaded.reconcileRecovery((await reloaded.recoveryStatus())!);expect(reloaded.recoveryPending).toBe(false);
  fs.state.beforeWrite=undefined;await reloaded.save('docs/c.md','C',null);expect(fs.files.get('docs/c.md')).toBe('C');
 });
 it('checks connected repository context before opening and before closing the file stream',async()=>{
  const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);await store.setMode('edit');let branch='main';store.setMutationGuard(async()=>{if(branch!=='main')throw new Error('branch changed');});
  fs.state.beforeWrite=(path)=>{if(path==='docs/a.md')branch='other';};
  await expect(store.save('docs/a.md','draft',await contentHash(initial['docs/a.md']))).rejects.toThrow('branch changed');expect(fs.files.get('docs/a.md')).toBe(initial['docs/a.md']);expect(store.recoveryPending).toBe(true);
 });
 it('isolates malformed comment dates instead of crashing the reader',async()=>{
  const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);await store.setMode('edit');const snapshot=await store.refresh();const anchor=makeAnchor('docs/a.md',initial['docs/a.md'],snapshot.revisions['docs/a.md'],3);
  const thread=await addThread(store,anchor,{id:'a',name:'Ana'},'Original');const key=`.bmad-project-ui/comments/threads/${thread.id}.json`;const malformed=JSON.parse(fs.files.get(key)!);delete malformed.createdAt;fs.files.set(key,JSON.stringify(malformed));
  const loaded=loadThreads(await store.refresh());expect(loaded.threads).toHaveLength(0);expect(loaded.errors).toHaveLength(1);
 });
});

describe('ambiguous comment outcomes',()=>{
 it('retains the creation identity when verification fails after file close',async()=>{
  const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);await store.setMode('edit');const snapshot=await store.refresh(),anchor=makeAnchor('docs/a.md',initial['docs/a.md'],snapshot.revisions['docs/a.md'],3),actor={id:'a',name:'Ana'};let fail='';
  fs.state.afterClose=(path)=>{if(path.includes('/comments/'))fail=path;};fs.state.beforeRead=(path)=>{if(path===fail){fail='';throw new DOMException('Lost permission','NotAllowedError');}};
  await expect(addThread(store,anchor,actor,'Only once')).rejects.toThrow('Lost permission');expect(store.recoveryPending).toBe(true);
  fs.state.afterClose=undefined;const recovered=await addThread(store,anchor,actor,'Only once');expect(recovered.messages[0].text).toBe('Only once');expect([...fs.files.keys()].filter(path=>path.includes('/comments/'))).toHaveLength(1);
  await store.reconcileRecovery((await store.recoveryStatus())!);expect(store.recoveryPending).toBe(false);
 });
});

describe('private recovery copies',()=>{
 it('restores originals after partial writes and store reload using private filesystem backups',async()=>{
  const privateFs=memoryDirectory({});vi.stubGlobal('navigator',{storage:{getDirectory:async()=>privateFs.handle}});
  try{const fs=memoryDirectory({...initial,'docs/b.md':'B'}),store=new ProjectStore(fs.handle);await store.setMode('edit');fs.state.beforeWrite=(path)=>{if(path==='docs/b.md')throw new Error('disk full');};
   await expect(store.applyChanges([{path:'docs/a.md',before:initial['docs/a.md'],after:'Changed A',expectedRevision:await contentHash(initial['docs/a.md'])},{path:'docs/b.md',before:'B',after:'Changed B',expectedRevision:await contentHash('B')}])).rejects.toThrow();
   expect(fs.files.get('.bmad-project-ui/local/write-recovery.json')).not.toContain('Changed A');expect([...privateFs.files.values()][0]).toContain('Changed A');
   fs.state.beforeWrite=undefined;const next=new ProjectStore(fs.handle);await next.refresh();await next.setMode('edit');const reviewed=(await next.recoveryStatus())!;expect(reviewed.backupsAvailable).toBe(true);expect(reviewed.backupsPersistent).toBe(true);expect((await next.recoveryCopies())?.[0].before).toBe(initial['docs/a.md']);
   await next.restoreRecovery(reviewed,'before');expect(fs.files.get('docs/a.md')).toBe(initial['docs/a.md']);expect(fs.files.get('docs/b.md')).toBe('B');expect(next.recoveryPending).toBe(false);expect(privateFs.files.size).toBe(0);
  }finally{vi.unstubAllGlobals();}
 });
 it('preserves external edits during a reviewed partial recovery instead of overwriting them',async()=>{
  const privateFs=memoryDirectory({});vi.stubGlobal('navigator',{storage:{getDirectory:async()=>privateFs.handle}});
  try{const fs=memoryDirectory({...initial,'docs/b.md':'B'}),store=new ProjectStore(fs.handle);await store.setMode('edit');
   fs.state.beforeWrite=(path)=>{if(path==='docs/b.md')throw new Error('disk full');};
   await expect(store.applyChanges([{path:'docs/a.md',before:initial['docs/a.md'],after:'Planned A',expectedRevision:await contentHash(initial['docs/a.md'])},{path:'docs/b.md',before:'B',after:'Planned B',expectedRevision:await contentHash('B')}])).rejects.toThrow();
   fs.state.beforeWrite=undefined;fs.files.set('docs/a.md','External later edit');const reviewed=(await store.recoveryStatus())!,writes=fs.state.writes;
   expect(reviewed.entries.map(entry=>entry.state)).toEqual(['changed','original']);
   for(const version of ['before','after'] as const)await expect(store.restoreRecovery(reviewed,version)).rejects.toThrow('cambios externos');
   expect(fs.files.get('docs/a.md')).toBe('External later edit');expect(fs.files.get('docs/b.md')).toBe('B');expect(fs.state.writes).toBe(writes);expect(store.recoveryPending).toBe(true);expect((await store.recoveryCopies())?.[0].after).toBe('Planned A');
  }finally{vi.unstubAllGlobals();}
 });
 it('rejects altered private backups and keeps the recovery gate',async()=>{
  const privateFs=memoryDirectory({});vi.stubGlobal('navigator',{storage:{getDirectory:async()=>privateFs.handle}});
  try{const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);await store.setMode('edit');fs.state.beforeWrite=(path)=>{if(path==='docs/a.md')throw new Error('interrupted');};await expect(store.save('docs/a.md','Planned',await contentHash(initial['docs/a.md']))).rejects.toThrow();
   const key=[...privateFs.files.keys()][0];privateFs.files.set(key,privateFs.files.get(key)!.replace('Planned','Tampered'));
   expect((await store.recoveryStatus())?.backupsAvailable).toBe(false);expect(await store.recoveryCopies()).toBeNull();await expect(store.restoreRecovery((await store.recoveryStatus())!,'after')).rejects.toThrow('copias');expect(store.recoveryPending).toBe(true);expect(fs.files.get('docs/a.md')).toBe(initial['docs/a.md']);
  }finally{vi.unstubAllGlobals();}
 });
});

describe('scan coverage',()=>{
 it('rejects images in hidden nested repositories before reading their contents',async()=>{
  const fs=memoryDirectory({...initial,'_bmad/config.toml':'[core]\nproject_knowledge="docs"\n','docs/.private/.git/config':'private','docs/.private/pixel.gif':'GIF89a'}),store=new ProjectStore(fs.handle);const snapshot=await store.refresh();
  expect(snapshot.diagnostics.some(item=>item.path==='docs/.private')).toBe(false);
  const reads:string[]=[];fs.state.beforeRead=path=>{reads.push(path);};
  await expect(store.readImage('docs/.private/pixel.gif')).rejects.toMatchObject({code:'image-outside-scope'});
  expect(reads).toEqual([]);expect(fs.state.writes).toBe(0);
 });
 it.each(['directory','file'] as const)('rechecks live %s repository markers after an image inventory',async kind=>{
  const fs=memoryDirectory({...initial,'_bmad/config.toml':'[core]\nproject_knowledge="docs"\n','docs/assets/pixel.gif':'GIF89a'}),store=new ProjectStore(fs.handle);await store.refresh();
  expect((await store.readImage('docs/assets/pixel.gif')).type).toBe('image/gif');
  if(kind==='directory')fs.directories.add('docs/.git');else fs.files.set('docs/.git','gitdir: elsewhere');
  const reads:string[]=[];fs.state.beforeRead=path=>{reads.push(path);};
  await expect(store.readImage('docs/assets/pixel.gif')).rejects.toMatchObject({code:'image-outside-scope'});
  expect(reads).toEqual([]);expect(fs.state.writes).toBe(0);
 });
 it('withholds image bytes if a repository marker appears while reading',async()=>{
  const fs=memoryDirectory({...initial,'_bmad/config.toml':'[core]\nproject_knowledge="docs"\n','docs/assets/pixel.gif':'GIF89a'}),store=new ProjectStore(fs.handle);await store.refresh();
  fs.state.beforeRead=path=>{if(path==='docs/assets/pixel.gif')fs.files.set('docs/assets/.git','gitdir: elsewhere');};
  await expect(store.readImage('docs/assets/pixel.gif')).rejects.toMatchObject({code:'image-outside-scope'});expect(fs.state.writes).toBe(0);
 });
 it('identifies unsupported attachments without treating the text inventory as exhaustive',async()=>{
  const fs=memoryDirectory({...initial,'docs/attachment.pdf':'PDF','docs/image.png':'PNG'}),store=new ProjectStore(fs.handle),snapshot=await store.refresh();
  expect(snapshot.diagnostics.find(item=>item.code==='unsupported-formats')?.message).toContain('2 archivos');expect(snapshot.files['docs/attachment.pdf']).toBeUndefined();expect(snapshot.index.coverage.partial).toBe(true);expect(fs.state.writes).toBe(0);
 });

 it('exposes invalid encoding and interrupted reads as partial coverage without breaking valid files',async()=>{
  const fs=memoryDirectory(initial),store=new ProjectStore(fs.handle);fs.state.beforeRead=(path)=>{if(path==='docs/a.md')throw new Error('read denied');};const snapshot=await store.refresh();expect(snapshot.diagnostics.some(d=>d.path==='docs/a.md'&&d.code==='read-error')).toBe(true);expect(snapshot.index.coverage.partial).toBe(true);expect(fs.state.writes).toBe(0);
 });
 it('rejects platform aliases to protected paths',()=>{for(const path of ['.GIT./config','.git /config','docs/note.md:secret'])expect(()=>safePath(path)).toThrow();});
});
