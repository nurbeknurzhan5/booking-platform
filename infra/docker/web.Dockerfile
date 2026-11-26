# Frontend (Next.js standalone). Сборка из корня репозитория:
#   docker build -f infra/docker/web.Dockerfile -t booking-web .
# Контекст сборки фильтруется файлом infra/docker/web.Dockerfile.dockerignore (без .env*, node_modules, .next).
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @booking/web --workspace @booking/shared --include-workspace-root --no-audit --no-fund

FROM deps AS build
ARG NEXT_PUBLIC_2GIS_KEY=""
# Адрес API для rewrites /api/* — подставляется в routes-manifest при next build (в standalone не перечитывается).
ARG API_INTERNAL_URL=http://api:4000
# NEXT_PUBLIC_APP_ENV=production отключает временную карту без ключа и другие инструменты разработки;
# «Тестовый телефон» (/dev/phone) в production-образе выключен явно.
ENV NEXT_PUBLIC_2GIS_KEY=$NEXT_PUBLIC_2GIS_KEY \
    API_INTERNAL_URL=$API_INTERNAL_URL \
    NEXT_PUBLIC_APP_ENV=production \
    NEXT_PUBLIC_DEV_INBOX_ENABLED=false \
    NEXT_TELEMETRY_DISABLED=1
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @booking/shared && npm run build -w @booking/web

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd -r app && useradd -r -g app -d /app -s /usr/sbin/nologin app
# Корень трассировки standalone — корень монорепозитория (package-lock.json): server.js лежит в apps/web/.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# статические файлы (скриншоты и иллюстрации главной страницы)
COPY --from=build /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
