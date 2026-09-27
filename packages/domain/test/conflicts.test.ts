import {describe,expect,it} from 'vitest';
import {hasMergeConflict,indexProject,planWorkItemEdit} from '../src/index';

const conflict=(ours:string,theirs:string,length=7,base?:string)=>
  `${'<'.repeat(length)} HEAD\n${ours}\n${base===undefined?'':`${'|'.repeat(length)} base\n${base}\n`}${'='.repeat(length)}\n${theirs}\n${'>'.repeat(length)} other\n`;

describe('unresolved Git content is read-only text, never BMAD authority',()=>{
  it('detects standard, diff3, custom-length and incomplete markers with BOM/CRLF',()=>{
    expect(hasMergeConflict(conflict('ours','theirs'))).toBe(true);
    expect(hasMergeConflict('\uFEFF'+conflict('ours','theirs',12,'base').replaceAll('\n','\r\n'))).toBe(true);
    for(const marker of ['<<<<<<< HEAD','>>>>>>> branch','||||||| base'])expect(hasMergeConflict(marker+'\nremaining')).toBe(true);
    expect(hasMergeConflict('# Document\n\nTitle\n=======\n\nInline <<<<<<< HEAD and short <<<<<< examples.\n')).toBe(false);
  });

  it('ignores literal fenced examples and recognizes a real marker after the matching fence closes',()=>{
    for(const [start,end] of [['```diff','```'],['~~~~ example','~~~~~'],['   ````md','   ````']]) {
      const literal=`# Guide\n\n${start}\n${conflict('ours','theirs',10,'base')}\n${end}\n`;
      expect(hasMergeConflict(literal)).toBe(false);
      expect(hasMergeConflict(literal+conflict('live ours','live theirs'))).toBe(true);
    }
    expect(hasMergeConflict('````md\n```\n'+conflict('literal','example')+'````\n')).toBe(false);
    expect(hasMergeConflict('```md\n~~~\n'+conflict('literal','example')+'```\n')).toBe(false);
  });

  it('keeps conflicted Markdown/YAML inspectable without extracting either side or relations',()=>{
    const files={
      'docs/epics.md':conflict('## Epic 1: Ours\n\n### Story 1.1: Unsafe\n\n- [ ] task','## Epic 2: Theirs\n\n[link](clean.md)'),
      'sprint-status.yaml':'development_status:\n'+conflict('  1-1-unsafe: done','  1-1-unsafe: backlog'),
      'docs/clean.md':'# Valid document\n\n- [ ] Keep available\n',
    };
    const original=JSON.stringify(files),index=indexProject(files,{'docs/epics.md':'exact-revision'});
    expect(index.documents).toHaveLength(3);
    for(const path of ['docs/epics.md','sprint-status.yaml'])expect(index.documents.find(doc=>doc.path===path)).toMatchObject({kind:'text',parseValid:false,headings:[],links:[],metadata:{},capabilities:{read:true,textEdit:false,structuredEdit:false,comment:false}});
    expect(index.documents.find(doc=>doc.path==='docs/epics.md')?.revision).toBe('exact-revision');
    expect(index.workItems.map(item=>item.source.path)).toEqual(['docs/clean.md']);
    expect(index.diagnostics.filter(d=>d.code==='merge-conflict').map(d=>d.path).sort()).toEqual(['docs/epics.md','sprint-status.yaml']);
    expect(index.coverage.partial).toBe(true);expect(JSON.stringify(files)).toBe(original);
  });

  it('does not let conflicted config, version or catalog rows contribute effective settings',()=>{
    const files={
      '_bmad/config.toml':conflict('[core]\nproject_name="Unsafe"\noutput_folder="untrusted"\n[agents.unsafe]\nname="Unsafe"','[core]\nproject_name="Other"'),
      '_bmad/_config/manifest.yaml':conflict('installation:\n  version: 6.12.0','installation:\n  version: 99.0.0'),
      '_bmad/_config/bmad-help.csv':conflict('name,command\nUnsafe,bmad-unsafe','name,command\nOther,bmad-other'),
      'docs/readme.md':'# Still readable',
    };
    const index=indexProject(files,{}, {projectName:'Authorized folder'});
    expect(index.name).toBe('Authorized folder');expect(index.declaredVersion).toBeUndefined();
    expect(index.roots.some(root=>root.path==='untrusted')).toBe(false);
    expect(index.agents).toEqual([]);expect(index.skills).toEqual([]);
    expect(index.diagnostics.filter(d=>d.code==='merge-conflict')).toHaveLength(3);
    expect(index.documents.filter(doc=>doc.kind==='text')).toHaveLength(3);
  });

  it('removes a conflicted execution relation and restores it only after a new clean index',()=>{
    const path='stories/1-1-task.md',clean='# Story 1.1: Task\n\nStatus: ready-for-dev\n',
      files={'sprint-status.yaml':'development_status:\n  1-1-task: ready-for-dev\n',[path]:conflict(clean,clean.replace('ready-for-dev','done'))};
    const before=indexProject(files),sprint=before.workItems.find(item=>item.family==='sprint')!;
    expect(sprint.documentPath).toBeUndefined();expect(sprint.relatedPaths).not.toContain(path);expect(sprint.relatedStatuses).toEqual([]);
    const after=indexProject({...files,[path]:clean});
    expect(after.workItems.find(item=>item.family==='sprint')?.documentPath).toBe(path);
    expect(after.diagnostics.some(d=>d.code==='merge-conflict')).toBe(false);
  });

  it('rejects a stale structured plan when conflict markers appeared outside its unchanged field',()=>{
    const path='spec-example.md',text='---\ntitle: Example\nstatus: draft\ntype: feature\n---\n# Example\n',files={[path]:text},index=indexProject(files);
    expect(()=>planWorkItemEdit(index,{[path]:text+conflict('ours','theirs')},{id:index.workItems[0].id,field:'title',value:'Changed'})).toThrow(/conflicto/);
  });
});
