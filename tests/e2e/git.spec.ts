import {test,expect} from './filesystem';
import {serve} from '@hono/node-server';
import {createGitApp} from '../../apps/git-connector/src/app';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
const exec=promisify(execFile);
const command=async(root:string,...args:string[]) => (await exec('git',args,{cwd:root})).stdout.trim();
async function setup(root:string,port:number){
 const state=await mkdtemp(join(tmpdir(),'bmad-git-e2e-')),remote=join(state,'remote.git'),tokenFile=join(state,'session');
 await mkdir(remote);await command(remote,'init','--bare');await command(root,'init','-b','main');await command(root,'config','user.name','BMAD E2E');await command(root,'config','user.email','bmad-e2e@example.invalid');
 await writeFile(join(root,'.gitignore'),'.bmad-project-ui/local/\n');await command(root,'add','.');await command(root,'commit','-m','Original fixture');await command(root,'branch','review-fixture');await command(root,'remote','add','origin',remote);await command(root,'push','-u','origin','main');
 const token=randomBytes(32).toString('hex');await writeFile(tokenFile,token,{mode:0o600});
 const app=createGitApp({repo:root,origin:'http://127.0.0.1:5173',token,port,stateDir:join(state,'journal'),allowLocalRemotes:true});await app.service.ready;
 const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port});
 return {remote,tokenFile,close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
async function open(page:import('@playwright/test').Page){await page.goto('/');await page.getByRole('button',{name:'Elegir carpeta del proyecto'}).click();await page.getByRole('button',{name:'Activar Editor'}).click();}
async function connect(page:import('@playwright/test').Page,port:number,tokenFile:string){
 await page.getByRole('button',{name:/Conexión con Git/}).click();await page.getByLabel('Dirección local del conector',{exact:true}).fill(`http://127.0.0.1:${port}`);await page.getByLabel('Cargar archivo de sesión',{exact:true}).setInputFiles(tokenFile);await page.getByRole('checkbox',{name:/Confío en los hooks/}).check();await page.getByRole('button',{name:'Conectar y vincular proyecto'}).click();await expect(page.getByRole('heading',{name:'Cambios locales'})).toBeVisible();await expect(page.getByRole('button',{name:'Volver a lectura'})).toBeEnabled();
}
async function edit(page:import('@playwright/test').Page,text:string){await page.getByRole('button',{name:'Documentos',exact:true}).click();await page.getByRole('button',{name:'reunion.md',exact:true}).click();await page.getByRole('button',{name:'Markdown',exact:true}).click();const editor=page.getByLabel('Fuente Markdown');await editor.click();await editor.press('ControlOrMeta+a');await page.keyboard.insertText(text);}

test('native Git roundtrip from browser: save, exact review, commit, push and existing branch switch',async({page,project})=>{
 const setupResult=await setup(project,43220);
 try{
  await open(page);await connect(page,43220,setupResult.tokenFile);const before=await readFile(join(project,'docs/notas/reunion.md'),'utf8');const after=before+'\nCambio Git E2E revisado.\n';await edit(page,after);await page.getByRole('button',{name:'Guardar',exact:true}).click();await expect(page.getByText('Guardado localmente y verificado.')).toBeVisible();
  await page.getByRole('button',{name:/Conexión con Git/}).click();await page.getByRole('button',{name:'Comprobar',exact:true}).click();
  await page.locator('label').filter({hasText:'docs/notas/reunion.md'}).getByRole('checkbox').check();await page.getByLabel('Mensaje del commit').fill('Verify original fixture update');await page.getByRole('button',{name:'Revisar commit'}).click();
  await expect(page.getByRole('dialog')).toContainText('Cambio Git E2E revisado.');await page.getByRole('button',{name:'Confirmar commit local'}).click();await expect(page.getByText('Resultado verificado',{exact:true})).toBeVisible();
  const localHead=await command(project,'rev-parse','HEAD');expect(await command(project,'show','HEAD:docs/notas/reunion.md')).toContain('Cambio Git E2E revisado.');expect(await command(project,'status','--porcelain')).toBe('');
  await page.getByRole('button',{name:'Revisar push',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Verify original fixture update');await expect(page.getByRole('dialog')).toContainText('Cambio Git E2E revisado.');await page.getByRole('button',{name:'Confirmar push al remoto'}).click();await expect(page.getByText('Revisión remota '+localHead,{exact:true})).toBeVisible();expect(await command(setupResult.remote,'rev-parse','refs/heads/main')).toBe(localHead);
  await page.getByRole('combobox',{name:'Rama',exact:true}).selectOption('review-fixture');await page.getByRole('button',{name:'Revisar cambio de rama'}).click();await page.getByRole('button',{name:'Confirmar cambio de rama'}).click();await expect(page.getByText(/Rama review-fixture ·/)).toBeVisible();expect(await command(project,'branch','--show-current')).toBe('review-fixture');expect(await readFile(join(project,'docs/notas/reunion.md'),'utf8')).toBe(before);
 }finally{await setupResult.close();}
});

test('external branch switch with identical document bytes cannot receive the old draft',async({page,project})=>{
 const setupResult=await setup(project,43221);
 try{await open(page);await connect(page,43221,setupResult.tokenFile);const path=join(project,'docs/notas/reunion.md'),before=await readFile(path,'utf8');await edit(page,before+'\nBorrador de main.\n');await command(project,'switch','review-fixture');await page.getByRole('button',{name:'Guardar',exact:true}).click();await expect(page.getByText(/La rama o el commit cambió fuera/)).toBeVisible();expect(await readFile(path,'utf8')).toBe(before);await expect(page.getByLabel('Fuente Markdown')).toContainText('Borrador de main.');}
 finally{await setupResult.close();}
});
