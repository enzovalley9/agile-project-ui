import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { CanonicalNode, ContentProjection } from './types';

type Ast = {type:string;value?:string;depth?:number;ordered?:boolean;start?:number;url?:string;lang?:string;checked?:boolean|null;align?:(string|null)[];children?:Ast[]};
const processor = unified().use(remarkParse).use(remarkGfm);
export function splitFrontmatter(text:string):{prefix:string;body:string} {
  const match = text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
  return {prefix:match?.[0] ?? '',body:match ? text.slice(match[0].length) : text.replace(/^\uFEFF/,'')};
}
function projection(nodes:CanonicalNode[],unsupported:string[]):ContentProjection {
  return {normalizerVersion:1,nodes,complete:unsupported.length===0,unsupported:[...new Set(unsupported)],markdown:render(nodes).trimEnd()};
}
export function markdownProjection(text:string):ContentProjection {
  const unsupported:string[]=[];
  const convert = (n:Ast):CanonicalNode => {
    const content = n.children?.map(convert);
    switch(n.type) {
      case 'root': return {type:'doc',content};
      case 'text':return {type:'text',text:n.value ?? ''};
      case 'paragraph':return {type:'paragraph',content};
      case 'heading':return {type:'heading',attrs:{level:n.depth ?? 1},content};
      case 'strong':case 'emphasis':case 'delete':case 'link': {
        const mark = {type:({strong:'strong',emphasis:'em',delete:'strike',link:'link'} as Record<string,string>)[n.type],...(n.type==='link'?{href:n.url}: {})};
        if(n.type==='link' && !safeHref(n.url ?? '')) unsupported.push('unsafe-link');
        return {type:'span',marks:[mark],content};
      }
      case 'inlineCode':return {type:'text',text:n.value??'',marks:[{type:'code'}]};
      case 'break':return {type:'hardBreak'};
      case 'thematicBreak':return {type:'rule'};
      case 'blockquote':return {type:'blockquote',content};
      case 'code':return {type:'codeBlock',attrs:{language:n.lang??''},content:[{type:'text',text:n.value??''}]};
      case 'list':return {type:n.ordered?'orderedList':'bulletList',...(n.ordered?{attrs:{order:n.start??1}}:{}),content};
      case 'listItem': if(n.checked != null)unsupported.push('task-list'); return {type:'listItem',content};
      case 'table': if(n.align?.some(Boolean))unsupported.push('table-alignment');return {type:'table',content:content?.map((row,i)=>({...row,content:row.content?.map(c=>({...c,type:i===0?'tableHeader':'tableCell'}))}))};
      case 'tableRow':return {type:'tableRow',content};
      case 'tableCell':return {type:'tableCell',content:[{type:'paragraph',content}]};
      default: unsupported.push(n.type);return {type:'opaque',attrs:{kind:n.type}};
    }
  };
  const root=convert(processor.parse(splitFrontmatter(text).body) as Ast);
  return projection(normalizeNodes(root.content??[]),unsupported);
}
function safeHref(href:string):boolean {return !/^(?:javascript|data|vbscript|file):/i.test(href.trim());}
const allowed = new Set(['doc','paragraph','heading','bulletList','orderedList','listItem','blockquote','codeBlock','rule','hardBreak','text','table','tableRow','tableCell','tableHeader']);
export function adfProjection(value:unknown):ContentProjection {
  const unsupported:string[]=[];
  const visit=(raw:unknown,depth=0):CanonicalNode=>{
    if(depth>50 || !raw || typeof raw!=='object') {unsupported.push('invalid-adf');return {type:'opaque'};}
    const n=raw as {type?:string;text?:string;attrs?:Record<string,unknown>;marks?:{type:string;attrs?:Record<string,unknown>}[];content?:unknown[];version?:number};
    const type=n.type??'unknown';
    if(!allowed.has(type)){unsupported.push(type);return {type:'opaque',attrs:{kind:type}};}
    const attrs:Record<string,string|number|boolean>={};
    if(type==='heading')attrs.level=Number(n.attrs?.level??1);
    if(type==='orderedList')attrs.order=Number(n.attrs?.order??1);
    if(type==='codeBlock')attrs.language=String(n.attrs?.language??'');
    const safeAttrs:Record<string,string[]>={heading:['level'],orderedList:['order'],codeBlock:['language'],table:[],tableCell:['colspan','rowspan','colwidth','background'],tableHeader:['colspan','rowspan','colwidth','background']};
    for(const [key,val]of Object.entries(n.attrs??{})) {
      if((type==='tableCell'||type==='tableHeader') && ((key==='colspan'||key==='rowspan')&&val===1 || (key==='colwidth'||key==='background')&&val==null))continue;
      if(!(safeAttrs[type]??[]).includes(key) || type==='tableCell'||type==='tableHeader')unsupported.push(`${type}.${key}`);
    }
    const marks=n.marks?.map(m=>{
      if(!['strong','em','strike','code','link'].includes(m.type))unsupported.push(`mark:${m.type}`);
      const href=m.type==='link'?String(m.attrs?.href??''):undefined;
      if(href!==undefined&&!safeHref(href))unsupported.push('unsafe-link');
      if(Object.keys(m.attrs??{}).some(k=>k!=='href'))unsupported.push(`mark-attrs:${m.type}`);
      return {type:m.type,...(href!==undefined?{href}:{})};
    });
    return {type,...(n.text!==undefined?{text:n.text}:{}),...(Object.keys(attrs).length?{attrs}:{}),...(marks?.length?{marks}:{}),...(n.content?{content:n.content.map(c=>visit(c,depth+1))}:{})};
  };
  if(value==null)return projection([],[]);
  const root=visit(value);
  if(root.type!=='doc')unsupported.push('missing-doc-root');
  if((value as {version?:number})?.version!==1)unsupported.push('adf-version');
  const result=projection(normalizeNodes(root.content??[]),unsupported);
  if(result.complete){const roundtrip=markdownProjection(result.markdown);if(!roundtrip.complete||JSON.stringify(roundtrip.nodes)!==JSON.stringify(result.nodes)){result.complete=false;result.unsupported.push('markdown-roundtrip');}}
  return result;
}
export function opaqueProjection(raw:string,representation:string):ContentProjection {return {normalizerVersion:1,nodes:[{type:'opaque',attrs:{kind:representation},text:raw}],complete:false,unsupported:[representation],markdown:raw};}
function normalizeNodes(nodes:CanonicalNode[],inherited:NonNullable<CanonicalNode['marks']>=[]):CanonicalNode[] {
  const output:CanonicalNode[]=[];
  for(const node of nodes){
    const marks=[...inherited,...(node.marks??[])].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if(node.type==='span'){output.push(...normalizeNodes(node.content??[],marks));continue;}
    const clean:CanonicalNode={type:node.type,...(node.text!==undefined?{text:node.text}:{}),...(node.attrs?{attrs:node.attrs}:{}),...(marks.length?{marks}:{}),...(node.content?{content:normalizeNodes(node.content)}:{})};
    const prev=output.at(-1);
    if(clean.type==='text'&&prev?.type==='text'&&JSON.stringify(clean.marks)===JSON.stringify(prev.marks))prev.text=(prev.text??'')+(clean.text??'');else output.push(clean);
  }
  return output;
}
function inline(n:CanonicalNode):string {
  if(n.type==='hardBreak')return '  \n';
  let value=n.type==='text'?(n.text??'').replace(/([\\`*_[\]<>|#~+.!-])/g,'\\$1'):render(n.content??[]);
  for(const mark of n.marks??[]){if(mark.type==='code') {const raw=n.text??'';let delimiter='`';while(raw.includes(delimiter))delimiter+='`';value=delimiter+' '+raw+' '+delimiter;} else if(mark.type==='strong')value=`**${value}**`;else if(mark.type==='em')value=`*${value}*`;else if(mark.type==='strike')value=`~~${value}~~`;else if(mark.type==='link')value=`[${value}](<${(mark.href??'').replace(/[<>\r\n]/g,encodeURIComponent)}>)`;}
  return value;
}
function render(nodes:CanonicalNode[]):string {
  return nodes.map(n=>{
    const children=n.content??[];
    switch(n.type){
      case 'text':case 'hardBreak':return inline(n);
      case 'paragraph':return children.map(inline).join('')+'\n\n';
      case 'heading':return '#'.repeat(Math.max(1,Math.min(6,Number(n.attrs?.level??1))))+' '+children.map(inline).join('')+'\n\n';
      case 'rule':return '---\n\n';
      case 'codeBlock':{const raw=children.map(c=>c.text??'').join('');let fence='```';while(raw.includes(fence))fence+='`';return `${fence}${n.attrs?.language??''}\n${raw}\n${fence}\n\n`;}
      case 'blockquote':return render(children).trimEnd().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
      case 'bulletList':case 'orderedList':return children.map((c,i)=>{const lead=n.type==='orderedList'?`${Number(n.attrs?.order??1)+i}. `:'- ';return render(c.content??[]).trimEnd().split('\n').map((l,j)=>(j?' '.repeat(lead.length):lead)+l).join('\n');}).join('\n')+'\n\n';
      case 'table':return children.map((r,i)=>{const row='| '+(r.content??[]).map(c=>render(c.content??[]).trim().replace(/\n/g,' ')).join(' | ')+' |';return row+(i===0?'\n| '+(r.content??[]).map(()=>'---').join(' | ')+' |':'');}).join('\n')+'\n\n';
      case 'opaque':return '';
      default:return render(children);
    }
  }).join('');
}
export function toAdf(projection:ContentProjection):unknown {
  if(!projection.complete)throw new Error('Content has unsupported constructs');
  const map=(n:CanonicalNode):unknown=>({...n,...(n.marks?{marks:n.marks.map(m=>({type:m.type,...(m.href!==undefined?{attrs:{href:m.href}}:{})}))}:{}),...(n.content?{content:n.content.map(map)}:{})});
  return {version:1,type:'doc',content:projection.nodes.map(map)};
}
export function canonicalText(text:string):{value:string;complete:boolean;unsupported:string[]} {const p=markdownProjection(text);return {value:JSON.stringify(p.nodes),complete:p.complete,unsupported:p.unsupported};}
