# Monday server: API, agent runners and the Nansen collector in one process.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN npm ci --omit=dev --workspace @monday/server --workspace @monday/core
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/server apps/server
WORKDIR /app/apps/server
ENV NODE_ENV=production
EXPOSE 3001
CMD ["npx", "tsx", "src/index.ts"]
