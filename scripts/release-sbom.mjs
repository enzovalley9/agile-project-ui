import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const sourceSbomName = 'agile-project-ui-source-sbom.spdx.json';
const hash = (value) => createHash('sha256').update(value).digest('hex');

// This is a source dependency inventory, including development/optional packages,
// not a claim that every locked dependency is shipped in each bundled connector.
export function sourceSbom({ lockfile, metadata, revision, repository, nodeVersion, created }) {
  const lock = JSON.parse(lockfile);
  assert.equal(lock.lockfileVersion, 3, 'SBOM requires the reviewed npm lockfile schema.');
  assert.equal(lock.packages?.['']?.name, metadata.name, 'SBOM package name differs from source.');
  assert.equal(
    lock.packages?.['']?.version,
    metadata.version,
    'SBOM package version differs from source.',
  );
  assert.match(revision, /^[a-f0-9]{40}$/);
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(nodeVersion, /^\d+\.\d+\.\d+$/);
  const packages = [
    {
      SPDXID: 'SPDXRef-Application',
      name: metadata.name,
      versionInfo: metadata.version,
      downloadLocation: `https://github.com/${repository}/tree/${revision}`,
      filesAnalyzed: false,
      licenseDeclared: metadata.license,
      primaryPackagePurpose: 'APPLICATION',
      sourceInfo: `Source commit ${revision}; package-lock.json SHA-256 ${hash(lockfile)}.`,
    },
    {
      SPDXID: 'SPDXRef-NodeRuntime',
      name: 'node',
      versionInfo: nodeVersion,
      downloadLocation: `https://nodejs.org/dist/v${nodeVersion}/`,
      filesAnalyzed: false,
      licenseDeclared: 'NOASSERTION',
      sourceInfo:
        'Bundled Node runtime; each native archive records its exact upstream archive SHA-256 and includes runtime/LICENSE.',
    },
  ];
  for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (path === '') continue;
    assert(
      path.includes('node_modules/') && typeof entry.version === 'string',
      'Unsupported locked package.',
    );
    const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 13);
    const location = entry.resolved ?? 'NOASSERTION';
    assert(
      location === 'NOASSERTION' || /^https:\/\/registry\.npmjs\.org\//.test(location),
      'Review non-registry package sources before publishing an SBOM.',
    );
    const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/.exec(entry.integrity ?? '');
    packages.push({
      SPDXID: `SPDXRef-Package-${hash(path).slice(0, 24)}`,
      name,
      versionInfo: entry.version,
      packageFileName: path,
      downloadLocation: location,
      filesAnalyzed: false,
      licenseDeclared: entry.license || 'NOASSERTION',
      sourceInfo: `Committed npm lockfile entry; development=${entry.dev === true}; optional=${entry.optional === true}.`,
      externalRefs: [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: `pkg:npm/${name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(entry.version)}`,
        },
      ],
      ...(match
        ? {
            checksums: [
              {
                algorithm: match[1].toUpperCase(),
                checksumValue: Buffer.from(match[2], 'base64').toString('hex'),
              },
            ],
          }
        : {}),
    });
  }
  return (
    JSON.stringify(
      {
        spdxVersion: 'SPDX-2.3',
        dataLicense: 'CC0-1.0',
        SPDXID: 'SPDXRef-DOCUMENT',
        name: `${metadata.name} ${metadata.version} source dependency inventory`,
        documentNamespace: `https://github.com/${repository}/sbom/${revision}`,
        creationInfo: {
          created: new Date(created).toISOString(),
          creators: ['Tool: Agile Project UI release-sbom'],
          comment:
            'Reproducible metadata uses the source commit timestamp. This inventory covers the npm lockfile and pinned Node runtime, not the container operating system or exact bundled module reachability.',
        },
        documentDescribes: ['SPDXRef-Application'],
        packages,
        relationships: [
          {
            spdxElementId: 'SPDXRef-DOCUMENT',
            relatedSpdxElement: 'SPDXRef-Application',
            relationshipType: 'DESCRIBES',
          },
          ...packages.slice(1).map((item) => ({
            spdxElementId: 'SPDXRef-Application',
            relatedSpdxElement: item.SPDXID,
            relationshipType: 'DEPENDS_ON',
          })),
        ],
      },
      null,
      2,
    ) + '\n'
  );
}
