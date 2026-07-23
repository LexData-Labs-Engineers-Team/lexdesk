# Nebula Grand Prix relay — minimal standalone image.
#
# Build context must be the next-app/ directory (the folder containing both
# race-server/ and src/), NOT this deploy/ folder:
#
#   cd next-app
#   docker build -f race-server/deploy/Dockerfile -t nebula-race-relay .
#   docker run -p 3990:3990 nebula-race-relay
#
# The image preserves the repo's relative layout so every import resolves
# exactly as it does on disk:
#
#   /app/package.json                              <- deploy/package.json (ws + three only)
#   /app/node_modules/
#   /app/race-server/{server.mjs,bridge.mjs}
#   /app/race-server/deploy/server-with-health.mjs <- entrypoint (adds GET /healthz)
#   /app/src/components/home/race/{raceEngine.mjs,trackData.mjs}
#
# Import chain (traced): server-with-health.mjs -> ws, ../bridge.mjs,
# ../../src/components/home/race/raceEngine.mjs -> ./trackData.mjs -> three.
# The relay is stateless: no DB, no disk writes, nothing else to copy.

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Deps first so source edits don't bust the install layer.
COPY race-server/deploy/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Source, laid out to mirror the repo.
COPY race-server/server.mjs race-server/bridge.mjs ./race-server/
COPY race-server/deploy/server-with-health.mjs ./race-server/deploy/
COPY src/components/home/race/raceEngine.mjs src/components/home/race/trackData.mjs ./src/components/home/race/

EXPOSE 3990

# Honors RACE_PORT, then a platform-injected PORT, then 3990.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${RACE_PORT:-${PORT:-3990}}/healthz" || exit 1

CMD ["node", "race-server/deploy/server-with-health.mjs"]
