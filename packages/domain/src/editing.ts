import { parseDocument } from 'yaml';
import type { EditPlan, FieldTarget, FileSnapshot, ProjectIndex, WorkItemEdit } from './types';
import { isSafePath } from './source';
import { hasMergeConflict } from './conflicts';

export class DomainEditError extends Error {
  constructor(public code:string,message:string) {super(message);this.name='DomainEditError';}
}
function yamlText(value:string,old:string,warnings:string[]):string {
  if(old.startsWith('"')) return JSON.stringify(value);
  if(old.startsWith("'")&&!/[\r\n]/.test(value)) return `'${value.replaceAll("'","''")}'`;
  if(!/^[|>]/.test(old)&&!/[\r\n]/.test(value)) {
    try {const parsed=parseDocument(value);if(!parsed.errors.length&&!parsed.warnings.length&&parsed.toJS({maxAliasCount:0})===value)return value;}catch{/* Use explicit string quoting. */}
  }
  warnings.push('El nuevo valor necesita comillas YAML explícitas para conservar su significado. Revisa la diferencia de representación.');
  // range[1] of block scalars includes their final newline. Keep that separator.
  const ending=old.endsWith('\r\n')?'\r\n':old.endsWith('\n')?'\n':'';
  return JSON.stringify(value)+ending;
}
/** A plan contains exact proposed files; only the browser store may write them. */
export function planWorkItemEdit(index:ProjectIndex,files:FileSnapshot,edit:WorkItemEdit):EditPlan {
  const item=index.workItems.find(candidate=>candidate.id===edit.id);
  if(!item)throw new DomainEditError('item-missing','La entidad ya no aparece en este proyecto; actualiza la vista.');
  const warnings=[...item.warnings];
  const targets:{target:FieldTarget;value:string}[]=[];
  if(edit.field==='checklist') {
    if(typeof edit.value!=='boolean')throw new DomainEditError('invalid-value','Una casilla necesita un valor verdadero o falso.');
    const check=item.checklist.find(candidate=>candidate.id===edit.checklistId);
    if(!check)throw new DomainEditError('checklist-missing','La casilla no pertenece a esta entidad.');
    targets.push({target:{source:check.source,value:check.checked?'x':' ',format:'checkbox'},value:edit.value?'x':' '});
  } else {
    if(!item.editable[edit.field]||!item.fields[edit.field])throw new DomainEditError('field-not-editable',item.warnings.join(' ')||'No hay un adaptador de escritura inequívoco para este campo. Puedes consultar o editar la fuente.');
    if(typeof edit.value!=='string')throw new DomainEditError('invalid-value','Este campo necesita texto.');
    if(edit.field==='title'&&(!edit.value.trim()||/[\r\n]/.test(edit.value)))throw new DomainEditError('invalid-title','El título debe ser texto de una sola línea.');
    if(edit.field==='status'&&!item.status?.allowed.includes(edit.value))throw new DomainEditError('invalid-status','El estado no pertenece al vocabulario de esta entidad.');
    targets.push({target:item.fields[edit.field]!,value:edit.value});
    // Legacy story and sprint tracking duplicate the same status, unlike Build.
    // Only update the known coupled pair when both started in agreement.
    if(edit.field==='status'&&(item.family==='legacy-story'||item.family==='sprint')) {
      const partner=index.workItems.filter(candidate=>candidate.nativeId===item.nativeId&&candidate.kind==='story'&&candidate.family===(item.family==='sprint'?'legacy-story':'sprint'));
      if(partner.length>1)throw new DomainEditError('ambiguous-status','Hay varias fuentes de estado para esta identidad.');
      if(partner.length===1) {
        const other=partner[0];
        if(!other.editable.status||!other.fields.status||!other.status||!item.status||((other.status.normalized||other.status.raw)!==(item.status.normalized||item.status.raw)))throw new DomainEditError('status-discrepancy','Historia y sprint no coinciden; revisa las dos fuentes antes de editar el estado.');
        if(!other.status.allowed.includes(edit.value))throw new DomainEditError('invalid-status','El nuevo estado no es válido en todas las fuentes afectadas.');
        targets.push({target:other.fields.status,value:edit.value});
        warnings.push('Este cambio modifica el estado de la historia y su registro de sprint como un conjunto.');
      }
    }
  }
  const byPath=new Map<string,{target:FieldTarget;value:string}[]>();
  for(const change of targets) {
    const path=change.target.source.path;
    if(!isSafePath(path)||!Object.hasOwn(files,path))throw new DomainEditError('source-missing','La fuente ya no está dentro del proyecto autorizado.');
    byPath.set(path,[...(byPath.get(path)||[]),change]);
  }
  const changes:EditPlan['changes']=[];
  for(const [path,parts] of byPath) {
    const before=files[path];let after=before;
    if(hasMergeConflict(before))throw new DomainEditError('merge-conflict','La fuente contiene un conflicto. Resuélvelo fuera de la aplicación antes de editar.');
    const ordered=parts.sort((a,b)=>b.target.source.start-a.target.source.start);
    let previousStart=before.length+1;
    for(const {target,value} of ordered) {
      const {start,end}=target.source;
      if(start<0||end<start||end>before.length||end>previousStart)throw new DomainEditError('source-invalid','El rango del campo ya no es válido.');
      previousStart=start;
      const old=before.slice(start,end);
      if(target.format==='plain'||target.format==='markdown-section') {
        if(old!==target.value)throw new DomainEditError('source-changed','El campo cambió desde que se creó la vista. Actualiza antes de guardar.');
      } else if(target.format==='checkbox') {
        if(!/^[ xX]$/.test(old)||((old.toLowerCase()==='x')!==(target.value==='x')))throw new DomainEditError('source-changed','La casilla cambió desde que se creó la vista.');
      } else {
        // Parse the standalone current scalar to detect edits made after indexing.
        try {
          const parsed=parseDocument(old);const current=parsed.toJS({maxAliasCount:0});
          if(parsed.errors.length||String(current)!==target.value)throw new Error('changed');
        } catch {throw new DomainEditError('source-changed','El valor YAML cambió o no se puede preservar con este adaptador.');}
      }
      const eol=before.includes('\r\n')?'\r\n':'\n';
      const replacement=target.format==='yaml-scalar'?yamlText(value,old,warnings):target.format==='markdown-section'?value.replace(/\r?\n/g,eol):value;
      after=after.slice(0,start)+replacement+after.slice(end);
    }
    if(before!==after)changes.push({path,before,after,expectedRevision:parts[0].target.source.revision});
  }
  return {changes,warnings:[...new Set(warnings)]};
}
