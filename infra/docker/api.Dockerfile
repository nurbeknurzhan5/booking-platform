# API и воркер (один образ, разные команды). Сборка из корня репозитория:
#   docker build -f infra/docker/api.Dockerfile -t booking-api .
# Контекст сборки фильтруется файлом infra/docker/api.Dockerfile.dockerignore (без .env, node_modules, dist).
FROM node:24-bookworm-slim AS base
# openssl нужен Prisma: по нему выбирается сборка schema-engine (миграции) — без него скачивается неверная.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Установочные скрипты нативных пакетов (корневой allowScripts) запускаются явно через rebuild.
RUN npm ci --workspace @booking/api --workspace @booking/shared --include-workspace-root --no-audit --no-fund \
 && npm rebuild argon2 @swc/core prisma @prisma/engines

FROM deps AS build
# tsconfig у каждого пакета свой (корневого нет).
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @booking/shared \
 && cd apps/api \
 && npx prisma generate \
 && npx nest build

FROM base AS runtime
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app -d /app -s /usr/sbin/nologin app
# node_modules включает CLI prisma (dev-зависимость): сервис migrate выполняет prisma migrate deploy.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api
USER app
EXPOSE 4000
# Только для API; у воркера проверка отключена в docker-compose.prod.yml (HTTP-порта нет).
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
