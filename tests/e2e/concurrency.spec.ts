import {test,expect,installDiskPicker} from './filesystem';
import type {Page} from '@playwright/test';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';

async function openEditor(page:Page){
  await page.goto('/');
  await page.getByRole('button',{name:'Elegir carpeta del proyecto'}).click();
  await page.getByRole('button',{name:'reunion.md',exact:true}).click();
  await page.getByRole('button',{name:'Activar Editor'}).click();
}
async function reviewDraft(page:Page,text:string){
  await page.getByRole('button',{name:'Markdown',exact:true}).click();
  const source=page.getByLabel('Fuente Markdown');await source.click();await source.press('ControlOrMeta+a');await page.keyboard.insertText(text);
  await page.getByRole('button',{name:'Ver cambios',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText(text.trim().split('\n').at(-1)!);
}

test('two browser tabs preserve the winning document and the rejected stale draft',async({page,context,project})=>{
  const other=await context.newPage();await installDiskPicker(other,project);
  try{
    const path=join(project,'docs/notas/reunion.md'),before=await readFile(path,'utf8');
    const drafts=[before+'\nPrimera pestaña: turno de Lucía.\n',before+'\nSegunda pestaña: turno de Diego.\n'];
    await Promise.all([openEditor(page),openEditor(other)]);
    await Promise.all([reviewDraft(page,drafts[0]),reviewDraft(other,drafts[1])]);
    await Promise.all([page,other].map(tab=>tab.getByRole('dialog').getByRole('button',{name:'Guardar',exact:true}).click()));
    await expect.poll(async()=>(await Promise.all([page,other].map(tab=>tab.getByText('Guardado localmente y verificado.').count()))).reduce((sum,count)=>sum+count,0)).toBe(1);
    const saved=await readFile(path,'utf8');expect(drafts).toContain(saved);
    const winner=drafts.indexOf(saved),loser=[page,other][1-winner];
    await expect(loser.getByRole('alert').filter({hasText:'cambió'}).first()).toBeVisible();
    await expect(loser.getByLabel('Fuente Markdown')).toContainText(drafts[1-winner].trim().split('\n').at(-1)!);
    await expect(loser.getByRole('button',{name:'Guardar',exact:true})).toBeDisabled();
    expect(await readFile(path,'utf8')).toBe(saved);
    expect((await readdir(join(project,'.bmad-project-ui/local'))).includes('write-recovery.json')).toBe(false);
  }finally{await other.close();}
});

test('concurrent replies from two tabs retain one revision and keep the other reply for review',async({page,context,project})=>{
  await openEditor(page);await page.getByRole('button',{name:'Comentarios',exact:true}).click();
  await page.getByLabel('Tu nombre',{exact:true}).fill('Equipo paralelo');await page.getByRole('button',{name:'Usar este nombre'}).click();
  await page.getByText('Comentar un fragmento',{exact:true}).click();await page.getByLabel('Línea inicial').fill('5');await page.getByLabel('Línea final').fill('5');await page.getByRole('button',{name:'Seleccionar',exact:true}).click();
  await page.getByLabel('Nuevo comentario',{exact:true}).fill('Coordinar el turno.');await page.getByRole('button',{name:'Guardar comentario',exact:true}).click();
  await expect(page.getByText('Coordinar el turno.',{exact:true})).toBeVisible();
  const other=await context.newPage();await installDiskPicker(other,project);
  try{
    await openEditor(other);await other.getByRole('button',{name:'Comentarios',exact:true}).click();
    await expect(other.getByText('Coordinar el turno.',{exact:true})).toBeVisible();
    const replies=['Respuesta de la primera pestaña.','Respuesta de la segunda pestaña.'];
    await page.getByLabel('Responder',{exact:true}).fill(replies[0]);await other.getByLabel('Responder',{exact:true}).fill(replies[1]);
    await Promise.all([page,other].map(tab=>tab.getByRole('button',{name:'Guardar respuesta',exact:true}).click()));
    const folder=join(project,'.bmad-project-ui/comments/threads'),names=await readdir(folder);expect(names).toHaveLength(1);
    const readThread=async()=>JSON.parse(await readFile(join(folder,names[0]),'utf8'));
    await expect.poll(async()=>(await readThread()).messages.length).toBe(2);
    const thread=await readThread(),winner=replies.indexOf(thread.messages[1].text);expect(winner).toBeGreaterThanOrEqual(0);
    const loser=[page,other][1-winner];await expect(loser.getByRole('alert').filter({hasText:'cambió'})).toBeVisible();
    await expect(loser.getByRole('textbox',{name:'Responder',exact:true})).toHaveValue(replies[1-winner]);
    await loser.getByRole('button',{name:'Releer conversación',exact:true}).click();
    await expect(loser.getByText(replies[winner],{exact:true})).toBeVisible();
    await expect(loser.getByRole('textbox',{name:'Responder',exact:true})).toHaveValue(replies[1-winner]);
    expect((await readThread()).messages).toHaveLength(2);
  }finally{await other.close();}
});
