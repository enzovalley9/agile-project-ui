# Distribution, sources and verification

Agile Project UI's original code uses the MIT license. The container also redistributes independently licensed Node.js and Debian components, including Git. Their licenses remain in force; the image's MIT label describes the application, not every bundled component.

## Obtain corresponding source without GitHub access

Each container includes the exact source packages for **every installed Debian binary package**, not only Git, plus the source archive for its Node.js version. The source payload increases the download size. Keeping it in the binary image ensures anyone who can pull the image can obtain its matching sources, even while the application repository is private.

Pin the digest of the image you received, then copy its license and source directory. No container process, credentials, project mount or GitHub login is required:

```sh
AGILE_IMAGE=ghcr.io/enzovalley9/agile-project-ui:latest
# Prefer the immutable image@sha256:... reference recorded at download time.
docker pull "$AGILE_IMAGE"
docker create --name agile-source-files "$AGILE_IMAGE"
docker cp agile-source-files:/opt/agile-project-ui/licenses ./agile-source-files
docker rm agile-source-files
cd agile-source-files
sha256sum --check SHA256SUMS
```

On macOS, use `shasum -a 256 --check SHA256SUMS`. Windows users can verify selected entries with `Get-FileHash -Algorithm SHA256`; the manifest lists every filename and digest. The source files are supplied directly, not through a written offer or an expiring external link. Preserve this directory and the image digest if you redistribute the image. Do not omit the source payload from a derived image unless you arrange another compliant source-delivery mechanism.

The directory contains:

| File                           | Meaning                                                                                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source-manifest.json`         | Binary package versions, architectures, exact source package versions, archive paths, byte counts and SHA-256 hashes.                                                                                           |
| `sources/<package>-<version>/` | Debian `.dsc`, upstream source archives and Debian patches/build recipes. Epochs and binary-only rebuild suffixes are mapped to the actual source version.                                                      |
| `sources/node/`                | The exact Node.js source archive and upstream checksum list.                                                                                                                                                    |
| `copyright/`                   | A copied copyright/license file for every installed Debian package; original files and common licenses remain under `/usr/share/doc` and `/usr/share/common-licenses`.                                          |
| `base-tools.tar.gz`            | Original npm, Corepack and Yarn files/notices from the pinned base image, retained as an inert archive after removing these unused commands from the runtime path. Tar ownership and timestamps are normalized. |
| `Node.js-LICENSE`              | Node.js and bundled third-party notices.                                                                                                                                                                        |
| `container.cdx.json`           | CycloneDX inventory of installed Debian runtime packages and Node.js.                                                                                                                                           |
| `npm-build.cdx.json`           | CycloneDX inventory of the locked npm build graph, including development and optional packages. This is broader than the deployed bundles.                                                                      |
| `SHA256SUMS`                   | Checksums of corresponding sources, package/license inventory and copyright files.                                                                                                                              |

`LICENSE` and `THIRD_PARTY_NOTICES.md` live one directory above. The build copies the package copyrights before collecting source, downloads exact source versions using APT's signed repository metadata, checks `.dsc` identity and every SHA-256, and fails if an archive is missing or altered. Node source is retrieved over HTTPS and checked against its exact upstream SHA-256 list. This is not a claim of an independently reproducible Debian/Node binary build. No source archive is extracted or executed during collection. To work with Debian sources, inspect them first and use `dpkg-source -x package.dsc` in a separate, unprivileged directory; Debian's included `debian/rules` describes its build.

## Verify published image identity

The publication workflow tests both AMD64 and ARM64 images, stores those exact images under unique candidate tags, then promotes their recorded immutable digests without rebuilding. It requires successful application CI for the same source commit. OCI labels and the web's `version.json` record the application revision. Pin the multi-platform digest for deployments and rollback; a tag is a convenient lookup, not a cryptographic identity.

The publication workflow signs the multi-platform digest with Sigstore Cosign using GitHub Actions OIDC. Its signed provenance names the commit and workflow run. Runtime CycloneDX attestations attach to each platform digest. Candidate tags may exist before a full release; use the signed multi-platform digest for deployment. Only small metadata reports enter private Actions artifact storage; the image/source payload stays in the already-public registry. These signatures prove which workflow produced the statements; they do not replace tests, a security review, or an operating-system code-signing certificate. The public transparency log records the repository/workflow identity and digest, never source files, credentials or user projects.

Install Cosign from its official distribution, select a digest from the release evidence, and require the exact workflow identity:

```sh
AGILE_IMAGE=ghcr.io/enzovalley9/agile-project-ui@sha256:REPLACE_WITH_PUBLISHED_DIGEST
cosign verify "$AGILE_IMAGE" \
  --certificate-identity https://github.com/enzovalley9/agile-project-ui/.github/workflows/container.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify-attestation "$AGILE_IMAGE" --type slsaprovenance1 \
  --certificate-identity https://github.com/enzovalley9/agile-project-ui/.github/workflows/container.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

For the runtime SBOM, use `cosign verify-attestation --type cyclonedx` with the selected **platform** digest and the same identity/issuer constraints. Older images may predate signatures and source payloads; only describe a particular published digest as verified after its verification commands succeed.

## Security maintenance

The scheduled security workflow runs weekly and on demand. It audits all locked npm dependencies and scans the public container with Trivy's current vulnerability database, preserving the full report including vulnerabilities without available fixes. It fails on high/critical findings with an available fix; maintainers must triage unfixed findings too. Debian backports are evaluated using distribution advisories rather than an upstream version string alone. Dependency update pull requests are reviewed and tested before release. A scan cannot prove absence of vulnerabilities.

Container publication runs the same vulnerability gate before promotion. Failed collection, tests, scanning or signing must be investigated, not bypassed by overwriting an existing release. To ship a repair, update the dependency/base digest, rerun tests, and publish a new version. Save the previous image digest before upgrading so rollback is explicit. See [maintenance](maintaining.md), [Docker installation](docker.md), and [security reporting](../SECURITY.md).

References: [Debian source package policy](https://www.debian.org/doc/debian-policy/ch-source.html), [APT source downloads](https://manpages.debian.org/bookworm/apt/apt-get.8.en.html), [Sigstore container signing](https://docs.sigstore.dev/cosign/signing/signing_with_containers/), and [Trivy vulnerability scanning](https://trivy.dev/latest/docs/scanner/vulnerability/).
