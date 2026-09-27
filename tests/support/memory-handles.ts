/** Test-only File System Access boundary. No production alternate filesystem. */
export function memoryDirectory(initial: Record<string,string>, name='project') {
  const files=new Map(Object.entries(initial)); const directories=new Set<string>(['']);
  for(const path of files.keys()) {const parts=path.split('/');for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join('/'));}
  const state={beforeRead:undefined as undefined|((path:string)=>void),afterClose:undefined as undefined|((path:string)=>void),permission:'granted' as PermissionState,writes:0,closes:0,abort:0,failWrite:false,beforeWrite:undefined as undefined|((path:string,text:string)=>void)};
  const missing=()=>new DOMException('Missing','NotFoundError');
  const file=(path:string):FileSystemFileHandle=>({kind:'file',name:path.split('/').at(-1)!,isSameEntry:async()=>false,queryPermission:async()=>state.permission,requestPermission:async()=>state.permission,
    getFile:async()=>{state.beforeRead?.(path);if(!files.has(path))throw missing();return new File([files.get(path)!],path.split('/').at(-1)!);},
    createWritable:async()=>{let pending='';return {write:async(text:string)=>{state.writes++;state.beforeWrite?.(path,text);if(state.failWrite)throw new Error('disk full');pending=text;},close:async()=>{files.set(path,pending);state.closes++;state.afterClose?.(path);},abort:async()=>{state.abort++;}} as unknown as FileSystemWritableFileStream;},
  } as unknown as FileSystemFileHandle);
  const dir=(base:string):FileSystemDirectoryHandle=>({kind:'directory',name:base?base.split('/').at(-1)!:name,isSameEntry:async()=>false,queryPermission:async()=>state.permission,requestPermission:async()=>state.permission,
    getDirectoryHandle:async(child:string,options?:FileSystemGetDirectoryOptions)=>{const path=base?base+'/'+child:child;if(!directories.has(path)){if(!options?.create)throw missing();directories.add(path);}return dir(path);},
    getFileHandle:async(child:string,options?:FileSystemGetFileOptions)=>{const path=base?base+'/'+child:child;if(!files.has(path)){if(!options?.create)throw missing();files.set(path,'');}return file(path);},
    removeEntry:async(child:string)=>{files.delete(base?base+'/'+child:child);},
    entries:async function*(){const prefix=base?base+'/':'';for(const path of [...directories].sort()){const relative=path.slice(prefix.length);if(path.startsWith(prefix)&&relative&&!relative.includes('/'))yield [relative,dir(path)] as [string,FileSystemDirectoryHandle];}for(const path of [...files.keys()].sort()){const relative=path.slice(prefix.length);if(path.startsWith(prefix)&&!relative.includes('/'))yield [relative,file(path)] as [string,FileSystemFileHandle];}},
  } as unknown as FileSystemDirectoryHandle);
  return {handle:dir(''),files,directories,state};
}
