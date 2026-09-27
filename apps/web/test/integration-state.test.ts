import {describe,it,expect,vi} from 'vitest';
import {ProjectStore,contentHash} from '../src/services/project-store';
import {previewIntegrationImport,importIntegrationPlan,saveIntegrationConnection,saveIntegrationBinding,loadIntegrationState,saveComparisonBase,getComparisonBase,comparisonBasePersistence} from '../src/services/integration-state';
import {memoryDirectory} from '../../../tests/support/memory-handles';
import type {IntegrationPlan,IntegrationBinding} from '../../../packages/integrations/src/types';
const config={'_bmad/_config/manifest.yaml':'installation:\n  version: 6.12.0\n','_bmad/config.toml':'[core]\noutput_folder="_bmad-output"\n'};
function plan(path:string,text:string,revision:string,extra:Partial<IntegrationPlan>={}):IntegrationPlan{return {id:'plan',provider:'confluence',local:{path,text,revision},resource:{provider:'confluence',deployment:'cloud',instance:'https://fixture.atlassian.net',id:'42',url:'https://fixture.atlassian.net/wiki/pages/42',scopeId:'space',title:'Remote',version:'7',observedAt:new Date().toISOString(),fields:{body:'Remote body.'},content:{normalizerVersion:1,nodes:[],complete:true,unsupported:[],markdown:'Remote body.'},representation:'storage',draft:'unknown',provenance:{api:'test',profile:'test'}},direction:'import',fields:['body'],comparison:{state:'no-base',rows:[],coverage:{complete:true,unsupported:[]},normalizerVersion:1,observedAt:new Date().toISOString()},blockedReasons:[],transportLoss:[],reviewedPayloadHash:'test',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),candidate:{text:'Remote body.'},...extra};}
describe('reviewed field imports through the browser',()=>{
 it('preserves BOM, CRLF, frontmatter, unknown metadata and unselected H1',async()=>{
  const original='\uFEFF---\r\ntitle: "Local" # note\r\ncustom: {keep: true}\r\n---\r\n# Local\r\n\r\nOriginal body.\r\n';
  const fs=memoryDirectory({...config,'docs/a.md':original}),store=new ProjectStore(fs.handle),snapshot=await store.refresh();const proposed=plan('docs/a.md',original,snapshot.revisions['docs/a.md']);
  const changes=await previewIntegrationImport(snapshot,proposed);expect(changes).toHaveLength(1);expect(changes[0].after).toBe('\uFEFF---\r\ntitle: "Local" # note\r\ncustom: {keep: true}\r\n---\r\n# Local\r\n\r\nRemote body.\r\n');expect(fs.state.writes).toBe(0);
  await store.setMode('edit');await importIntegrationPlan(store,proposed,{confirmed:true,reviewedChanges:changes});expect(fs.files.get('docs/a.md')).toBe(changes[0].after);
 });
 it('applies a task description without replacing the epics container or its siblings',async()=>{
  const path='_bmad-output/planning-artifacts/epics.md',text='# Epics\n\n## Epic 1: Riego\n\nOverview preserved.\n\n### Story 1.1: Regar\n\nOriginal story.\n\n### Story 1.2: Cancelar\n\nSibling preserved.\n';
  const fs=memoryDirectory({...config,[path]:text}),store=new ProjectStore(fs.handle),snapshot=await store.refresh();const item=snapshot.index.workItems.find(i=>i.kind==='story'&&i.nativeId==='1.1')!;
  const proposed=plan(path,item.description??'',snapshot.revisions[path],{provider:'jira',local:{path,text:item.description??'',revision:snapshot.revisions[path],entityId:item.id},fields:['description'],candidate:{text:'Remote description.'}});
  const changes=await previewIntegrationImport(snapshot,proposed);expect(changes).toHaveLength(1);expect(changes[0].after).toContain('Overview preserved.');expect(changes[0].after).toContain('Sibling preserved.');expect(changes[0].after).toContain('Remote description.');expect(changes[0].after).not.toContain('Original story.');
 });
 it('rejects stale, expired, unconfirmed or changed reviews without writes',async()=>{
  const fs=memoryDirectory({...config,'docs/a.md':'# Local\n\nOriginal\n'}),store=new ProjectStore(fs.handle),snapshot=await store.refresh();const proposed=plan('docs/a.md',snapshot.files['docs/a.md'],snapshot.revisions['docs/a.md']);const changes=await previewIntegrationImport(snapshot,proposed);await store.setMode('edit');
  await expect(importIntegrationPlan(store,proposed,{confirmed:false,reviewedChanges:changes})).rejects.toThrow('confirma');
  await expect(previewIntegrationImport(snapshot,{...proposed,expiresAt:'2020-01-01T00:00:00Z'})).rejects.toThrow('caducado');
  await expect(importIntegrationPlan(store,proposed,{confirmed:true,reviewedChanges:[]})).rejects.toThrow('mapping');fs.files.set('docs/a.md','External');await expect(importIntegrationPlan(store,proposed,{confirmed:true,reviewedChanges:changes})).rejects.toThrow('cambió');expect(fs.state.writes).toBe(0);
 });
 it('persists associations without saving private comparison bodies or credentials',async()=>{
  const privateFs=memoryDirectory({});vi.stubGlobal('navigator',{storage:{getDirectory:async()=>privateFs.handle}});
  try{const fs=memoryDirectory({...config,'docs/a.md':'# Local'}),store=new ProjectStore(fs.handle);await store.setMode('edit');let snapshot=await store.refresh();await saveIntegrationConnection(store,snapshot,'confluence',{instance:'https://fixture.atlassian.net',deployment:'cloud',scopeId:'space',scopeName:'Test',localRoot:'docs',checkedAt:new Date().toISOString()});snapshot=await store.refresh();
  const binding:IntegrationBinding={schemaVersion:1,normalizerVersion:1,id:'binding',projectId:loadIntegrationState(snapshot,'confluence').state.projectId,provider:'confluence',deployment:'cloud',instance:'https://fixture.atlassian.net',resourceId:'42',resourceUrl:'https://fixture.atlassian.net/wiki/pages/42',scopeId:'space',local:{path:'docs/a.md'},fields:['body'],policy:'review-both-directions'};
  await saveIntegrationBinding(store,snapshot,binding);snapshot=await store.refresh();const before=fs.files.get('.bmad-project-ui/integrations/confluence.json');await saveComparisonBase(store,snapshot,'confluence','binding',{schemaVersion:1,normalizerVersion:1,provider:'confluence',instance:binding.instance,resourceId:'42',local:{body:'PRIVATE LOCAL BASE'},remote:{body:'PRIVATE REMOTE BASE'},observedAt:new Date().toISOString()});expect(fs.files.get('.bmad-project-ui/integrations/confluence.json')).toBe(before);expect(before).not.toContain('PRIVATE');expect(await contentHash(before!)).toBe(snapshot.revisions['.bmad-project-ui/integrations/confluence.json']);
  expect(comparisonBasePersistence(store)).toBe('persistent');const reloaded=new ProjectStore(fs.handle),reopened=await reloaded.refresh();
  expect((await getComparisonBase(reloaded,reopened,'confluence','binding'))?.local.body).toBe('PRIVATE LOCAL BASE');expect(comparisonBasePersistence(reloaded)).toBe('persistent');
  const changed=structuredClone(reopened);const mapping=JSON.parse(changed.files['.bmad-project-ui/integrations/confluence.json']);mapping.bindings[0].resourceId='different';changed.files['.bmad-project-ui/integrations/confluence.json']=JSON.stringify(mapping);expect(await getComparisonBase(reloaded,changed,'confluence','binding')).toBeUndefined();
  const key=[...privateFs.files.keys()][0],corrupt=JSON.parse(privateFs.files.get(key)!);corrupt.normalizerVersion=999;privateFs.files.set(key,JSON.stringify(corrupt));expect(await getComparisonBase(new ProjectStore(fs.handle),reopened,'confluence','binding')).toBeUndefined();
  }finally{vi.unstubAllGlobals();}

 });
});
