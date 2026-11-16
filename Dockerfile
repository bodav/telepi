# Build the CLI, then keep only production dependencies for the runtime image.
# The full (non-slim) build image ships the toolchain needed by native modules.
FROM node:22-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev


FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Session and downloads live here; mounting a volume keeps you signed in.
RUN mkdir -p /home/node/.config/telepi && chown -R node:node /app /home/node

USER node

ENTRYPOINT ["node", "/app/dist/cli.js"]
