import type { AgentRecord, Diagnostic, FileSnapshot, SkillRecord } from './types';
import type { Configuration } from './configuration';
import { isRecord, safeRecord, textValue } from './source';

/** RFC 4180-style parser: quoted descriptions may contain commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let index = text.startsWith('\uFEFF') ? 1 : 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; }
      else if (quoted || !field) quoted = !quoted;
      else throw new Error('Comillas CSV no válidas.');
    } else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field); if (row.some(value => value.length)) rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Campo CSV sin cierre.');
  row.push(field); if (row.some(value => value.length)) rows.push(row);
  return rows;
}
export function catalog(files: FileSnapshot, config: Configuration, diagnostics: Diagnostic[]): {agents:AgentRecord[];skills:SkillRecord[]} {
  const agents: AgentRecord[] = [], skills: SkillRecord[] = [];
  for (const [code, value] of Object.entries(safeRecord(config.effective.agents))) {
    if (!isRecord(value)) { diagnostics.push({code:'agent-invalid',severity:'warning',message:`Declaración de agente ${code} no reconocida.`}); continue; }
    const module = textValue(value.module);
    const manifestModule = Array.isArray(config.manifest.modules) ? config.manifest.modules.find(item => isRecord(item) && (item.name === module || item.code === module)) : undefined;
    const actions = Array.isArray(value.actions) ? value.actions.filter((item):item is string => typeof item === 'string') : [];
    agents.push({id:`${module || 'unknown'}:${code}`,code,name:textValue(value.name) || code,title:textValue(value.title),description:textValue(value.description),module,version:textValue(safeRecord(manifestModule).version) || config.version,source:config.provenance[`agents.${code}`] || '_bmad/config.toml',customized:config.customizedAgents.has(code),status:typeof value.name === 'string' ? 'declared' : 'partial',actions});
  }
  const path = '_bmad/_config/bmad-help.csv';
  if (Object.hasOwn(files,path)) {
    try {
      const [head,...rows] = parseCsv(files[path]);
      if (!head?.length) throw new Error('Catálogo vacío.');
      const headers = head.map(key=>key.trim().toLowerCase().replace(/[-_ ]/g,''));
      const get = (row:string[],...keys:string[]) => {
        for(const key of keys) { const index=headers.indexOf(key); if(index>=0 && row[index]) return row[index].trim(); } return undefined;
      };
      const seen = new Set<string>();
      for(const row of rows) {
        if(row.length !== head.length) { diagnostics.push({code:'catalog-row-invalid',severity:'warning',path,message:'Una fila del catálogo no tiene el número de columnas declarado.'}); continue; }
        const code=get(row,'skill','command','workflow','code'); const name=get(row,'name','displayname');
        if(!code || !name) { diagnostics.push({code:'catalog-row-incomplete',severity:'warning',path,message:'Una entrada del catálogo carece de nombre o skill; no se inventa.'}); continue; }
        const action=get(row,'action'); const module=get(row,'module'); const id=`${module || 'unknown'}:${code}:${action || ''}`;
        if(seen.has(id)) { diagnostics.push({code:'catalog-id-duplicate',severity:'warning',path,message:`Identidad de catálogo repetida: ${id}.`}); continue; } seen.add(id);
        const required=get(row,'required');
        skills.push({id,code,name,description:get(row,'description'),module,phase:get(row,'phase'),action,required:required === undefined ? undefined : /^(true|yes|required)$/i.test(required),output:get(row,'outputlocation','output','outputs','outputartifacts'),source:path});
      }
    } catch { diagnostics.push({code:'catalog-invalid',severity:'warning',path,message:'El catálogo CSV no se puede interpretar. No se sustituyen sus entradas por una lista fija.'}); }
  }
  return {agents,skills};
}
