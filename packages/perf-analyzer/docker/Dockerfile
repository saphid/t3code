# Runs the perf harness against published t3 releases on any Linux host.
# Build context is packages/perf-analyzer:
#   docker build -f docker/Dockerfile -t t3-perf:latest .
#
# node:24 is required: the harness runs TypeScript directly via native type
# stripping and uses node:sqlite. The full (non-slim) image also ships git,
# which the fixture seeder shells out to.
FROM node:24-bookworm@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584

# Chromium pinned to the playwright release matching the harness's
# playwright-core; --with-deps installs the system libraries headless
# Chromium needs on Debian.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright@1.60.0 install --with-deps chromium && rm -rf /root/.npm

WORKDIR /harness
# The repo package.json uses workspace "catalog:" versions that plain npm
# cannot resolve; the harness's only runtime dependency is playwright-core.
RUN printf '{"name":"t3-perf-harness","private":true,"type":"module","dependencies":{"playwright-core":"1.60.0"}}' > package.json \
  && npm install --no-audit --no-fund

COPY src ./src
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Result JSON + markdown land here; mount a host directory.
VOLUME /results
ENTRYPOINT ["/entrypoint.sh"]
