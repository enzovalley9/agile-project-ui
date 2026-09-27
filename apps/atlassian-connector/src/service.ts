import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,rename,writeFile,lstat,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {compareResource,fieldEqual,localFields,managedBody,markdownProjection,safeLocalPath} from '../../../packages/integrations/src/index';
import type {IntegrationOperation,IntegrationPlan,ManagedField,PlanRequest,RemoteResource} from '../../../packages/integrations/src/index';
import type {ProviderAdapter} from './adapters';
import {ConnectorError} from './transport';
export interface ServiceOptions {adapter:ProviderAdapter;origin:string;port:number;launcherToken:string;journalDirectory:string;sessionTtlMs?:number;planTtlMs?:number;now?:()=>number}
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function digest(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
const fieldNames:ManagedField[]=['title','description','body','status'];
function requestPlan(raw:unknown):PlanRequest {
  const p=raw as PlanRequest;
  if(!p||typeof p!=='object'||typeof p.resourceId!=='string'||!p.resourceId||!['publish','import'].includes(p.direction)||!p.local||typeof p.local.text!=='string'||p.local.text.length>1024*1024||!safeLocalPath(p.local.path)||!/^([a-f0-9]{64})$/i.test(p.local.revision)||!Array.isArray(p.fields)||!p.fields.length||p.fields.some(f=>!fieldNames.includes(f))||new Set(p.fields).size!==p.fields.length)throw new ConnectorError('invalid_plan','Plan requires a safe path, SHA256 revision, selected fields and a resource');
  if(p.fields.includes('title')&&(typeof p.local.title!=='string'||!p.local.title.trim()||p.local.title.length>1000))throw new ConnectorError('invalid_title','Provide the local title explicitly');
  if(p.fields.includes('status')&&typeof p.local.status!=='string')throw new ConnectorError('invalid_status','Provide the local status explicitly');
  if(!p.scopeId||typeof p.scopeId!=='string')throw new ConnectorError('scope_required','Select a project or space before preparing a plan');
  if(p.transitionId!==undefined&&typeof p.transitionId!=='string')throw new ConnectorError('invalid_transition','Invalid transition');
  return structuredClone(p);
}
class Journal {
  operations=new Map<string,IntegrationOperation>();
  constructor(private directory:string){}
  async initialize(){
    await mkdir(this.directory,{recursive:true,mode:0o700});const stat=await lstat(this.directory);
    if(stat.isSymbolicLink()||!stat.isDirectory()||process.platform!=='win32'&&(stat.mode&0o077))throw new ConnectorError('unsafe_journal','Journal directory must be private',500);
    await this.refresh();
  }
  async refresh(){
    try{const file=join(this.directory,'operations.json');const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32*1024*1024||process.platform!=='win32'&&(stat.mode&0o077))throw new ConnectorError('unsafe_journal','Journal file must be private and bounded',500);const values=JSON.parse(await readFile(file,'utf8')) as IntegrationOperation[];if(!Array.isArray(values)||values.length>10000)throw new Error();const loaded=new Map<string,IntegrationOperation>();for(const op of values){if(!op||!op.id||!op.planId||!op.resourceId||!['prepared','running','verified','rejected','partial','uncertain'].includes(op.status)||loaded.has(op.id))throw new Error();loaded.set(op.id,op);}this.operations=loaded;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){this.operations.clear();return;}throw new ConnectorError('unsafe_journal','Operation journal is unreadable; preserve it for recovery',500);}
  }
  async exclusive<T>(run:()=>Promise<T>):Promise<T>{
    const lock=join(this.directory,'.operation-lock');
    try{await mkdir(lock,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new ConnectorError('journal_locked','Another connector operation owns the journal. If its process stopped, inspect the private journal and remove only its stale .operation-lock directory before reconciling; never replay the request',409);throw error;}
    try{await this.refresh();return await run();}finally{await rmdir(lock);}
  }
  private pending=Promise.resolve();
  save(operation:IntegrationOperation){this.operations.set(operation.id,structuredClone(operation));const snapshot=JSON.stringify([...this.operations.values()]);this.pending=this.pending.catch(()=>undefined).then(async()=>{const temp=join(this.directory,`operations-${randomUUID()}.tmp`);await writeFile(temp,snapshot,{mode:0o600,flag:'wx'});await rename(temp,join(this.directory,'operations.json'));});return this.pending;}
}
export async function createAtlassianApp(options:ServiceOptions):Promise<Hono> {
  const originUrl=new URL(options.origin);
  if(originUrl.origin!==options.origin||!['http:','https:'].includes(originUrl.protocol)||!options.launcherToken||options.launcherToken.length<32||!Number.isInteger(options.port)||options.port<1||options.port>65535)throw new ConnectorError('invalid_configuration','Configure an exact origin, port and strong launcher capability',500);
  const app=new Hono();const adapter=options.adapter;const now=options.now??Date.now;const stamp=()=>new Date(now()).toISOString();
  const journal=new Journal(options.journalDirectory);await journal.initialize();
  const sessions=new Map<string,{expiresAt:number}>();const plans=new Map<string,{plan:IntegrationPlan;session:string}>();const busy=new Set<string>();
  const sessionOf=(auth:string|undefined)=>auth?.startsWith('Bearer ')?auth.slice(7):'';
  const checkSession=(auth:string|undefined)=>{const token=sessionOf(auth),s=sessions.get(token);if(!s||s.expiresAt<=now()){sessions.delete(token);throw new ConnectorError('session_expired','Connect this independent connector again',401);}return token;};
  app.onError((error,c)=>{const e=error instanceof ConnectorError?error:error instanceof SyntaxError?new ConnectorError('invalid_json','Request must contain valid JSON'):new ConnectorError('internal_error','The connector could not complete the request',500);return c.json({error:{code:e.code,message:e.message,...(e.operationId?{operationId:e.operationId}:{})}},e.status as 400);});
  app.use('*',bodyLimit({maxSize:1200*1024,onError:c=>c.json({error:{code:'body_too_large',message:'Request exceeds the size limit'}},413)}));
  app.use('*',async(c,next)=>{
    if(c.req.header('host')!==`127.0.0.1:${options.port}`)throw new ConnectorError('invalid_host','Connector accepts its loopback host only',403);
    const origin=c.req.header('origin');
    if(c.req.path==='/v1/health'&&c.req.method==='GET'&&!origin)return next();
    if(origin!==options.origin)throw new ConnectorError('invalid_origin','Origin is not paired with this connector',403);
    c.header('Access-Control-Allow-Origin',options.origin);c.header('Vary','Origin');c.header('Cache-Control','no-store');
    if(c.req.method==='OPTIONS'){
      const method=c.req.header('access-control-request-method');const requested=(c.req.header('access-control-request-headers')??'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
      if(!['GET','POST','DELETE'].includes(method??'')||requested.some(h=>!['authorization','content-type'].includes(h)))throw new ConnectorError('invalid_preflight','Unsupported preflight',403);
      c.header('Access-Control-Allow-Methods','GET,POST,DELETE');c.header('Access-Control-Allow-Headers','Authorization,Content-Type');return c.body(null,204);
    }
    if(c.req.method==='POST'&&c.req.header('content-type')?.split(';')[0]!=='application/json')throw new ConnectorError('invalid_content_type','JSON requests are required',415);
    if(c.req.path!=='/v1/health'&&!(c.req.path==='/v1/session'&&c.req.method==='POST'))checkSession(c.req.header('authorization'));
    await next();
  });
  app.get('/v1/health',c=>c.json({ok:true,provider:adapter.capabilities.provider,protocolVersion:1}));
  app.post('/v1/session',async c=>{
    if(!equal(sessionOf(c.req.header('authorization')),options.launcherToken))throw new ConnectorError('invalid_capability','Launcher capability is invalid',401);
    const body=await c.req.json();if(!body||Array.isArray(body)||Object.keys(body).length)throw new ConnectorError('invalid_session','Session creation accepts an empty object only');
    for(const [token,session]of sessions)if(session.expiresAt<=now()){sessions.delete(token);for(const [id,p]of plans)if(p.session===token)plans.delete(id);}
    if(sessions.size>=20)throw new ConnectorError('session_limit','Disconnect an existing session first',429);
    const identity=await adapter.identity();
    const token=randomBytes(32).toString('base64url'),expiresAt=now()+(options.sessionTtlMs??30*60*1000);sessions.set(token,{expiresAt});
    return c.json({sessionToken:token,expiresAt:new Date(expiresAt).toISOString(),provider:adapter.capabilities.provider,instance:adapter.instance,capabilities:adapter.capabilities,identity});
  });
  app.delete('/v1/session',c=>{const token=checkSession(c.req.header('authorization'));sessions.delete(token);for(const [id,p]of plans)if(p.session===token)plans.delete(id);return c.json({disconnected:true});});
  app.get('/v1/capabilities',c=>c.json(adapter.capabilities));
  app.get('/v1/scopes',async c=>c.json(await adapter.scopes()));
  app.get('/v1/search',async c=>{const scope=c.req.query('scope');if(!scope)throw new ConnectorError('scope_required','Select a project or space first');return c.json(await adapter.search(scope,c.req.query('q')??''));});
  app.get('/v1/resources/:id',async c=>c.json(await adapter.read(c.req.param('id'))));
  app.get('/v1/resources/:id/history',async c=>c.json(await adapter.history(c.req.param('id'))));
  app.post('/v1/plans',async c=>{
    const request=requestPlan(await c.req.json());const resource=await adapter.read(request.resourceId);
    if(resource.scopeId!==request.scopeId)throw new ConnectorError('scope_mismatch','Resource is outside the selected project or space',409);
    const blocked:string[]=[];for(const field of request.fields)if(!adapter.capabilities.fields.includes(field))blocked.push(`Unsupported managed field: ${field}`);
    let comparison;try{comparison=compareResource(request.local,resource,request.fields,request.base);}catch{throw new ConnectorError('invalid_base','Comparison base belongs to a different resource or versioned normalizer');}
    const body=request.fields.some(f=>f==='body'||f==='description');const projection=markdownProjection(managedBody(request.local));
    const loss=body?[...projection.unsupported,...resource.content.unsupported]:[];
    if(loss.length)blocked.push('Content contains unsupported constructs; review source outside the connector');
    if(request.direction==='publish'){
      if(!adapter.capabilities.remoteUpdate)blocked.push(...adapter.capabilities.blockedReasons);
      if(request.fields.includes('status')){const transition=resource.transitions?.find(t=>t.id===request.transitionId);if(!transition||transition.toStatusName!==request.local.status)blocked.push('Select a verified transition to the requested remote status');else if(transition.requiredFields.length)blocked.push('Transition requires additional fields not covered by this adapter');}
    }
    let candidate:IntegrationPlan['candidate']={};try{candidate=adapter.candidate(request,resource);}catch{blocked.push('Candidate cannot be represented without transport loss');}
    // A body-only import never includes metadata mutations; the browser applies each chosen field separately.
    if(request.direction==='import'&&!body)delete candidate.text;
    if(!request.fields.includes('title'))delete candidate.title;if(!request.fields.includes('status'))delete candidate.status;
    const id=randomUUID(),createdAt=stamp(),expiresAt=new Date(now()+(options.planTtlMs??5*60*1000)).toISOString();
    const reviewedPayloadHash=digest({provider:resource.provider,instance:resource.instance,resourceId:resource.id,scopeId:resource.scopeId,version:resource.version,local:request.local,fields:request.fields,direction:request.direction,candidate});
    const plan:IntegrationPlan={id,provider:resource.provider,resource,local:request.local,direction:request.direction,fields:request.fields,comparison,blockedReasons:[...new Set(blocked)],transportLoss:[...new Set(loss)],reviewedPayloadHash,createdAt,expiresAt,candidate,transitionId:request.transitionId};
    for(const [old,p]of plans)if(Date.parse(p.plan.expiresAt)<now())plans.delete(old);
    if(plans.size>=200)throw new ConnectorError('plan_limit','Too many pending plans',429);
    plans.set(id,{plan,session:checkSession(c.req.header('authorization'))});return c.json(plan);
  });
  const publicOperation=(op:IntegrationOperation):IntegrationOperation=>['prepared','running'].includes(op.status)&&!busy.has(op.resourceId)?{...op,status:'uncertain',message:'An earlier connector left an unfinished intent; inspect and reconcile without replaying'}:op;
  const findOperation=(id:string)=>{const operation=journal.operations.get(id);if(!operation||operation.provider!==adapter.capabilities.provider||operation.instance!==adapter.instance)throw new ConnectorError('operation_not_found','Operation was not found',404);return publicOperation(operation);};
  app.get('/v1/operations',async c=>{await journal.refresh();const operations=[...journal.operations.values()].filter(o=>o.provider===adapter.capabilities.provider&&o.instance===adapter.instance).sort((a,b)=>Number(['running','uncertain','partial','prepared'].includes(b.status))-Number(['running','uncertain','partial','prepared'].includes(a.status))||b.createdAt.localeCompare(a.createdAt));return c.json({items:operations.slice(0,20).map(publicOperation),complete:operations.length<=20,warnings:operations.length>20?['Older completed operations omitted']:[]});});
  app.get('/v1/operations/by-plan/:planId',async c=>{await journal.refresh();const operation=[...journal.operations.values()].find(o=>o.planId===c.req.param('planId')&&o.provider===adapter.capabilities.provider&&o.instance===adapter.instance);if(!operation)throw new ConnectorError('operation_not_found','Operation was not found',404);return c.json(publicOperation(operation));});
  app.get('/v1/operations/:id',async c=>{await journal.refresh();return c.json(findOperation(c.req.param('id')));});
  const observe=async(operation:IntegrationOperation):Promise<IntegrationOperation>=>{
    const remote=await adapter.read(operation.resourceId);const expected=Object.entries(operation.expectedFields) as [ManagedField,string][];
    const matches=expected.map(([field,value])=>fieldEqual(field,value,remote.fields[field]??''));
    operation.observed={version:remote.version,observedAt:remote.observedAt,fields:remote.fields};operation.updatedAt=stamp();
    operation.status=matches.length&&matches.every(Boolean)?'verified':matches.some(Boolean)?'partial':'uncertain';
    operation.message=operation.status==='verified'?'Selected remote fields match the reviewed values':operation.status==='partial'?'Only some selected fields match; no automatic replay is allowed':'The current remote state does not prove the intended result; no automatic replay is allowed';
    await journal.save(operation);return operation;
  };
  app.post('/v1/operations',async c=>journal.exclusive(async()=>{
    const body=await c.req.json();if(!body||typeof body.planId!=='string'||Object.keys(body).some(k=>k!=='planId'))throw new ConnectorError('invalid_operation','Execute by reviewed planId only');
    const duplicate=[...journal.operations.values()].find(o=>o.planId===body.planId&&o.provider===adapter.capabilities.provider&&o.instance===adapter.instance);if(duplicate)return c.json(publicOperation(duplicate));
    const saved=plans.get(body.planId),session=checkSession(c.req.header('authorization'));
    if(!saved||saved.session!==session)throw new ConnectorError('plan_not_found','Prepare and review a plan in this session',404);
    const plan=saved.plan;if(Date.parse(plan.expiresAt)<=now())throw new ConnectorError('plan_expired','The reviewed plan expired',409);
    if(plan.direction==='import')throw new ConnectorError('browser_import_required','Apply reviewed import fields through the browser filesystem with its current revision',409);
    if(plan.blockedReasons.length||!adapter.capabilities.remoteUpdate)throw new ConnectorError('blocked_plan',plan.blockedReasons.join('; ')||'Remote updates are disabled',409);
    const key=plan.resource.id;if(busy.has(key))throw new ConnectorError('resource_busy','Another operation is active for this resource',409);
    if([...journal.operations.values()].some(o=>o.resourceId===key&&o.instance===adapter.instance&&['running','uncertain','partial'].includes(o.status)))throw new ConnectorError('reconciliation_required','Reconcile the unresolved operation first',409);
    busy.add(key);
    try{
      const fresh=await adapter.read(key);if(fresh.version!==plan.resource.version||fresh.scopeId!==plan.resource.scopeId||plan.fields.some(f=>!fieldEqual(f,fresh.fields[f]??'',plan.resource.fields[f]??'')))throw new ConnectorError('remote_stale','Remote content or version changed since review',409);
      const values=localFields(plan.local),time=stamp();const operation:IntegrationOperation={id:randomUUID(),planId:plan.id,provider:plan.provider,instance:adapter.instance,resourceId:key,direction:'publish',status:'prepared',message:'Reviewed request persisted before transmission',createdAt:time,updatedAt:time,expectedVersion:plan.resource.version,expectedFields:Object.fromEntries(plan.fields.map(f=>[f,values[f]??''])),reviewedPayloadHash:plan.reviewedPayloadHash};
      await journal.save(operation);operation.status='running';operation.message='Request is in progress';await journal.save(operation);
      try{await adapter.apply(plan);}catch(error){operation.status=error instanceof ConnectorError&&['remote_stale','provider_forbidden','provider_auth_expired','provider_not_found'].includes(error.code)?'rejected':'uncertain';operation.message=operation.status==='rejected'?'Provider rejected the request before a verified update':'The request outcome is unknown; reconcile without replaying';operation.updatedAt=stamp();await journal.save(operation);return c.json(operation);}
      try{return c.json(await observe(operation));}catch{operation.status='uncertain';operation.message='Request returned but verification is unavailable; reconcile without replaying';operation.updatedAt=stamp();await journal.save(operation);return c.json(operation);}
    }finally{busy.delete(key);}
  }));
  app.post('/v1/operations/:id/reconcile',async c=>journal.exclusive(async()=>{const operation=findOperation(c.req.param('id'));if(busy.has(operation.resourceId))throw new ConnectorError('resource_busy','Operation is still active',409);busy.add(operation.resourceId);try{return c.json(await observe(operation));}finally{busy.delete(operation.resourceId);}}));
  app.notFound(c=>c.json({error:{code:'not_found',message:'Unknown connector route'}},404));
  return app;
}
