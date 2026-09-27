import {test as base,expect,type Page} from '@playwright/test';
import {mkdtemp,cp,readFile,writeFile,readdir,stat,mkdir,rename,unlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
/** The automated picker boundary uses real disposable disk files. Production
 * code still uses File System Access unchanged. Native picker proof is separate. */
export async function installDiskPicker(page:Page,root:string) {
  await page.exposeBinding('__testDisk',async(_source,args:{op:string;path:string;content?:string;create?:boolean})=>{
    const target=resolve(root,args.path||'.');
    if(target!==root&&!target.startsWith(root+sep))throw new Error('Outside test project');
    // Test driver also rejects symlink escapes; never general access to the host.
    let ancestor=target;
    while(true){try{const physical=await realpath(ancestor);if(physical!==root&&!physical.startsWith(root+sep))throw new Error('Symlink escape');break;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const parent=resolve(ancestor,'..');if(parent===ancestor)throw e;ancestor=parent;}}
    try {
      if(args.op==='list')return (await readdir(target,{withFileTypes:true})).filter(e=>!e.isSymbolicLink()).map(e=>({name:e.name,kind:e.isDirectory()?'directory':'file'}));
      if(args.op==='read'){const [bytes,info]=await Promise.all([readFile(target),stat(target)]);return {bytes:Array.from(bytes),mtime:info.mtimeMs};}
      if(args.op==='file'){if(args.create){await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,'',{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});}const info=await stat(target);if(!info.isFile())throw new Error('TypeMismatchError');return true;}
      if(args.op==='directory'){if(args.create)await mkdir(target,{recursive:true});const info=await stat(target);if(!info.isDirectory())throw new Error('TypeMismatchError');return true;}
      if(args.op==='write'){const temp=target+'.e2e-pending';await writeFile(temp,args.content!);await rename(temp,target);return true;}
      if(args.op==='remove'){await unlink(target);return true;}
      throw new Error('Unknown test disk operation');
    }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {error:'NotFoundError'};throw e;}
  });
  await page.addInitScript(()=>{
    type BridgeWindow=Window & {__testDisk:(a:unknown)=>Promise<unknown>;__testPermission:PermissionState};
    const w=window as unknown as BridgeWindow;w.__testPermission='granted';
    const call=async(op:string,path:string,extra={})=>{const result=await w.__testDisk({op,path,...extra});if(result&&typeof result==='object'&&'error' in result)throw new DOMException('Missing file',String(result.error));return result as any;};
    const make=(path:string,kind:'directory'|'file'):any=>({kind,name:path.split('/').at(-1)||'Huerto Compartido',
      queryPermission:async()=>w.__testPermission,requestPermission:async()=>w.__testPermission,isSameEntry:async(other:any)=>other.__path===path,__path:path,
      getFile:async()=>{const data=await call('read',path);return new File([new Uint8Array(data.bytes)],path.split('/').at(-1)!,{lastModified:data.mtime});},
      getDirectoryHandle:async(name:string,options?:{create?:boolean})=>{const child=path?path+'/'+name:name;await call('directory',child,options);return make(child,'directory');},
      getFileHandle:async(name:string,options?:{create?:boolean})=>{const child=path?path+'/'+name:name;await call('file',child,options);return make(child,'file');},
      entries:async function*(){for(const entry of await call('list',path))yield [entry.name,make(path?path+'/'+entry.name:entry.name,entry.kind)];},
      removeEntry:async(name:string)=>call('remove',path?path+'/'+name:name),
      createWritable:async()=>{let pending='';return {write:async(value:string)=>{pending=value;},close:async()=>call('write',path,{content:pending}),abort:async()=>{pending='';}};},
    });
    window.showDirectoryPicker=async()=>make('','directory');
  });
}
export const test=base.extend<{project:string}>({project:async({page},use)=>{
  const temp=await mkdtemp(join(tmpdir(),'bmad-ui-e2e-'));const root=await realpath(temp);
  await cp(resolve('tests/fixtures/huerto'),root,{recursive:true});await mkdir(join(root,'.git'));
  await installDiskPicker(page,root);await use(root);
  // Keep failed-run evidence recoverable; OS temp cleanup owns these test folders.
}});
export {expect};
