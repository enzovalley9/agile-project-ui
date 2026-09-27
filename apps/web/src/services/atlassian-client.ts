import type {Provider,AdapterCapabilities,Scope,ResourceSummary,Page,RemoteResource,HistoryEntry,PlanRequest,IntegrationPlan,IntegrationOperation} from '../../../../packages/integrations/src/types';
export * from '../../../../packages/integrations/src/types';
export class AtlassianClient {
  private token='';instance='';identity?:{id:string;displayName:string};readonly baseUrl:string;
  constructor(readonly provider:Provider,url=`http://127.0.0.1:${provider==='jira'?43121:43122}`){
    const parsed=new URL(url);
    if(parsed.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error('El conector debe usar una dirección local HTTP sin rutas ni credenciales.');
    this.baseUrl=parsed.origin;
  }
  get connected(){return !!this.token&&!!this.instance;}
  private async request<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
    const headers:Record<string,string>={};if(this.token)headers.Authorization=`Bearer ${this.token}`;if(body!==undefined)headers['Content-Type']='application/json';
    let response:Response;
    try{response=await fetch(this.baseUrl+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path==='/v1/operations'?125000:25000),credentials:'omit',cache:'no-store',redirect:'error'});}
    catch{throw new Error('No se recibió respuesta del conector. Conserva el plan y comprueba su resultado antes de repetir una operación.');}
    const data=await response.json();if(!response.ok)throw Object.assign(new Error(data?.error?.message??'El conector rechazó la petición.'),{code:data?.error?.code,operationId:data?.error?.operationId});return data;
  }
  health(){return this.request<{provider:Provider;protocolVersion:number}>('/v1/health');}
  async authorize(launcherToken:string){
    this.token=launcherToken;
    try{const result=await this.request<{sessionToken:string;expiresAt:string;provider:Provider;instance:string;capabilities:AdapterCapabilities;identity:{id:string;displayName:string}}>('/v1/session',{});if(result.provider!==this.provider)throw new Error('El servicio conectado no corresponde a esta integración.');this.token=result.sessionToken;this.instance=result.instance;this.identity=result.identity;return result;}
    catch(e){this.token='';this.instance='';this.identity=undefined;throw e;}
  }
  async disconnect(){try{if(this.token)await this.request('/v1/session',undefined,'DELETE');}finally{this.token='';this.instance='';this.identity=undefined;}}
  capabilities(){return this.request<AdapterCapabilities>('/v1/capabilities');}
  scopes(){return this.request<Page<Scope>>('/v1/scopes');}
  search(scope:string,q:string){return this.request<Page<ResourceSummary>>(`/v1/search?scope=${encodeURIComponent(scope)}&q=${encodeURIComponent(q)}`);}
  resource(id:string){return this.request<RemoteResource>('/v1/resources/'+encodeURIComponent(id));}
  history(id:string){return this.request<Page<HistoryEntry>>('/v1/resources/'+encodeURIComponent(id)+'/history');}
  plan(request:PlanRequest){return this.request<IntegrationPlan>('/v1/plans',request);}
  apply(planId:string){return this.request<IntegrationOperation>('/v1/operations',{planId});}
  pendingOperations(){return this.request<Page<IntegrationOperation>>('/v1/operations');}
  operationByPlan(planId:string){return this.request<IntegrationOperation>('/v1/operations/by-plan/'+encodeURIComponent(planId));}
  reconcile(id:string){return this.request<IntegrationOperation>('/v1/operations/'+encodeURIComponent(id)+'/reconcile',{});}
}
