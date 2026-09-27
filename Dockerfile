# syntax=docker/dockerfile:1
# Pin the multi-platform Node 24.21.0 manifest, matching .node-version.
ARG NODE_IMAGE=node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe
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

# Build the patched upstream client separately. No server reaches the runtime.
FROM ${NODE_IMAGE} AS openssh-client-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libssl-dev zlib1g-dev ca-certificates git
COPY docker/openssh-source.json docker/build-openssh.mjs docker/ssh-smoke.mjs /recipe/
COPY Dockerfile /recipe/Dockerfile
RUN node /recipe/build-openssh.mjs

FROM ${NODE_IMAGE} AS runtime-base
ARG AGILE_PROJECT_UI_BUILD_REVISION
LABEL org.opencontainers.image.title="Agile Project UI" \
      org.opencontainers.image.description="Local-first project UI with optional Git, Jira and Confluence connectors" \
      org.opencontainers.image.source="https://github.com/enzovalley9/agile-project-ui" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${AGILE_PROJECT_UI_BUILD_REVISION}"
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends git ca-certificates libssl3t64 zlib1g \
    && mkdir -p /opt/agile-project-ui/licenses /state /workspace \
    && chmod 0700 /state \
    && chown node:node /state /workspace \
    && cp /usr/local/LICENSE /opt/agile-project-ui/licenses/Node.js-LICENSE \
    && tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
       -czf /opt/agile-project-ui/licenses/base-tools.tar.gz \
       -C /usr/local/lib node_modules -C /opt "yarn-v${YARN_VERSION}" \
    && rm -rf /usr/local/lib/node_modules /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=openssh-client-build /openssh-output/bin/ /usr/local/bin/
COPY --from=openssh-client-build /openssh-output/sources/ /opt/agile-project-ui/licenses/sources/
COPY --from=openssh-client-build /openssh-output/openssh-build.json /opt/agile-project-ui/licenses/
RUN rm /usr/lib/git-core/git-http-push /usr/bin/infocmp \
    && find /usr/share/perl -path '*/Archive/Tar.pm' -type f -delete \
    && find /usr -xdev -type f \( -perm -4000 -o -perm -2000 \) -exec chmod a-s {} + \
    && test ! -e /usr/bin/ssh && test ! -e /usr/sbin/sshd \
    && ssh -V

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
