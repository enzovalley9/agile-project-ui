import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = process.argv[2];
const inventory = JSON.parse(await readFile(path.join(directory, 'source-manifest.json'), 'utf8'));
const npm = JSON.parse(await readFile(path.join(directory, 'npm-build.cdx.json'), 'utf8'));
assert.equal(npm.bomFormat, 'CycloneDX');
const components = inventory.debianPackages.map((pkg) => ({
  type: 'library',
  name: pkg.name,
  version: pkg.version,
  'bom-ref': `deb:${pkg.name}@${pkg.version}`,
  purl: `pkg:deb/debian/${encodeURIComponent(pkg.name.replace(/:.+$/, ''))}@${encodeURIComponent(pkg.version)}?arch=${pkg.architecture}&distro=debian-12`,
  properties: [
    { name: 'agile:source-package', value: pkg.source },
    { name: 'agile:source-version', value: pkg.sourceVersion },
    { name: 'agile:copyright-file', value: pkg.copyright },
  ],
}));
components.push({
  type: 'platform',
  name: 'node',
  version: process.versions.node,
  'bom-ref': `node@${process.versions.node}`,
  purl: `pkg:generic/node@${process.versions.node}`,
  licenses: [
    { license: { name: 'Node.js and bundled third-party licenses; see Node.js-LICENSE' } },
  ],
});
const root = {
  type: 'application',
  name: 'agile-project-ui-container',
  version: npm.metadata.component.version,
  'bom-ref': `agile-container@${inventory.revision}`,
};
await writeFile(
  path.join(directory, 'container.cdx.json'),
  JSON.stringify(
    {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      version: 1,
      metadata: {
        component: root,
        properties: [
          { name: 'agile:revision', value: inventory.revision },
          { name: 'agile:npm-build-inventory', value: 'npm-build.cdx.json' },
          {
            name: 'agile:scope',
            value:
              'Installed Debian runtime packages and Node. The separate npm build inventory includes build tools and optional packages; bundled dependencies are described in THIRD_PARTY_NOTICES.md.',
          },
        ],
      },
      components,
      dependencies: [
        { ref: root['bom-ref'], dependsOn: components.map((component) => component['bom-ref']) },
      ],
    },
    null,
    2,
  ) + '\n',
);
let checksums = await readFile(path.join(directory, 'SHA256SUMS'), 'utf8');
for (const name of [
  'container.cdx.json',
  'npm-build.cdx.json',
  'Node.js-LICENSE',
  'base-tools.tar.gz',
]) {
  const digest = createHash('sha256')
    .update(await readFile(path.join(directory, name)))
    .digest('hex');
  checksums += `${digest}  ${name}\n`;
}
await writeFile(path.join(directory, 'SHA256SUMS'), checksums);
