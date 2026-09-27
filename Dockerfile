# syntax=docker/dockerfile:1
# Pin the multi-platform Node 24.21.0 manifest, matching .node-version.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG AGILE_PROJECT_UI_BUILD_REVISION
RUN AGILE_PROJECT_UI_BUILD_REVISION="${AGILE_PROJECT_UI_BUILD_REVISION}" npm run build \
    && rm -f dist/connectors/*.map \
    && npm sbom --sbom-format cyclonedx > /build/npm-build.cdx.json \
    && sed -i '/^\/\/# sourceMappingURL=/d' dist/connectors/*.mjs

FROM ${NODE_IMAGE} AS runtime-base
ARG AGILE_PROJECT_UI_BUILD_REVISION
LABEL org.opencontainers.image.title="Agile Project UI" \
      org.opencontainers.image.description="Local-first project UI with optional Git, Jira and Confluence connectors" \
      org.opencontainers.image.source="https://github.com/enzovalley9/agile-project-ui" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${AGILE_PROJECT_UI_BUILD_REVISION}"
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
    && mkdir -p /opt/agile-project-ui/licenses /state /workspace \
    && chmod 0700 /state \
    && chown node:node /state /workspace \
    && cp /usr/local/LICENSE /opt/agile-project-ui/licenses/Node.js-LICENSE \
    && tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
       -czf /opt/agile-project-ui/licenses/base-tools.tar.gz \
       -C /usr/local/lib node_modules -C /opt "yarn-v${YARN_VERSION}" \
    && rm -rf /usr/local/lib/node_modules /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Exact source accompanies each binary image, including private-repository builds.
# Missing source fails the build; no silent URL-only fallback is permitted.
FROM runtime-base AS corresponding-source
USER root
COPY docker/collect-sources.mjs /tmp/collect-sources.mjs
RUN sed -i 's/Types: deb$/Types: deb deb-src/' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && node /tmp/collect-sources.mjs /collected-sources

FROM runtime-base AS runtime
COPY --from=corresponding-source /collected-sources /opt/agile-project-ui/licenses/
COPY --from=build /build/npm-build.cdx.json /opt/agile-project-ui/licenses/
COPY docker/container-sbom.mjs /tmp/container-sbom.mjs
RUN node /tmp/container-sbom.mjs /opt/agile-project-ui/licenses \
    && rm /tmp/container-sbom.mjs \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/agile-project-ui
ENV NODE_ENV=production HOME=/home/node
COPY --from=build /build/dist/web ./web
COPY --from=build /build/dist/connectors/*.mjs ./connectors/
COPY --from=build /build/LICENSE /build/THIRD_PARTY_NOTICES.md ./
COPY docker/runtime.mjs docker/web-server.mjs docker/healthcheck.mjs docker/verify-distribution.mjs ./docker/
COPY compose.yaml .env.docker.example docs/docker.md docs/supply-chain.md ./docker/
USER node
EXPOSE 8080 43120 43121 43122
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "docker/healthcheck.mjs"]
ENTRYPOINT ["node", "docker/runtime.mjs"]
CMD ["web"]
