# Contributing

Contributions should improve the local-file workflow while preserving source fidelity, explicit review and predictable recovery. Read the [MIT license](LICENSE) and [code of conduct](CODE_OF_CONDUCT.md) before participating.

The repository currently accepts issues and pull requests from people with repository access. See [SUPPORT.md](SUPPORT.md) for current contact options; a public application URL does not make a private GitHub repository accessible.

## Propose a change

For a substantial feature, explain the problem and intended behavior in an issue before implementation. Include a small synthetic example instead of a real project's files. Use English for issues, documentation, code comments and interface text. Preserve users' document language and deliberate Unicode/format regression coverage. Protocol keys and third-party legal notices retain their original spelling and terms.

Bug reports should include the source commit/version, OS, browser/version, steps, expected/actual behavior and sanitized evidence. Follow [SECURITY.md](SECURITY.md) for vulnerabilities. General questions belong in an issue while no separate discussion/support channel is configured.

## Work locally

Read the [development](docs/development.md), [architecture](docs/architecture.md) and [testing](docs/testing.md) guides. Use the pinned Node runtime and install with `npm ci`.

Keep changes focused and preserve unrelated work. The source of truth is the project's files: do not introduce a parallel authoritative database or silently normalize documents. Preserve source provenance, revision preconditions, explicit review and recovery behavior. Provider capabilities must describe guarantees actually available, not an optimistic future API.

New UI should work with keyboard navigation, readable contrast, narrow layouts and the supported theme choices. Use existing design tokens and accessible controls. Do not load remote document resources or add telemetry without an explicit design and privacy review.

## Verify and submit

- Run `npm run check` for source changes. Run the relevant browser journeys for UI/file/connector flows; document any unavailable environment separately.
- For a fixed defect, add a behavioral regression when it protects meaningful behavior. Documentation-only changes need accurate commands, working links and a rendered-text review rather than invented tests.
- For dependencies or bundled assets, retain licenses/notices and update the lockfile. Identify original sources. Do not copy private planning documents, credentials or third-party branding into the product.
- Describe the concrete problem, resulting behavior, validation and remaining limitations in the pull request. UI changes should include a screenshot or interaction evidence that contains no private project data.

Maintainers review correctness, scope, usability and evidence before accepting a contribution. There is no promised review or release deadline. See the [code of conduct](CODE_OF_CONDUCT.md).

## Licensing contributions

Submit only work you have the right to contribute. By intentionally submitting a contribution for inclusion, you agree that it may be distributed under the project's MIT license; you retain your copyright. This project does not require copyright assignment or a separate contributor license agreement.

Identify third-party material, its source and its license in the pull request. Preserve required attribution and notices. The project license does not grant rights to third-party trademarks or confidential material. Do not contribute upstream logos, private documents or copied code merely because it is accessible online.
