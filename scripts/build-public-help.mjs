import { buildRevision } from './build-revision.mjs';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Only these maintained product documents may enter the anonymous help site.
export const PUBLIC_HELP_PAGES = Object.freeze(
  [
    ['README.md', 'index.html', 'Overview'],
    ['docs/connector-setup.md', 'connector-setup/index.html', 'Install connectors'],
    ['SUPPORT.md', 'support/index.html', 'Support'],
    ['SECURITY.md', 'security/index.html', 'Security'],
    ['docs/architecture.md', 'architecture/index.html', 'Architecture'],
    ['docs/git-connector.md', 'git-connector/index.html', 'Git reference'],
    ['docs/atlassian-connectors.md', 'atlassian-connectors/index.html', 'Atlassian reference'],
    ['docs/development.md', 'development/index.html', 'Development'],
    ['docs/testing.md', 'testing/index.html', 'Testing'],
    ['docs/hosting.md', 'hosting/index.html', 'Hosting'],
    ['docs/docker.md', 'docker/index.html', 'Docker'],
    ['docs/releases.md', 'releases/index.html', 'Releases'],
    ['CHANGELOG.md', 'changelog/index.html', 'Changelog'],
    ['CONTRIBUTING.md', 'contributing/index.html', 'Contributing'],
    ['CODE_OF_CONDUCT.md', 'code-of-conduct/index.html', 'Code of conduct'],
  ].map((entry) => Object.freeze(entry)),
);

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const h = React.createElement;
const helpBySource = new Map(PUBLIC_HELP_PAGES.map(([source, output]) => [source, output]));
const publicRootFiles = new Set(['LICENSE', 'THIRD_PARTY_NOTICES.md']);
const allowedElements = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
];

const stylesheet = `
:root{color-scheme:light dark;--paper:#fff;--canvas:#f3f5f8;--ink:#182431;--muted:#4c5968;--line:#ccd4de;--accent:#145ab8;--code:#edf1f6;--focus:#995000}
*{box-sizing:border-box}html{scroll-padding-top:1.5rem}body{margin:0;background:var(--canvas);color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:1rem;line-height:1.65}a{color:var(--accent);text-underline-offset:.18em}a:hover{text-decoration-thickness:.15em}a:focus-visible,pre:focus-visible,.table-scroll:focus-visible{outline:3px solid var(--focus);outline-offset:4px;border-radius:3px}.skip{position:absolute;left:1rem;top:-5rem;z-index:2;background:var(--paper);padding:.75rem}.skip:focus{top:1rem}.shell{max-width:82rem;margin:auto;padding:1.5rem 2rem}header{border-bottom:1px solid var(--line);background:var(--paper)}.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}.brand{font-size:1.1rem;font-weight:700;text-decoration:none}.top nav{display:flex;flex-wrap:wrap;gap:.75rem 1.25rem}.layout{display:grid;grid-template-columns:14rem minmax(0,1fr);gap:2.5rem;align-items:start}.sidebar{position:sticky;top:1.5rem}.sidebar p{margin:0 0 .5rem;font-weight:700}.sidebar ul{list-style:none;padding:0;margin:0}.sidebar a{display:block;padding:.35rem .6rem;border-radius:.3rem;text-decoration:none}.sidebar a[aria-current=page]{background:var(--code);font-weight:700}.sidebar a:hover{text-decoration:underline}main{background:var(--paper);padding:2.25rem;border:1px solid var(--line);border-radius:.75rem;min-width:0}h1,h2,h3,h4,h5,h6{line-height:1.25;overflow-wrap:anywhere}h1{font-size:2.1rem;margin-top:0;letter-spacing:-.025em}h2{font-size:1.5rem;margin-top:2.5rem;border-top:1px solid var(--line);padding-top:1.5rem}h3{margin-top:1.75rem;font-size:1.2rem}p,li,a{overflow-wrap:anywhere}ul,ol{padding-left:1.5rem}li+li{margin-top:.4rem}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em;background:var(--code);padding:.12em .3em;border-radius:.25rem}pre{background:var(--code);padding:1rem;border:1px solid var(--line);border-radius:.5rem;overflow-x:auto;line-height:1.55}pre code{background:none;padding:0;white-space:pre;overflow-wrap:normal}blockquote{margin:1.5rem 0;padding:.3rem 1rem;border-left:4px solid var(--accent);background:var(--code)}.table-scroll{overflow-x:auto;margin:1.25rem 0}table{border-collapse:collapse;width:100%;font-size:.94rem}th,td{text-align:left;vertical-align:top;padding:.7rem .8rem;border:1px solid var(--line);min-width:9rem}th{background:var(--code)}footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--line);margin-top:2.5rem;padding-top:1.25rem}.image-reference{display:inline-block;color:var(--muted);border:1px solid var(--line);padding:.65rem;border-radius:.3rem}hr{border:0;border-top:1px solid var(--line)}
@media(prefers-color-scheme:dark){:root{--paper:#17212d;--canvas:#0e1621;--ink:#edf2fa;--muted:#b8c6d7;--line:#46566b;--accent:#8cbeff;--code:#233144;--focus:#ffd18a}}
@media(max-width:900px){.shell{padding:1.25rem}.layout{grid-template-columns:1fr;gap:1.5rem}.sidebar{position:static}.sidebar ul{display:flex;flex-wrap:wrap;gap:.2rem .4rem}.sidebar a{border:1px solid var(--line)}main{padding:1.5rem}}
@media(max-width:480px){.shell{padding:.85rem}main{padding:1rem}h1{font-size:1.75rem}.top nav{gap:.5rem 1rem}pre{font-size:.85rem}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
@media print{header,.sidebar,.skip{display:none}.layout{display:block}body,main{background:#fff;color:#000}main{border:0;padding:0}.shell{padding:0;max-width:none}a{color:inherit}pre{white-space:pre-wrap}pre code{white-space:pre-wrap}.table-scroll{overflow:visible}}
`;

async function requireRegularSource(relativePath) {
  const absolute = path.join(projectRoot, relativePath);
  const info = await lstat(absolute);
  if (!info.isFile() || (await realpath(absolute)) !== path.resolve(absolute)) {
    throw new Error(`Public help source must be a regular, non-symlink file: ${relativePath}`);
  }
  return readFile(absolute, 'utf8');
}

function textContent(children) {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return React.isValidElement(child) ? textContent(child.props.children) : '';
    })
    .join('');
}

function documentComponents() {
  const seen = new Map();
  const heading =
    (level) =>
    ({ children }) => {
      const base =
        textContent(children)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s_-]/gu, '')
          .trim()
          .replace(/\s+/g, '-') || 'section';
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return h(`h${level}`, { id: count === 0 ? base : `${base}-${count}` }, children);
    };
  return {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    // Images become explicit links, never automatic requests to remote resources.
    img: ({ src, alt }) =>
      h(
        'span',
        { className: 'image-reference' },
        alt || 'Image',
        src ? [' · ', h('a', { href: src, key: 'source' }, 'Open image source')] : null,
      ),
    a: ({ href, children, title }) => h('a', { href, title, rel: 'noreferrer' }, children),
    input: ({ checked }) =>
      h('input', {
        type: 'checkbox',
        disabled: true,
        checked: Boolean(checked),
        'aria-label': checked ? 'Completed' : 'Not completed',
      }),
    pre: ({ children }) => h('pre', { tabIndex: 0 }, children),
    table: ({ children }) =>
      h(
        'div',
        {
          className: 'table-scroll',
          tabIndex: 0,
          role: 'region',
          'aria-label': 'Scrollable table',
        },
        h('table', null, children),
      ),
  };
}

function rewriteUrl(url, source, repository, commit) {
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (!url || url.startsWith('#')) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//') || url.includes('\\'))
    return undefined;
  const match = /^([^?#]*)(.*)$/.exec(url);
  let decoded;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
  if (decoded.startsWith('/')) return decoded === '/' ? `/${match[2]}` : undefined;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(source), decoded));
  if (target === '..' || target.startsWith('../') || target.includes('\0')) return undefined;
  const output = helpBySource.get(target);
  if (output) return `/help/${output.replace(/index\.html$/, '')}${match[2]}`;
  if (publicRootFiles.has(target)) return `/${target}${match[2]}`;
  const kind =
    path.posix.extname(target) || path.posix.basename(target).startsWith('.') ? 'blob' : 'tree';
  return `${repository}/${kind}/${commit}/${target.split('/').map(encodeURIComponent).join('/')}${match[2]}`;
}

export async function buildPublicHelp() {
  const outputRoot = path.join(projectRoot, 'dist/web');
  for (const relative of ['dist', 'dist/web']) {
    const info = await lstat(path.join(projectRoot, relative));
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Expected build directory: ${relative}`);
  }
  const packageJson = JSON.parse(await requireRegularSource('package.json'));
  const commit = buildRevision(projectRoot);
  if (!/^[a-f\d]{40}$/.test(commit))
    throw new Error('Expected a full Git revision for public build metadata.');
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(packageJson.version))
    throw new Error('Expected a semantic package version.');
  const repository = String(packageJson.repository?.url ?? '')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');
  if (!/^https:\/\/github\.com\/[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository))
    throw new Error('Expected a public GitHub repository URL without credentials.');
  const documents = await Promise.all(
    PUBLIC_HELP_PAGES.map(async ([source, output, label]) => ({
      source,
      output,
      label,
      markdown: await requireRegularSource(source),
    })),
  );
  const title = /^#\s+(.+)$/m.exec(documents[0].markdown)?.[1]?.trim();
  if (!title) throw new Error('README.md needs a product title.');
  const helpRoot = path.join(outputRoot, 'help');
  try {
    const info = await lstat(helpRoot);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Public help output must be a real directory.');
    await rm(helpRoot, { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(helpRoot);
  await writeFile(path.join(helpRoot, 'help.css'), stylesheet.trim() + '\n');
  for (const document of documents) {
    const page = h(
      'html',
      { lang: 'en' },
      h(
        'head',
        null,
        h('meta', { charSet: 'utf-8' }),
        h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
        h('meta', { name: 'referrer', content: 'no-referrer' }),
        h('title', null, `${document.label} | ${title}`),
        h('link', { rel: 'stylesheet', href: '/help/help.css' }),
      ),
      h(
        'body',
        null,
        h('a', { className: 'skip', href: '#content' }, 'Skip to content'),
        h(
          'header',
          null,
          h(
            'div',
            { className: 'shell top' },
            h('a', { className: 'brand', href: '/help/' }, `${title} · Help`),
            h(
              'nav',
              { 'aria-label': 'Quick links' },
              h('a', { href: '/' }, 'Open app'),
              h('a', { href: '/help/connector-setup/' }, 'Install connectors'),
              h('a', { href: '/help/support/' }, 'Support'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'shell layout' },
          h(
            'nav',
            { className: 'sidebar', 'aria-label': 'Documentation' },
            h('p', null, 'Documentation'),
            h(
              'ul',
              null,
              PUBLIC_HELP_PAGES.map(([, output, label]) =>
                h(
                  'li',
                  { key: output },
                  h(
                    'a',
                    {
                      href: `/help/${output.replace(/index\.html$/, '')}`,
                      'aria-current': output === document.output ? 'page' : undefined,
                    },
                    label,
                  ),
                ),
              ),
            ),
            h(
              'ul',
              null,
              h('li', null, h('a', { href: '/LICENSE' }, 'MIT license')),
              h('li', null, h('a', { href: '/THIRD_PARTY_NOTICES.md' }, 'Third-party notices')),
            ),
          ),
          h(
            'main',
            { id: 'content' },
            h(
              Markdown,
              {
                remarkPlugins: [remarkGfm],
                skipHtml: true,
                allowedElements,
                components: documentComponents(),
                urlTransform: (url) => rewriteUrl(url, document.source, repository, commit),
              },
              document.markdown,
            ),
            h(
              'footer',
              null,
              `Version ${packageJson.version} · Source ${commit.slice(0, 12)}. `,
              'This help is available without a GitHub account. Repository links and release downloads may require access.',
            ),
          ),
        ),
      ),
    );
    await mkdir(path.dirname(path.join(helpRoot, document.output)), { recursive: true });
    await writeFile(
      path.join(helpRoot, document.output),
      '<!doctype html>\n' + renderToStaticMarkup(page) + '\n',
    );
  }
  await writeFile(
    path.join(outputRoot, 'version.json'),
    JSON.stringify({ version: packageJson.version, revision: commit }, null, 2) + '\n',
  );
  console.log(
    `Built ${documents.length} public help pages from the maintained-document allowlist.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPublicHelp();
}
