import { parse as parseToml } from 'smol-toml';
import { catalog } from './catalog';
import { discoverConfiguration } from './configuration';
import { hasMergeConflict } from './conflicts';
import { frontmatter, isRecord, isSafePath, markdownChecks, markdownHeadings, markdownLinks, markdownTree, parseYaml, ref, resolveDocumentLink, safeRecord, section, textValue, yamlScalar, type ParsedYaml } from './source';
import type { ChecklistItem, Diagnostic, DocumentKind, DocumentRecord, FieldTarget, FileSnapshot, IndexOptions, ProjectIndex, RevisionSnapshot, SourceRef, StatusValue, WorkItem, WorkItemKind } from './types';

export const SPRINT_STORY_STATES = ['backlog','ready-for-dev','in-progress','review','done'];
export const EPIC_STATES = ['backlog','in-progress','done'];
export const BUILD_STATES = ['draft','ready-for-dev','in-progress','in-review','done'];
export const BUILD_AUTO_STATES = [...BUILD_STATES,'blocked'];
export const RETRO_STATES = ['optional','done'];
export const ACTION_STATES = ['open','in-progress','done'];
const TEXT_EXTENSIONS = /\.(md|mdx|txt|yaml|yml|toml|json|csv|html|xml)$/i;
const MD_EXTENSIONS = /\.(md|mdx)$/i;
const baseName = (path:string) => path.split('/').at(-1)!;
const sibling = (path:string,name:string) => [...path.split('/').slice(0,-1),name].join('/');
const displayFile = (path:string) => baseName(path).replace(/\.[^.]+$/,'');
function makeItem(id:string,kind:WorkItemKind,title:string,source:SourceRef,family:WorkItem['family']):WorkItem {
  return {id,kind,title,source,family,relatedStatuses:[],checklist:[],editable:{title:false,description:false,status:false},fields:{},warnings:[],relatedPaths:[]};
}
function status(raw:string,allowed:string[],source:SourceRef,role:StatusValue['role'],diagnostics:Diagnostic[]):StatusValue {
  const legacy = role === 'sprint' || role === 'execution' ? ({drafted:'ready-for-dev',contexted:'in-progress'} as Record<string,string>)[raw] : undefined;
  const valid=allowed.includes(raw) || !!legacy;
  if(!valid) diagnostics.push({code:'status-unknown',severity:'warning',path:source.path,message:`Estado «${raw}» no reconocido para esta entidad; se conserva el valor original.`});
  return {raw,normalized:legacy,valid,allowed:[...allowed],source,role};
}
function scalarTarget(parsed:ParsedYaml|undefined,keys:(string|number)[],path:string,revision:string,text:string):FieldTarget|undefined {
  if(!parsed) return; const scalar=yamlScalar(parsed,keys); if(!scalar) return;
  return {value:scalar.value,format:'yaml-scalar',source:ref(path,revision,text,scalar.start,scalar.end,`yaml:${JSON.stringify(keys)}`)};
}
function assignField(item:WorkItem,key:'title'|'description'|'status',target:FieldTarget|undefined,editable=true) {
  if(target) { item.fields[key]=target; item.editable[key]=editable; }
}
function classify(path:string,metadata:Record<string,unknown>,text:string):DocumentKind {
  const name=baseName(path).toLowerCase();
  if(name==='sprint-status.yaml' || name==='sprint-status.yml') return 'sprint';
  if(name==='stories.yaml' || name==='stories.yml') return 'stories';
  if(name==='tickets.toml') return 'toml';
  if(name==='epics.md' || /(^|\/)epics\/.*\.md$/i.test(path)) return 'epics';
  if(name==='spec.md') return 'spec';
  if(name==='architecture-spine.md' || metadata.type==='architecture-spine' || name==='architecture.md') return 'architecture';
  if(/^adr[-_\d]/i.test(name) || /(^|\/)adrs?\//i.test(path)) return 'adr';
  if(/(^|[-_])prd(?:[-_.]|$)/i.test(name)) return 'prd';
  if(['design.md','experience.md'].includes(name)) return 'ux';
  if(name==='retrospective.md' || /retro(?:spective)?[-_.]/i.test(name)) return 'retrospective';
  if(name==='project-context.md' || /^epic-\d+-context\.md$/i.test(name)) return 'context';
  if(MD_EXTENSIONS.test(path) && typeof metadata.status === 'string' && (name.startsWith('spec-') || ['feature','bugfix','refactor','chore'].includes(String(metadata.type)) || ['oneshot','small','medium','large'].includes(String(metadata.route)))) return 'build';
  if(MD_EXTENSIONS.test(path) && /^#\s+Story\s+\d+\.\d+[a-z]?:/im.test(text)) return 'story';
  if(MD_EXTENSIONS.test(path)) return 'markdown';
  if(/\.ya?ml$/i.test(path)) return 'yaml';
  if(/\.toml$/i.test(path)) return 'toml';
  if(/\.json$/i.test(path)) return 'json';
  return 'text';
}

export function indexProject(input:FileSnapshot,revisions:RevisionSnapshot={},options:IndexOptions={}):ProjectIndex {
  const files:Record<string,string>=Object.create(null), exclusions:string[]=[], diagnostics:Diagnostic[]=[];
  for(const [path,text] of Object.entries(input)) {
    if(!isSafePath(path)) { exclusions.push(path); diagnostics.push({code:'unsafe-path',severity:'warning',path,message:'Ruta excluida del ámbito autorizado.'}); continue; }
    if(typeof text !== 'string' || text.includes('\0') || new TextEncoder().encode(text).length>2*1024*1024) { exclusions.push(path); diagnostics.push({code:'unreadable-text',severity:'warning',path,message:'Texto binario, codificación no admitida o archivo superior a 2 MiB.'}); continue; }
    files[path]=text;
  }
  const conflicted=new Set(Object.keys(files).filter(path=>hasMergeConflict(files[path])));
  const interpretableFiles=Object.fromEntries(Object.entries(files).filter(([path])=>!conflicted.has(path)));
  const config=discoverConfiguration(interpretableFiles,diagnostics,options);
  const documents:DocumentRecord[]=[], workItems:WorkItem[]=[];
  const parsedFiles=new Map<string,ParsedYaml>();
  for(const path of Object.keys(files).sort((a,b)=>a.localeCompare(b,'en'))) {
    const text=files[path], revision=revisions[path] || '';
    if(conflicted.has(path)) {
      const message='El archivo contiene marcadores de conflicto. Resuélvelo fuera de la aplicación y relee los archivos antes de editar.';
      diagnostics.push({code:'merge-conflict',severity:'error',path,message});
      documents.push({path,title:displayFile(path),kind:'text',revision,derived:false,capabilities:{read:true,comment:true,textEdit:false,structuredEdit:false},headings:[],links:[],metadata:{},warnings:[message],parseValid:false,lineCount:text.split('\n').length});
      continue;
    }
    if(path.startsWith('_bmad/') || path.startsWith('.bmad-project-ui/')) continue;
    if(!TEXT_EXTENSIONS.test(path)) { exclusions.push(path); continue; }
    if(/(^|\/)tickets\.toml$/i.test(path)) diagnostics.push({code:'ticketing-unsupported',severity:'warning',path,message:'El formato ticketing de main no forma parte del adaptador 6.12.0. Se ofrece lectura y edición textual.'});
    const fm=MD_EXTENSIONS.test(path)?frontmatter(text,path,diagnostics):{metadata:{},bodyStart:0,valid:true,parsed:undefined};
    let valid=fm.valid;
    if(/\.ya?ml$/i.test(path)) { const parsed=parseYaml(text,path,diagnostics); parsedFiles.set(path,parsed); valid=parsed.valid; }
    if(/\.json$/i.test(path)) { try { JSON.parse(text.replace(/^\uFEFF/,'')); } catch { valid=false; diagnostics.push({code:'invalid-json',severity:'error',path,message:'JSON no válido; disponible como texto.'}); } }
    if(/\.toml$/i.test(path)) { try { parseToml(text, { unsafeKeyBehaviour: 'throw', integersAsBigInt: 'asNeeded' }); } catch { valid=false; diagnostics.push({code:'invalid-toml',severity:'error',path,message:'TOML no válido; disponible como texto.'}); } }
    const tree=MD_EXTENSIONS.test(path)?markdownTree(text,fm.bodyStart):undefined;
    const headings=tree?markdownHeadings(tree,text,path,revision):[];
    let kind=classify(path,fm.metadata,text);
    // A fenced Story example must never turn a generic document into a story.
    if(kind==='story' && !headings.some(heading=>/^Story\s+\d+\.\d+[a-z]?:/i.test(heading.title))) kind='markdown';
    const derived=['spec','architecture','prd','ux'].includes(kind) && (kind==='spec' || Object.hasOwn(files,sibling(path,'.memlog.md')));
    const warnings:string[]=derived?['BMAD puede regenerar este documento y sobrescribir la edición manual. No se actualizará su memlog.']:[];
    if(!valid) warnings.push('Formato no interpretable: la edición textual sigue disponible, sin garantías de edición estructurada.');
    const doc:DocumentRecord={path,title:textValue(fm.metadata.title)||headings[0]?.title||displayFile(path),kind,revision,derived,capabilities:{read:true,comment:true,textEdit:true,structuredEdit:false},headings,links:tree?markdownLinks(tree,path,files):[],metadata:fm.metadata,warnings,parseValid:valid,lineCount:text.split('\n').length};
    for(const field of ['companions','sources','inputDocuments']) {
      const values=fm.metadata[field];
      if(Array.isArray(values)) for(const entry of values) {
        const href=typeof entry==='string'?entry:textValue(safeRecord(entry).path);
        if(href)doc.links.push({href,...resolveDocumentLink(path,href,files),line:1,image:false});
      }
    }
    documents.push(doc);
    const checks=tree?markdownChecks(tree,text,path,revision):[];
    if(valid && kind==='sprint') parseSprint(path,text,revision,parsedFiles.get(path)!,workItems,diagnostics);
    else if(valid && kind==='stories') parseStories(path,text,revision,parsedFiles.get(path)!,workItems,diagnostics);
    else if(valid && kind==='build') {
      const automatic=Object.hasOwn(fm.metadata,'followup_review_recommended') || Object.hasOwn(fm.metadata,'warnings') || Object.hasOwn(fm.metadata,'deferred') || fm.metadata.status==='blocked';
      const item=makeItem(`${path}#build`,'build',doc.title,ref(path,revision,text,0,text.length,'build'),automatic?'build-auto':'build');
      item.documentPath=path; item.checklist=checks;
      assignField(item,'title',scalarTarget(fm.parsed,['title'],path,revision,text));
      const target=scalarTarget(fm.parsed,['status'],path,revision,text); assignField(item,'status',target);
      if(target) item.status=status(target.value,automatic?BUILD_AUTO_STATES:BUILD_STATES,target.source,'execution',diagnostics);
      const description=section(text,headings,/^(Intent|Description|Overview)$/i);
      if(description) { item.description=description.value; assignField(item,'description',{...description,format:'markdown-section',source:ref(path,revision,text,description.start,description.end,'section:description')}); }
      const native=/^(?:spec-)?(\d+)-(\d+[a-z]?)-/i.exec(baseName(path)); if(native) { item.nativeId=`${native[1]}.${native[2]}`; item.epicId=native[1]; }
      workItems.push(item);
    } else if(valid && tree) parseMarkdownWork(doc,text,checks,workItems,diagnostics);
    if(checks.length && !['story','build','epics'].includes(kind)) {
      // General checklist lines remain distinct work units, never sprint stories.
      for(const check of checks) {
        const item=makeItem(check.id,'checklist',check.text,check.source,'checklist'); item.documentPath=path; item.checklist=[check];
        item.status={raw:check.checked?'checked':'unchecked',valid:true,allowed:['unchecked','checked'],role:'checklist',source:check.source}; workItems.push(item);
      }
    }
  }
  relate(workItems,documents.filter(doc=>doc.parseValid),interpretableFiles,diagnostics);
  for(const doc of documents) {
    doc.capabilities.structuredEdit=workItems.some(item=>item.source.path===doc.path && Object.values(item.editable).some(Boolean));
    for(const link of doc.links) if(link.kind==='local' && !link.exists) diagnostics.push({code:'broken-link',severity:'info',path:doc.path,message:`Enlace local no encontrado: ${link.href}`,relatedPaths:link.target?[link.target]:undefined});
    if(doc.kind==='ux') {
      const counterpart=baseName(doc.path).toLowerCase()==='design.md'?'EXPERIENCE.md':'DESIGN.md';
      if(!Object.keys(files).some(path=>path.toLowerCase()===sibling(doc.path,counterpart).toLowerCase())) diagnostics.push({code:'ux-partial',severity:'info',path:doc.path,message:`Contrato UX parcial: falta ${counterpart}.`});
    }
    if(doc.path.endsWith('/index.md')) {
      const whole=doc.path.replace(/\/index\.md$/,'.md');
      if(Object.hasOwn(files,whole)) diagnostics.push({code:'document-representations-ambiguous',severity:'warning',path:doc.path,relatedPaths:[whole],message:'Coexisten documento completo e índice fragmentado; se conservan ambos sin elegir vigencia.'});
    }
  }
  if(!documents.some(doc=>doc.kind==='sprint')) diagnostics.push({code:'sprint-absent',severity:'info',message:'No se ha encontrado seguimiento de sprint; no equivale a ausencia de trabajo.'});
  const result=catalog(interpretableFiles,config,diagnostics);
  return {name:config.name,declaredVersion:config.version,compatibility:config.version==='6.12.0'?'6.12.0':'unknown',roots:config.roots,documents,workItems,...result,diagnostics,coverage:{filesProvided:Object.keys(input).length,documents:documents.length,excluded:exclusions.length,partial:exclusions.length>0 || diagnostics.some(d=>d.severity==='error'),exclusions}};
}

function parseSprint(path:string,text:string,revision:string,parsed:ParsedYaml,items:WorkItem[],diagnostics:Diagnostic[]) {
  const data=safeRecord(parsed.data), states=data.development_status;
  if(!isRecord(states)) { diagnostics.push({code:'sprint-schema-invalid',severity:'error',path,message:'Sprint sin mapa development_status; no se generan estados ficticios.'}); return; }
  for(const [key,value] of Object.entries(states)) {
    const epic=/^epic-(\d+)$/i.exec(key), retro=/^epic-(\d+)-retrospective$/i.exec(key), story=/^(\d+)-(\d+[a-z]?)-(.+)$/i.exec(key);
    if(!epic && !retro && !story) { diagnostics.push({code:'sprint-key-unknown',severity:'warning',path,message:`Clave de sprint no reconocida: ${key}.`}); continue; }
    const field=scalarTarget(parsed,['development_status',key],path,revision,text);
    if(!field || typeof value!=='string') { diagnostics.push({code:'sprint-status-invalid',severity:'error',path,message:`El estado de ${key} debe ser texto escalar.`}); continue; }
    const kind=epic?'epic':retro?'retrospective':'story';
    const item=makeItem(`${path}#development_status:${key}`,kind,epic?`Epic ${epic[1]}`:retro?`Retrospectiva de Epic ${retro[1]}`:key,field.source,'sprint');
    item.nativeId=epic?epic[1]:retro?`epic-${retro[1]}-retrospective`:`${story![1]}.${story![2]}`;
    item.epicId=epic?undefined:(retro?.[1]||story![1]);
    item.status=status(value,epic?EPIC_STATES:retro?RETRO_STATES:SPRINT_STORY_STATES,field.source,'sprint',diagnostics);
    assignField(item,'status',field,item.status.valid); items.push(item);
  }
  const actions=data.action_items;
  if(Array.isArray(actions)) for(let index=0;index<actions.length;index++) {
    const value=safeRecord(actions[index]); const target=scalarTarget(parsed,['action_items',index,'status'],path,revision,text);
    const title=textValue(value.description)||textValue(value.title)||textValue(value.action);
    if(!title || !target) continue;
    const item=makeItem(`${path}#action_items:${index}`,'action',title,target.source,'retro-action');
    item.nativeId=textValue(value.id); item.status=status(target.value,ACTION_STATES,target.source,'action',diagnostics); assignField(item,'status',target,item.status.valid); items.push(item);
  }
}
function parseStories(path:string,text:string,revision:string,parsed:ParsedYaml,items:WorkItem[],diagnostics:Diagnostic[]) {
  if(!Array.isArray(parsed.data)) { diagnostics.push({code:'stories-schema-invalid',severity:'error',path,message:'stories.yaml debe ser una lista ordenada.'}); return; }
  const identities:string[]=[];
  for(let index=0;index<parsed.data.length;index++) {
    const value=safeRecord(parsed.data[index]);
    const id=typeof value.id==='string'?value.id:undefined, title=typeof value.title==='string'?value.title:undefined, description=typeof value.description==='string'?value.description:undefined;
    if(!id || !/^[A-Za-z0-9-]+$/.test(id) || !title || /\r|\n/.test(title) || description===undefined) { diagnostics.push({code:'stories-entry-invalid',severity:'error',path,message:`La entrada ${index+1} necesita id de texto, título de una línea y descripción.`}); continue; }
    const titleField=scalarTarget(parsed,[index,'title'],path,revision,text), descriptionField=scalarTarget(parsed,[index,'description'],path,revision,text);
    if(!titleField) continue;
    const item=makeItem(`${path}#stories:${id}:${index}`,'story',title,titleField.source,'spec-story'); item.nativeId=id; item.description=description;
    assignField(item,'title',titleField); assignField(item,'description',descriptionField);
    const forbidden=Object.hasOwn(value,'status');
    if(forbidden) { item.warnings.push('stories.yaml no admite status; no se usa como estado de ejecución.'); diagnostics.push({code:'stories-status-forbidden',severity:'error',path,message:item.warnings[0]}); item.editable.title=false;item.editable.description=false; }
    const invalidOptional=['spec_checkpoint','done_checkpoint'].some(key=>Object.hasOwn(value,key)&&typeof value[key]!=='boolean') || (Object.hasOwn(value,'invoke_dev_with')&&typeof value.invoke_dev_with!=='string');
    if(invalidOptional) { item.warnings.push('Campos opcionales de stories.yaml con tipo no admitido.'); item.editable.title=false;item.editable.description=false;diagnostics.push({code:'stories-entry-invalid',severity:'error',path,message:item.warnings.at(-1)!}); }
    identities.push(id); items.push(item);
  }
  for(const item of items.filter(item=>item.source.path===path&&item.family==='spec-story')) {
    const id=item.nativeId!;
    if(identities.filter(candidate=>candidate===id).length>1 || identities.some(candidate=>candidate!==id&&(candidate.startsWith(id+'-')||id.startsWith(candidate+'-')))) {
      item.editable={title:false,description:false,status:false};item.warnings.push('IDs duplicados o con prefijos ambiguos; no se puede asociar la ejecución.'); diagnostics.push({code:'stories-id-ambiguous',severity:'error',path,message:item.warnings.at(-1)!});
    }
  }
}
function parseMarkdownWork(doc:DocumentRecord,text:string,checks:ChecklistItem[],items:WorkItem[],diagnostics:Diagnostic[]) {
  const {path,revision,headings}=doc;
  const epicHeadings=headings.filter(h=>h.level>=2&&h.level<=4&&/^Epic\s+\d+:/i.test(h.title));
  const storyHeadings=headings.filter(h=>h.level<=4&&/^Story\s+\d+\.\d+[a-z]?:/i.test(h.title));
  if(!epicHeadings.length && !storyHeadings.length) return;
  for(const heading of [...epicHeadings,...storyHeadings].sort((a,b)=>a.start-b.start)) {
    const match=/^(Epic|Story)\s+(\d+(?:\.\d+[a-z]?)?):\s*(.*)$/i.exec(heading.title)!;
    const kind=match[1].toLowerCase()==='epic'?'epic':'story', nativeId=match[2];
    const standalone=kind==='story'&&heading.level===1&&storyHeadings.length===1&&doc.kind==='story';
    const item=makeItem(`${path}#${kind}:${nativeId}:${heading.start}`,kind,match[3],heading,standalone?'legacy-story':'epic-breakdown');
    item.nativeId=nativeId; item.epicId=kind==='story'?nativeId.split('.')[0]:undefined; item.documentPath=standalone?path:undefined;
    const end=headings.find(h=>h.start>heading.start&&h.level<=heading.level)?.start??text.length;
    const slice=text.slice(heading.start,heading.end), colon=slice.indexOf(':');
    if(colon>=0) { const trailing=/\s+#+\s*$/.exec(slice)?.index??slice.length; let start=heading.start+colon+1;while(/[ \t]/.test(text[start]||'')&&start<heading.end)start++;assignField(item,'title',{value:text.slice(start,heading.start+trailing),format:'plain',source:ref(path,revision,text,start,heading.start+trailing,'heading:title')},standalone); }
    const relevantHeadings=headings.filter(h=>h.start>heading.start&&h.start<end);
    const description=standalone?section(text,relevantHeadings,/^(Story|Description|Intent)$/i):undefined;
    if(description) { item.description=description.value; assignField(item,'description',{value:description.value,format:'markdown-section',source:ref(path,revision,text,description.start,description.end,'section:description')}); }
    else {
      const firstNewline=text.indexOf('\n',heading.end); let start=firstNewline>=0?firstNewline+1:heading.end;
      const firstSubheading=relevantHeadings[0]?.start??end;let descEnd=firstSubheading;
      while(start<descEnd&&/\s/.test(text[start]))start++;while(descEnd>start&&/\s/.test(text[descEnd-1]))descEnd--;
      if(descEnd>start) {
        item.description=text.slice(start,descEnd);
        assignField(item,'description',{value:item.description,format:'markdown-section',source:ref(path,revision,text,start,descEnd,'section:narrative')});
      }
    }
    item.checklist=checks.filter(check=>check.source.start>heading.start&&check.source.start<end);
    if(standalone) {
      // Recognize body status only outside code fences through paragraph AST ranges.
      const tree=markdownTree(text,frontmatter(text,path,[]).bodyStart);
      const paragraphs:{start:number;end:number}[]=[];
      const collect=(node:typeof tree)=>{if(node.type==='paragraph'&&node.position)paragraphs.push({start:node.position.start.offset||0,end:node.position.end.offset||0});node.children?.forEach(collect);};collect(tree);
      const candidates=paragraphs.flatMap(p=>[...text.slice(p.start,p.end).matchAll(/^Status:[ \t]*([^\r\n]+)\r?$/gim)].map(m=>({start:p.start+m.index!+m[0].indexOf(m[1]),value:m[1]})));
      if(candidates.length===1) { const candidate=candidates[0];const source=ref(path,revision,text,candidate.start,candidate.start+candidate.value.length,'body:Status');item.status=status(candidate.value,SPRINT_STORY_STATES,source,'execution',diagnostics);assignField(item,'status',{value:candidate.value,format:'plain',source},item.status.valid); }
      else if(candidates.length>1) { item.warnings.push('Varias líneas Status: impiden determinar el campo de estado.');diagnostics.push({code:'status-ambiguous',severity:'warning',path,message:item.warnings.at(-1)!}); }
    }
    items.push(item);
  }
}

/** Select one presentation of a known entity while retaining every source in the index. */
export function visibleWorkItems(index:ProjectIndex):WorkItem[] {
  const rank=(item:WorkItem)=>({sprint:0,'legacy-story':1,'epic-breakdown':2}[item.family as 'sprint'|'legacy-story'|'epic-breakdown']??-1);
  return index.workItems.filter(item=> {
    if(!item.nativeId||!['sprint','legacy-story','epic-breakdown'].includes(item.family))return true;
    // Ambiguous identities across independent documents remain visible for review.
    return !index.workItems.some(other=>other.kind===item.kind&&other.nativeId===item.nativeId&&rank(other)>=0&&rank(other)<rank(item));
  });
}
function relate(items:WorkItem[],documents:DocumentRecord[],files:FileSnapshot,diagnostics:Diagnostic[]) {
  const sprint=items.filter(item=>item.family==='sprint');
  const breakdown=items.filter(item=>item.family==='epic-breakdown');
  for(const item of items) {
    if(item.family==='spec-story') {
      const folder=item.source.path.split('/').slice(0,-1).join('/');
      const candidates=items.filter(other=>(other.family==='build'||other.family==='build-auto')&&other.source.path.startsWith(`${folder}/stories/${item.nativeId}-`));
      if(candidates.length===1 && !item.warnings.some(w=>w.includes('IDs duplicados'))) { const candidate=candidates[0];item.documentPath=candidate.source.path;item.relatedPaths=[candidate.source.path];if(candidate.status)item.relatedStatuses.push(candidate.status); }
      else if(candidates.length>1) { item.warnings.push('Varios archivos de ejecución coinciden con el ID.');diagnostics.push({code:'execution-ambiguous',severity:'warning',path:item.source.path,relatedPaths:candidates.map(c=>c.source.path),message:item.warnings.at(-1)!}); }
      else item.warnings.push('Todavía no hay un documento de ejecución asociado.');
      continue;
    }
    if(item.family==='sprint') {
      const descriptions=breakdown.filter(other=>other.kind===item.kind&&other.nativeId===item.nativeId);
      if(descriptions.length===1) {
        item.title=descriptions[0].title; item.description=descriptions[0].description;item.relatedPaths.push(descriptions[0].source.path);
        assignField(item,'description',descriptions[0].fields.description,descriptions[0].editable.description);
      }
      else if(descriptions.length>1) { item.warnings.push('Identidad presente en varios breakdowns; relación ambigua.');diagnostics.push({code:'work-identity-ambiguous',severity:'warning',path:item.source.path,relatedPaths:descriptions.map(i=>i.source.path),message:item.warnings.at(-1)!}); }
      const executions=items.filter(other=>['legacy-story','build','build-auto'].includes(other.family)&&other.nativeId===item.nativeId&&item.kind==='story');
      if(executions.length===1) { item.documentPath=executions[0].source.path;item.relatedPaths.push(executions[0].source.path);item.checklist=executions[0].checklist;if(executions[0].status)item.relatedStatuses.push(executions[0].status); }
      else if(executions.length>1) { item.warnings.push('Varios documentos de ejecución para esta historia.');item.editable.status=false;diagnostics.push({code:'execution-ambiguous',severity:'warning',path:item.source.path,relatedPaths:executions.map(i=>i.source.path),message:item.warnings.at(-1)!}); }
      else if(item.kind==='story') item.warnings.push('Documento de historia todavía no creado o asociación no verificada.');
    }
    if(['legacy-story','build','build-auto','epic-breakdown'].includes(item.family)) {
      const matches=sprint.filter(other=>other.kind===item.kind&&other.nativeId===item.nativeId || (item.kind==='build'&&other.kind==='story'&&!!item.nativeId&&other.nativeId===item.nativeId));
      if(matches.length===1&&matches[0].status) {
        item.relatedStatuses.push(matches[0].status); item.relatedPaths.push(matches[0].source.path);
        if(item.family==='legacy-story') { item.editable.title=false;item.warnings.push('El título interviene en la clave de sprint; su cambio estructurado necesita una migración de identidad.'); }
        if(item.family==='legacy-story'&&item.status&&item.status.raw!==matches[0].status.raw&&item.status.normalized!==matches[0].status.raw&&matches[0].status.normalized!==item.status.raw) {
          item.editable.status=false;matches[0].editable.status=false; item.warnings.push('El estado de la historia discrepa del sprint. Revisa ambas fuentes antes de editarlo.');diagnostics.push({code:'status-discrepancy',severity:'warning',path:item.source.path,relatedPaths:[matches[0].source.path],message:item.warnings.at(-1)!});
        }
      } else if(matches.length>1) { item.editable.status=false;item.warnings.push('Más de una fuente de sprint para esta identidad.');diagnostics.push({code:'sprint-association-ambiguous',severity:'warning',path:item.source.path,relatedPaths:matches.map(match=>match.source.path),message:item.warnings.at(-1)!}); }
    }
  }
  for(const epic of sprint.filter(item=>item.kind==='epic'&&item.status?.raw==='done')) {
    if(sprint.some(item=>item.kind==='story'&&item.epicId===epic.nativeId&&item.status?.raw!=='done'))diagnostics.push({code:'epic-inconsistent',severity:'warning',path:epic.source.path,message:`Epic ${epic.nativeId} figura done con historias pendientes según el sprint.`});
  }
  for(const document of documents.filter(doc=>doc.kind==='context'&&/^epic-/.test(baseName(doc.path)))) {
    document.warnings.push('Contexto compilado: la existencia del archivo no acredita vigencia frente a los documentos de planificación.');
  }
  // Same native identity in one file is always ambiguous, even with separate offsets.
  const groups=new Map<string,WorkItem[]>();
  for(const item of items.filter(item=>item.nativeId&&['epic-breakdown','sprint'].includes(item.family))) {const key=`${item.source.path}:${item.kind}:${item.nativeId}`;groups.set(key,[...(groups.get(key)||[]),item]);}
  for(const group of groups.values()) if(group.length>1) {for(const item of group)item.editable={title:false,description:false,status:false};diagnostics.push({code:'work-id-duplicate',severity:'error',path:group[0].source.path,message:`Identificador ${group[0].nativeId} repetido dentro del documento.`});}
}
