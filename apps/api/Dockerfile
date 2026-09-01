# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Copy manifests first for better layer caching.
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json

RUN npm install --no-audit --no-fund

# Copy sources (with their package.json lock context).
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build -w @graphrag/shared
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build -w @graphrag/api

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/server.js"]