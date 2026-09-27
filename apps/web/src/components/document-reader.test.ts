import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentReader, resolveDocumentLink } from './DocumentReader';
const render=(source:string,editable=false)=>renderToStaticMarkup(createElement(DocumentReader,{source,path:'docs/prd.md',editable,onChange:()=>undefined,onNavigate:()=>undefined,onSelect:()=>undefined}));
describe('Markdown presentation boundary',()=>{
  it('maps text leaves to physical source offsets without making structural markup editable',()=>{
    const html=render('# Title\n\nA **bold** phrase.\n',true);
    expect(html).toContain('data-source-start="2"');expect(html).toContain('data-source-end="7"');expect(html).toContain('contentEditable="plaintext-only"');expect(html).toContain('<strong>');expect(html).toContain('data-source-line="3"');
  });
  it('does not execute document HTML and rejects javascript links',()=>{
    const html=render('safe\n\n<script>window.pwned=true</script>\n\n[unsafe](javascript:alert(1))');
    expect(html).not.toContain('<script>');expect(html).not.toContain('href="javascript:');expect(html).toContain('safe');
  });
  it('renders a GFM table as one semantic table and excludes code headings from TOC',()=>{
    const html=render('# Real heading\n\n```md\n# Code only\n```\n\n| A | B |\n| --- | --- |\n| one | two |\n');
    expect((html.match(/<table>/g)||[]).length).toBe(1);expect(html).toContain('1 secciones');expect(html).not.toContain('href="#code-only"');expect(html).toContain('id="real-heading"');
  });
  it('blocks links leaving the authorized project while resolving valid siblings',()=>{
    expect(resolveDocumentLink('docs/prd.md','../architecture/adr.md#decision')).toBe('architecture/adr.md');
    for(const target of ['../../private.md','../../../etc/passwd','/etc/passwd','file:///tmp/secret','https://example.com','//example.com','..%2f..%2fprivate.md','..\\secret'])expect(resolveDocumentLink('docs/prd.md',target)).toBeNull();
  });
  it('omits frontmatter from content and TOC without shifting physical source lines',()=>{const html=render('---\ntitle: Metadata\nstatus: draft\n---\n\n# Actual heading\n\nBody text.',true);expect(html).not.toContain('title: Metadata');expect(html).toContain('1 secciones');expect(html).toContain('data-source-line="8"');expect(html).toContain('data-source-start="');});
  it('does not load remote images merely by opening a document',()=>{expect(render('![tracking](https://example.com/pixel.png)')).not.toContain('<img');});
});
