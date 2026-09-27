import {test, expect} from './filesystem';
import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

test('edits and comments a derived SPEC with a regeneration notice while preserving its memlog and source siblings', async ({page, project}) => {
  const folder='_bmad-output/specs/spec-notificaciones';
  const specPath=folder+'/SPEC.md';
  const original=await readFile(join(project, specPath), 'utf8');
  const originalEntries=(await readdir(join(project, folder))).sort();
  const protectedPaths=[
    folder+'/.memlog.md',
    folder+'/rules.md',
    folder+'/stories.yaml',
    folder+'/RETROSPECTIVE.md',
    folder+'/stories/1-programar-recordatorio.md',
    '_bmad-output/implementation-artifacts/sprint-status.yaml',
  ];
  const protectedFiles=await Promise.all(protectedPaths.map(async path=>({path, bytes:await readFile(join(project, path))})));
  const addition='Nota manual revisada: el recordatorio sigue siendo exclusivamente local.';
  const edited=original+'\n'+addition+'\n';

  await page.goto('/');
  await page.getByRole('button', {name:'Elegir carpeta del proyecto'}).click();
  await page.getByRole('navigation', {name:'Archivos del proyecto'}).getByTitle(specPath, {exact:true}).click();
  await expect(page.getByRole('heading', {name:'Recordatorios', exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Activar Editor', exact:true}).click();
  const warning=page.getByText('Este documento es derivado. BMAD puede regenerarlo y sobrescribir las modificaciones manuales.', {exact:true});
  await expect(warning).toBeVisible();
  await page.getByRole('button', {name:'Markdown', exact:true}).click();
  const editor=page.getByLabel('Fuente Markdown');
  await editor.click();
  await editor.press('ControlOrMeta+End');
  await editor.press('Enter');
  await page.keyboard.insertText(addition);
  await editor.press('Enter');
  await expect(warning).toBeVisible();
  await page.getByRole('button', {name:'Guardar', exact:true}).click();
  await expect(page.getByText('Guardado localmente y verificado.', {exact:true})).toBeVisible();
  expect(await readFile(join(project, specPath), 'utf8')).toBe(edited);
  await page.getByRole('button', {name:'Vista visual', exact:true}).click();
  await expect(page.getByText(addition, {exact:true})).toBeVisible();

  await page.getByRole('button', {name:'Comentarios', exact:true}).click();
  await page.getByRole('textbox', {name:'Tu nombre', exact:true}).fill('Revisora SPEC');
  await page.getByRole('button', {name:'Usar este nombre', exact:true}).click();
  await page.getByText('Comentar un fragmento', {exact:true}).click();
  const line=edited.split('\n').indexOf(addition)+1;
  await page.getByRole('spinbutton', {name:'Línea inicial', exact:true}).fill(String(line));
  await page.getByRole('spinbutton', {name:'Línea final', exact:true}).fill(String(line));
  await page.getByRole('button', {name:'Seleccionar', exact:true}).click();
  const message='Ajuste manual revisado antes de una posible regeneración.';
  await page.getByRole('textbox', {name:'Nuevo comentario', exact:true}).fill(message);
  await expect(warning).toBeVisible();
  await page.getByRole('button', {name:'Guardar comentario', exact:true}).click();
  await expect(page.getByRole('region', {name:'Mensaje de Revisora SPEC'}).getByText(message, {exact:true})).toBeVisible();

  const threads=join(project, '.bmad-project-ui/comments/threads');
  const threadFiles=await readdir(threads);
  expect(threadFiles).toHaveLength(1);
  const thread=JSON.parse(await readFile(join(threads, threadFiles[0]), 'utf8'));
  expect(thread.anchor.path).toBe(specPath);
  expect(thread.anchor.quote).toBe(addition);
  expect(thread.anchor.revision).toBe(createHash('sha256').update(edited).digest('hex'));
  expect(thread.messages[0].text).toBe(message);
  expect(thread.messages[0].author.name).toBe('Revisora SPEC');
  expect(await readFile(join(project, specPath), 'utf8')).toBe(edited);
  expect((await readdir(join(project, folder))).sort()).toEqual(originalEntries);
  for (const file of protectedFiles) expect(await readFile(join(project, file.path)), file.path).toEqual(file.bytes);
});
