import {parseDocument,isScalar} from 'yaml';
import {validateBinding} from '../../../../packages/integrations/src/bindings';
import {indexProject,planWorkItemEdit,type FileChange} from '../../../../packages/domain/src/index';
import type {Provider,Deployment,IntegrationBinding,ComparisonBase,IntegrationPlan} from '../../../../packages/integrations/src/types';
import {ProjectStore,safePath,contentHash,type ProjectSnapshot} from './project-store';
export interface IntegrationConnection {instance:string;deployment:Deployment;scopeId:string;scopeName:string;localRoot:string;include?:string[];exclude?:string[];checkedAt:string}
export interface IntegrationState {schemaVersion:1;projectId:string;connection?:IntegrationConnection;bindings:IntegrationBinding[];bases:Record<string,ComparisonBase>}
const privateBases=new WeakMap<ProjectStore,Map<string,ComparisonBase>>();
const basePersistence=new WeakMap<ProjectStore,'persistent'|'session'>();
export function comparisonBasePersistence(store:ProjectStore){return basePersistence.get(store);}
async function baseIdentity(snapshot:ProjectSnapshot,provider:Provider,bindingId:string){
  const loaded=loadIntegrationState(snapshot,provider),binding=loaded.state.bindings.find(item=>item.id===bindingId);
  if(!binding)return undefined;
  return {binding,key:await contentHash(JSON.stringify({projectId:loaded.state.projectId,binding}))};
}
function validBase(value:unknown,binding:IntegrationBinding):value is ComparisonBase{
  if(!value||typeof value!=='object')return false;
  const base=value as ComparisonBase;
  return base.schemaVersion===1&&base.normalizerVersion===1&&base.provider===binding.provider&&base.instance===binding.instance&&base.resourceId===binding.resourceId&&typeof base.observedAt==='string'&&Number.isFinite(Date.parse(base.observedAt))&&[base.local,base.remote].every(fields=>fields&&typeof fields==='object'&&!Array.isArray(fields)&&Object.entries(fields).every(([key,text])=>['title','description','body','status'].includes(key)&&typeof text==='string'&&text.length<=2*1024*1024));
}
async function baseDirectory(create:boolean){
  const root=await navigator.storage.getDirectory();
  return root.getDirectoryHandle('bmad-project-ui-comparison-bases',{create});
}
export async function getComparisonBase(store:ProjectStore,snapshot:ProjectSnapshot,provider:Provider,bindingId:string):Promise<ComparisonBase|undefined>{
  const identity=await baseIdentity(snapshot,provider,bindingId);if(!identity)return undefined;
  const memory=privateBases.get(store)?.get(identity.key);
  if(memory&&validBase(memory,identity.binding))return structuredClone(memory);
  try{
    const directory=await baseDirectory(false),handle=await directory.getFileHandle(identity.key+'.json');
    const file=await handle.getFile();if(file.size>8*1024*1024)return undefined;
    const value:unknown=JSON.parse(await file.text());
    if(!validBase(value,identity.binding))return undefined;
    basePersistence.set(store,'persistent');
    return structuredClone(value);
  }catch{return undefined;}
}
const pathFor=(provider:Provider)=>`.bmad-project-ui/integrations/${provider}.json`;
export function loadIntegrationState(snapshot:ProjectSnapshot,provider:Provider):{state:IntegrationState;path:string;revision:string|null}{
  const path=pathFor(provider);const text=snapshot.files[path];
  if(!text)return {path,revision:null,state:{schemaVersion:1,projectId:crypto.randomUUID(),bindings:[],bases:{}}};
  const state=JSON.parse(text) as IntegrationState;
  if(state.schemaVersion!==1||typeof state.projectId!=='string'||!Array.isArray(state.bindings)||!state.bases||typeof state.bases!=='object')throw new Error('Configuración de integración incompatible. Se conserva el archivo original.');
  if(Object.keys(state).some(key=>!['schemaVersion','projectId','connection','bindings','bases'].includes(key))||Object.keys(state.bases).length)throw new Error('La configuración contiene campos privados o desconocidos; revísala antes de usarla.');
  if(state.connection){const c=state.connection;if(typeof c!=='object'||!['cloud','data-center'].includes(c.deployment)||typeof c.instance!=='string'||typeof c.scopeId!=='string'||!c.scopeId||typeof c.scopeName!=='string'||typeof c.localRoot!=='string'||!c.localRoot||typeof c.checkedAt!=='string'||!Number.isFinite(Date.parse(c.checkedAt))||[c.include,c.exclude].some(list=>list!==undefined&&(!Array.isArray(list)||list.some(item=>typeof item!=='string'))))throw new Error('El ámbito de integración no es válido.');safeInstance(c.instance);if(c.localRoot!=='.')safePath(c.localRoot);}
  for(const binding of state.bindings){validateBinding(binding);if(binding.schemaVersion!==1||binding.provider!==provider||binding.projectId!==state.projectId||!binding.id||!binding.resourceId||!binding.local?.path)throw new Error('Asociación inválida. Revisa el archivo de integración.');safePath(binding.local.path);}
  return {state,path,revision:snapshot.revisions[path]??null};
}
async function persist(store:ProjectStore,loaded:ReturnType<typeof loadIntegrationState>){await store.assertCommentLocation();await store.save(loaded.path,JSON.stringify({...loaded.state,bases:{}},null,2)+'\n',loaded.revision);}
function safeInstance(value:string){const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Instancia inválida; no incluyas credenciales en la dirección.');return url.origin+url.pathname.replace(/\/$/,'');}
export async function saveIntegrationConnection(store:ProjectStore,snapshot:ProjectSnapshot,provider:Provider,connection:IntegrationConnection){
  if(!connection.scopeId||!connection.localRoot)throw new Error('Elige el ámbito remoto y la carpeta local.');
  if(connection.localRoot!=='.')safePath(connection.localRoot);
  const loaded=loadIntegrationState(snapshot,provider);loaded.state.connection={...connection,instance:safeInstance(connection.instance)};await persist(store,loaded);
}
export async function saveIntegrationBinding(store:ProjectStore,snapshot:ProjectSnapshot,binding:IntegrationBinding){
  safePath(binding.local.path);const loaded=loadIntegrationState(snapshot,binding.provider);safeInstance(binding.instance);
  validateBinding({...binding,projectId:loaded.state.projectId});
  const connection=loaded.state.connection;if(!connection||connection.instance!==binding.instance||connection.scopeId!==binding.scopeId||connection.deployment!==binding.deployment)throw new Error('La asociación no coincide con la conexión y ámbito revisados.');
  if(connection.localRoot!=='.'&&binding.local.path!==connection.localRoot&&!binding.local.path.startsWith(connection.localRoot+'/'))throw new Error('El documento está fuera de la carpeta local autorizada.');
  if(!snapshot.files[binding.local.path])throw new Error('El documento local ya no está disponible.');
  if(!binding.fields.length||!binding.scopeId||!binding.resourceId)throw new Error('Revisa la identidad, el ámbito y los campos de la asociación.');
  if(loaded.state.bindings.some(b=>b.id!==binding.id&&b.instance===binding.instance&&b.resourceId===binding.resourceId))throw new Error('Esta asociación ya existe.');
  const saved={...binding,projectId:loaded.state.projectId};
  loaded.state.bindings=[...loaded.state.bindings.filter(b=>b.id!==saved.id),saved];await persist(store,loaded);
}
export async function unlinkIntegrationBinding(store:ProjectStore,snapshot:ProjectSnapshot,provider:Provider,bindingId:string){
  const loaded=loadIntegrationState(snapshot,provider);loaded.state.bindings=loaded.state.bindings.filter(b=>b.id!==bindingId);delete loaded.state.bases[bindingId];await persist(store,loaded);
}
export async function saveComparisonBase(store:ProjectStore,snapshot:ProjectSnapshot,provider:Provider,bindingId:string,base:ComparisonBase){
  const identity=await baseIdentity(snapshot,provider,bindingId);
  if(!identity||!validBase(base,identity.binding))throw new Error('La referencia no corresponde a la asociación vigente.');
  // Baselines contain private document content: never persist them in a shareable sidecar.
  let bases=privateBases.get(store);if(!bases){bases=new Map();privateBases.set(store,bases);}bases.set(identity.key,structuredClone(base));
  basePersistence.set(store,'session');
  try{
    const directory=await baseDirectory(true),handle=await directory.getFileHandle(identity.key+'.json',{create:true});
    const text=JSON.stringify(base),writer=await handle.createWritable();
    try{await writer.write(text);await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}
    if(await (await handle.getFile()).text()!==text)throw new Error('No se pudo verificar la base privada.');
    basePersistence.set(store,'persistent');
  }catch{
    // The verified document operation has already completed. Retain a session
    // fallback without misreporting that operation as failed or replaying it.
  }
}
function checkPlan(plan:IntegrationPlan){
  if(plan.direction!=='import')throw new Error('Este plan no importa contenido al proyecto.');
  if(plan.blockedReasons.length||plan.transportLoss.length||!plan.comparison.coverage.complete)throw new Error('El plan contiene bloqueos o pérdidas de representación. Exporta la propuesta y revísala manualmente.');
  if(!Number.isFinite(Date.parse(plan.expiresAt))||Date.parse(plan.expiresAt)<=Date.now())throw new Error('El plan ha caducado. Vuelve a comparar.');
  safePath(plan.local.path);
}
function replaceDocumentTitle(text:string,title:string){
  if(!title.trim()||/[\r\n]/.test(title))throw new Error('El título debe ocupar una línea.');
  const front=text.match(/^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
  let result=text,bodyStart=front?.[0].length??(text.startsWith('\uFEFF')?1:0);
  if(front){const doc=parseDocument(front[2]);const node=doc.get('title',true);if(doc.errors.length)throw new Error('Frontmatter inválido; importa el título manualmente.');if(node&&isScalar(node)&&node.range){const start=front[1].length+node.range[0],end=front[1].length+node.range[1];result=text.slice(0,start)+JSON.stringify(title)+text.slice(end);bodyStart+=JSON.stringify(title).length-(end-start);}}
  const body=result.slice(bodyStart);const heading=body.match(/^(\s*# )[^\r\n]+/);
  if(heading)return result.slice(0,bodyStart)+body.replace(/^(\s*# )[^\r\n]+/,(_all,prefix)=>prefix+title);
  if(front&&parseDocument(front[2]).has('title'))return result;
  return result.slice(0,bodyStart)+'# '+title+'\n\n'+body;
}
function replaceDocumentBody(text:string,body:string){
  const front=text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);const frontLength=front?.[0].length??(text.startsWith('\uFEFF')?1:0);
  const rest=text.slice(frontLength);const title=rest.match(/^\s*# [^\r\n]+(?:\r?\n|$)/);const preserved=text.slice(0,frontLength)+(title?.[0]??'');
  // A remote document's primary title is a separate field; do not silently
  // replace an unselected local title while importing managed body content.
  const content=body.replace(/^\s*# [^\r\n]+(?:\r?\n|$)/,'');
  const eol=text.includes('\r\n')?'\r\n':'\n';
  return preserved+eol+content.replace(/\r?\n/g,eol).replace(/^\s*\n/,'')+(content.endsWith('\n')?'':eol);
}
export async function previewIntegrationImport(snapshot:ProjectSnapshot,plan:IntegrationPlan):Promise<FileChange[]>{
  checkPlan(plan);
  if(snapshot.revisions[plan.local.path]!==plan.local.revision)throw new Error('El archivo local cambió después de comparar. Revisa un plan nuevo.');
  const files={...snapshot.files},revisions={...snapshot.revisions},original={...files};
  if(plan.local.entityId){
    for(const field of plan.fields){
      const target=field==='body'?'description':field;
      const value=target==='title'?plan.candidate.title:target==='status'?plan.candidate.status:plan.candidate.text;
      if(value===undefined)continue;
      const index=indexProject(files,revisions);const edit=planWorkItemEdit(index,files,{id:plan.local.entityId,field:target,value});
      for(const change of edit.changes){files[change.path]=change.after;revisions[change.path]=await contentHash(change.after);}
    }
  }else{
    if(!/\.md$/i.test(plan.local.path))throw new Error('La importación documental requiere Markdown. Exporta la propuesta para otros formatos.');
    if(plan.fields.includes('status'))throw new Error('El estado remoto necesita un mapping BMAD explícito; no se importará como estado documental.');
    let text=files[plan.local.path];
    if(plan.fields.some(f=>f==='body'||f==='description')&&plan.candidate.text!==undefined)text=replaceDocumentBody(text,plan.candidate.text);
    if(plan.fields.includes('title')&&plan.candidate.title!==undefined)text=replaceDocumentTitle(text,plan.candidate.title);
    files[plan.local.path]=text;
  }
  return Object.keys(files).filter(path=>files[path]!==original[path]).map(path=>({path,before:original[path],after:files[path],expectedRevision:snapshot.revisions[path]}));
}
export async function importIntegrationPlan(store:ProjectStore,plan:IntegrationPlan,options:{confirmed:boolean;reviewedChanges:FileChange[]}){
  if(!options.confirmed)throw new Error('Revisa y confirma los cambios locales antes de importar.');
  const snapshot=await store.refresh();const changes=await previewIntegrationImport(snapshot,plan);
  if(JSON.stringify(changes)!==JSON.stringify(options.reviewedChanges))throw new Error('Los archivos o el mapping cambiaron después de revisar. Vuelve a preparar el plan.');
  await store.applyChanges(changes);
}
export function exportIntegrationPlan(plan:IntegrationPlan){return JSON.stringify({schemaVersion:1,provider:plan.provider,resource:{instance:plan.resource.instance,id:plan.resource.id,url:plan.resource.url,version:plan.resource.version},direction:plan.direction,fields:plan.fields,local:plan.local,candidate:plan.candidate,blockedReasons:plan.blockedReasons,transportLoss:plan.transportLoss,reviewedPayloadHash:plan.reviewedPayloadHash},null,2)+'\n';}
