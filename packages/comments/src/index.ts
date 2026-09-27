export type ReactionKind = 'like' | 'dislike' | 'approve' | 'disapprove' | string;
export interface Actor { id: string; name: string }
export interface Reaction { kind: ReactionKind; actorId: string }
export interface Message { id: string; author: Actor; text: string; createdAt: string; editedAt?: string; reactions: Reaction[]; revisions?: {text:string; editedAt:string; actor:Actor}[] }
export interface Anchor { path: string; revision: string; startLine: number; endLine: number; quote: string; prefix: string; suffix: string; startOffset?:number; endOffset?:number }
export interface Thread { schemaVersion: 1; id: string; anchor: Anchor; status: 'open'|'resolved'; messages: Message[]; createdAt: string; updatedAt: string; resolvedBy?: Actor; resolvedAt?: string; events?: {type:string; at:string; actor:Actor; previousAnchor?:Anchor}[] }
export interface AnchorResolution { state: 'exact'|'moved'|'ambiguous'|'outdated'|'missing'; startLine?: number; endLine?: number }
export const COMMENTS_ROOT = '.bmad-project-ui/comments/threads';
export function threadPath(id: string) {
  if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('Identificador de hilo inválido.');
  return `${COMMENTS_ROOT}/${id}.json`;
}
function verifyActor(actor: Actor) {
  if (!actor.id || !actor.name.trim() || actor.name.length > 80) throw new Error('Indica un nombre de autor de hasta 80 caracteres.');
}
function verifyMessage(text: string) {
  if (!text.trim() || text.length > 20_000) throw new Error('El mensaje debe tener entre 1 y 20.000 caracteres.');
}
export function makeAnchor(path: string, source: string, revision: string, startLine: number, endLine = startLine): Anchor {
  const lines = source.split('\n');
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) throw new Error('Selecciona un rango de líneas válido.');
  const quote = lines.slice(startLine-1, endLine).join('\n');
  if (!quote.trim()) throw new Error('Selecciona una línea con contenido.');
  return {path,revision,startLine,endLine,quote,prefix:lines.slice(Math.max(0,startLine-3),startLine-1).join('\n'),suffix:lines.slice(endLine,endLine+2).join('\n')};
}
export function resolveAnchor(anchor: Anchor, source: string | undefined, revision?: string): AnchorResolution {
  if (source === undefined) return {state:'missing'};
  if (anchor.startOffset !== undefined && anchor.endOffset !== undefined) {
    if (revision === anchor.revision && source.slice(anchor.startOffset,anchor.endOffset) === anchor.quote) return {state:'exact',startLine:anchor.startLine,endLine:anchor.endLine};
    const matches:number[]=[]; let from=0;
    while(from < source.length) { const pos=source.indexOf(anchor.quote,from); if(pos<0) break; matches.push(pos); from=pos+Math.max(1,anchor.quote.length); }
    if(!matches.length) return {state:'outdated'};
    const context=matches.filter(pos=>source.slice(Math.max(0,pos-anchor.prefix.length),pos)===anchor.prefix&&source.slice(pos+anchor.quote.length,pos+anchor.quote.length+anchor.suffix.length)===anchor.suffix);
    const pos=context.length===1?context[0]:matches.length===1?matches[0]:undefined;
    if(pos===undefined) return {state:'ambiguous'};
    return {state:'moved',startLine:source.slice(0,pos).split('\n').length,endLine:source.slice(0,pos+anchor.quote.length).split('\n').length};
  }
  if (anchor.revision === revision && source.split('\n').slice(anchor.startLine-1,anchor.endLine).join('\n') === anchor.quote) return {state:'exact',startLine:anchor.startLine,endLine:anchor.endLine};
  const candidates: number[] = []; let offset = 0;
  while (offset <= source.length) {
    const found = source.indexOf(anchor.quote,offset); if(found < 0) break;
    const end = found+anchor.quote.length;
    if ((found === 0 || source[found-1] === '\n') && (end === source.length || source[end] === '\n')) candidates.push(found);
    offset = found+Math.max(1,anchor.quote.length);
  }
  if (!candidates.length) return {state:'outdated'};
  const withContext = candidates.filter(pos => (!anchor.prefix || source.slice(0,pos).endsWith(anchor.prefix+'\n')) && (!anchor.suffix || source.slice(pos+anchor.quote.length).startsWith('\n'+anchor.suffix)));
  const selected = withContext.length === 1 ? withContext[0] : candidates.length === 1 ? candidates[0] : undefined;
  if (selected === undefined) return {state:'ambiguous'};
  const startLine = source.slice(0,selected).split('\n').length;
  return {state:'moved',startLine,endLine:startLine+anchor.quote.split('\n').length-1};
}
/** Offsets refer to the unchanged source UTF-16 string, not rendered HTML. */
export function makeFragmentAnchor(path:string,source:string,revision:string,startOffset:number,endOffset:number):Anchor {
  if(!Number.isInteger(startOffset)||!Number.isInteger(endOffset)||startOffset<0||endOffset<=startOffset||endOffset>source.length) throw new Error('Selección de fuente inválida.');
  const quote=source.slice(startOffset,endOffset);
  if(!quote.trim()) throw new Error('Selecciona un fragmento con contenido.');
  return {path,revision,startOffset,endOffset,quote,startLine:source.slice(0,startOffset).split('\n').length,endLine:source.slice(0,endOffset).split('\n').length,prefix:source.slice(Math.max(0,startOffset-64),startOffset),suffix:source.slice(endOffset,endOffset+64)};
}
export function createThread(anchor: Anchor, actor: Actor, text: string, now = new Date().toISOString()): Thread {
  verifyActor(actor); verifyMessage(text);
  return {schemaVersion:1,id:crypto.randomUUID(),anchor,status:'open',messages:[{id:crypto.randomUUID(),author:{...actor},text,createdAt:now,reactions:[]}],createdAt:now,updatedAt:now};
}
export type ThreadAction = {type:'reply'; text:string}|{type:'edit'; messageId:string; text:string}|{type:'react'; messageId:string; kind:ReactionKind}|{type:'resolve'}|{type:'reopen'}|{type:'reanchor'; anchor:Anchor};
export function updateThread(thread: Thread, actor: Actor, action: ThreadAction, now = new Date().toISOString()): Thread {
  verifyActor(actor); const next = structuredClone(thread);
  if (action.type === 'reply') { verifyMessage(action.text); next.messages.push({id:crypto.randomUUID(),author:{...actor},text:action.text,createdAt:now,reactions:[]}); }
  if (action.type === 'edit') {
    verifyMessage(action.text); const target = next.messages.find(m=>m.id === action.messageId);
    if (!target || target.author.id !== actor.id) throw new Error('Solo puedes editar tus propios mensajes. La identidad es local y declarada.');
    (target.revisions ??= []).push({text:target.text,editedAt:now,actor:{...actor}});
    target.text = action.text; target.editedAt = now;
  }
  if (action.type === 'react') {
    if (!action.kind.trim() || action.kind.length > 32) throw new Error('Reacción inválida.');
    const target = next.messages.find(m=>m.id === action.messageId); if (!target) throw new Error('El mensaje ya no existe.');
    const existing = target.reactions.some(r=>r.actorId === actor.id && r.kind === action.kind);
    const pair: Record<string,string> = {like:'dislike',dislike:'like',approve:'disapprove',disapprove:'approve'};
    target.reactions = target.reactions.filter(r => !(r.actorId === actor.id && (r.kind === action.kind || r.kind === pair[action.kind])));
    if(!existing) target.reactions.push({kind:action.kind,actorId:actor.id});
  }
  if(action.type === 'resolve') { next.status='resolved'; next.resolvedBy={...actor}; next.resolvedAt=now; (next.events ??= []).push({type:'resolved',at:now,actor:{...actor}}); }
  if(action.type === 'reopen') { next.status='open'; delete next.resolvedBy; delete next.resolvedAt; (next.events ??= []).push({type:'reopened',at:now,actor:{...actor}}); }
  if(action.type === 'reanchor') { (next.events ??= []).push({type:'reanchored',at:now,actor:{...actor},previousAnchor:next.anchor}); next.anchor=action.anchor; }
  next.updatedAt=now; return next;
}
export function parseThread(text: string): Thread {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object') throw new Error('Hilo inválido.');
  const t=value as Thread;
  if (t.schemaVersion !== 1 || !['open','resolved'].includes(t.status) || !t.anchor || typeof t.anchor.path !== 'string' || typeof t.anchor.quote !== 'string' || !Number.isInteger(t.anchor.startLine) || !Number.isInteger(t.anchor.endLine) || !Array.isArray(t.messages) || !t.messages.length) throw new Error('Esquema de comentarios desconocido o inválido; se conserva el archivo.');
  threadPath(t.id);
  if (typeof t.anchor.prefix !== 'string' || typeof t.anchor.suffix !== 'string' || typeof t.anchor.revision !== 'string') throw new Error('Anclaje inválido.');
  for (const m of t.messages) {
    if (typeof m.id !== 'string' || !m.author || typeof m.author.id !== 'string' || typeof m.author.name !== 'string' || typeof m.text !== 'string' || !Array.isArray(m.reactions) || !m.reactions.every(r=>typeof r.kind==='string'&&typeof r.actorId==='string')) throw new Error('Mensaje inválido.');
    verifyActor(m.author); verifyMessage(m.text);
    if (!Number.isFinite(Date.parse(m.createdAt))) throw new Error('Fecha de mensaje inválida.');
  }
  return t;
}
export function serializeThread(thread: Thread) { return JSON.stringify(thread,null,2)+'\n'; }
export function formatMessageDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const day = (d:Date) => { const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d); const p=(type:string)=>Number(parts.find(p=>p.type===type)!.value); return Date.UTC(p('year'),p('month')-1,p('day'))/86400000; };
  const diff=day(now)-day(date);
  const label=diff===0?'Hoy':diff===1?'Ayer':diff===2?'Anteayer':new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',day:'numeric',month:'short'}).format(date);
  return `${label}, ${new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date)}`;
}
