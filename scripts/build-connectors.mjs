import { build } from 'esbuild';
await build({
  entryPoints: {
    git: 'apps/git-connector/src/cli.ts',
    atlassian: 'apps/atlassian-connector/src/cli.ts',
  },
  outdir: 'dist/connectors',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
