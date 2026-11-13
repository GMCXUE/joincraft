FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend
COPY bridge ./bridge
COPY scripts/build-ui.mjs ./scripts/build-ui.mjs
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4180 DATABASE_PATH=/app/data/blockroom.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package*.json server.mjs ./
COPY --chown=node:node public ./public
COPY --from=build --chown=node:node /app/public/voice-sdk.js /app/public/ui.js /app/public/ui.css /app/public/joincraft-bridge.cjs ./public/
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/data /app/backups && chown node:node /app/data /app/backups
USER node
EXPOSE 4180
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:4180/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
