import {test, expect} from './filesystem';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Page} from '@playwright/test';

async function openProject(page:Page) {
  await page.goto('/');
  await page.getByRole('button', {name:'Elegir carpeta del proyecto'}).click();
}

test('retains tree selection and nested folding through expand, search and source navigation', async ({page, project}) => {
  const notePath=join(project, 'docs/notas/reunion.md');
  const note=await readFile(notePath, 'utf8')+'\n[Consultar el manual de riego](../manual/riego.md)\n';
  await writeFile(notePath, note);
  await openProject(page);
  const tree=page.getByRole('navigation', {name:'Archivos del proyecto'});
  const selected=tree.getByRole('button', {name:'reunion.md', exact:true});
  await selected.click();
  await expect(selected).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', {name:'Plegar todo', exact:true}).click();
  await expect(selected).toBeHidden();
  await expect(page.getByRole('heading', {name:'Reunión de prueba', exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Expandir todo', exact:true}).click();
  await expect(selected).toBeVisible();
  await expect(selected).toHaveAttribute('aria-current', 'page');

  const manual=tree.locator('summary[title="docs/manual"]');
  const docs=tree.locator('summary[title="docs"]');
  await manual.click();
  await expect(manual.locator('..')).not.toHaveAttribute('open');
  await docs.click();
  await docs.click();
  await expect(manual.locator('..')).not.toHaveAttribute('open');
  await expect(tree.getByRole('button', {name:'riego.md', exact:true})).toBeHidden();

  await page.getByRole('link', {name:'Consultar el manual de riego', exact:true}).click();
  const riego=tree.getByRole('button', {name:'riego.md', exact:true});
  await expect(page.getByRole('heading', {name:'Riego', exact:true})).toBeVisible();
  await expect(manual.locator('..')).toHaveAttribute('open');
  await expect(riego).toHaveAttribute('aria-current', 'page');
  await expect(selected).not.toHaveAttribute('aria-current');
  const search=page.getByRole('textbox', {name:'Buscar archivo', exact:true});
  await search.fill('notas/');
  await expect(selected).toBeVisible();
  await expect(riego).toHaveCount(0);
  await expect(page.getByRole('heading', {name:'Riego', exact:true})).toBeVisible();
  await search.fill('ningun-archivo-coincide');
  await expect(tree.getByText('No hay archivos con ese nombre.')).toBeVisible();
  await search.fill('');
  await expect(riego).toHaveAttribute('aria-current', 'page');
  expect(await readFile(notePath, 'utf8')).toBe(note);
});

test('keeps both PRDs and ADRs addressable and long filenames readable without widening the tree', async ({page, project}) => {
  const longName='002-'+('decision-documentada-con-nombre-extenso-'.repeat(4))+'sin-truncar-identidad.md';
  const longPath='docs/adrs/'+longName;
  const longText='# ADR 002: decisiones independientes\n\nUn segundo ADR conserva su ruta y contenido propios.\n';
  await writeFile(join(project, longPath), longText);
  await page.setViewportSize({width:1440, height:1000});
  await openProject(page);
  const tree=page.getByRole('navigation', {name:'Archivos del proyecto'});
  await expect(tree.getByRole('button', {name:'prd.md', exact:true})).toHaveCount(2);
  const variants=[
    ['_bmad-output/planning-artifacts/prds/prd-herramientas-2026-09-27/prd.md', 'Préstamos'],
    ['_bmad-output/planning-artifacts/prds/prd-huerto-2026-09-27/prd.md', 'Huerto Compartido'],
    ['docs/adrs/001-calendario.md', 'ADR 001: Europe/Madrid'],
    [longPath, 'ADR 002: decisiones independientes'],
  ];
  for (const [path, heading] of variants) {
    const file=tree.getByTitle(path, {exact:true});
    await file.click();
    await expect(file).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', {name:heading, exact:true})).toBeVisible();
  }
  const longFile=tree.getByRole('button', {name:longName, exact:true});
  await expect(longFile).toHaveAttribute('title', longPath);
  const label=longFile.locator('span').last();
  const geometry=await label.evaluate(element=>({
    clipped:element.scrollWidth>element.clientWidth,
    whiteSpace:getComputedStyle(element).whiteSpace,
    overflow:getComputedStyle(element).textOverflow,
  }));
  expect(geometry).toEqual({clipped:true, whiteSpace:'nowrap', overflow:'ellipsis'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('textbox', {name:'Buscar archivo', exact:true}).fill(longName);
  await expect(tree.getByRole('button')).toHaveCount(1);
  await expect(longFile).toHaveAttribute('aria-current', 'page');
  expect(await readFile(join(project, longPath), 'utf8')).toBe(longText);
});

test('shows empty filters and unknown status honestly and opens a backlog source with backward focus contained', async ({page, project}) => {
  const sprintPath=join(project, '_bmad-output/implementation-artifacts/sprint-status.yaml');
  const sprintBefore=await readFile(sprintPath, 'utf8');
  expect((await readdir(join(project, '_bmad-output/implementation-artifacts'))).some(name=>name.startsWith('2-2-'))).toBe(false);
  await openProject(page);
  await page.getByRole('button', {name:'Historias', exact:true}).click();
  const search=page.getByRole('textbox', {name:'Buscar historia', exact:true});
  await search.fill('no-existe-ninguna-historia');
  await expect(page.getByRole('heading', {name:'No hay historias disponibles', exact:true})).toBeVisible();
  for (const name of ['Backlog', 'Preparadas', 'En progreso', 'En revisión', 'Hechas']) {
    const column=page.getByRole('region', {name, exact:true});
    await expect(column).toBeVisible();
    await expect(column.getByRole('button')).toHaveCount(0);
  }
  await search.fill('Revisar inventario');
  const unknown=page.getByRole('heading', {name:'Sin clasificar', exact:true}).locator('..');
  await expect(unknown.getByText('paused', {exact:true})).toBeVisible();
  await expect(unknown.getByRole('button', {name:/Revisar inventario/})).toBeVisible();
  await expect(page.getByRole('region', {name:'Backlog', exact:true}).getByRole('button')).toHaveCount(0);

  await search.fill('Devolver herramienta');
  const card=page.getByRole('region', {name:'Backlog', exact:true}).getByRole('button', {name:/Devolver herramienta/});
  await card.click();
  const dialog=page.getByRole('dialog', {name:'2.2', exact:true});
  await expect(dialog.getByRole('heading', {name:'Devolver herramienta', exact:true})).toBeVisible();
  await expect(dialog.getByText('Cerrar un préstamo preservando su historial.', {exact:true})).toBeVisible();
  await expect(dialog.getByText('Documento de historia todavía no creado o asociación no verificada.', {exact:true})).toBeVisible();
  const provenance=dialog.getByText('Procedencia', {exact:true}).locator('..');
  await provenance.locator('summary').click();
  await expect(provenance.getByText('Entidad', {exact:true})).toBeVisible();
  await expect(provenance.getByText('Descripción', {exact:true})).toBeVisible();
  await expect(provenance.locator('code').filter({hasText:/epics\.md/})).toContainText('_bmad-output/planning-artifacts/epics.md · líneas');
  await expect(provenance.locator('code').filter({hasText:/sprint-status\.yaml · líneas/})).toHaveCount(1);
  await dialog.getByRole('button', {name:'Cerrar ventana', exact:true}).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', {name:'Abrir documento de origen', exact:true})).toBeFocused();
  for (let index=0; index<8; index++) {
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  }
  await dialog.getByRole('button', {name:'Abrir documento de origen', exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('navigation', {name:'Archivos del proyecto'}).getByRole('button', {name:'sprint-status.yaml', exact:true})).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', {name:'Markdown', exact:true}).click();
  await expect(page.getByLabel('Fuente Markdown')).toContainText('2-2-devolver-herramienta: backlog');
  expect(await readFile(sprintPath, 'utf8')).toBe(sprintBefore);
});
