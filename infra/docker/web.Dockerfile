# Frontend (Next.js standalone). Сборка из корня репозитория:
#   docker build -f infra/docker/web.Dockerfile -t booking-web .
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @booking/web --workspace @booking/shared --include-workspace-root --no-audit --no-fund

FROM deps AS build
ARG NEXT_PUBLIC_2GIS_KEY=""
ENV NEXT_PUBLIC_2GIS_KEY=$NEXT_PUBLIC_2GIS_KEY NEXT_TELEMETRY_DISABLED=1
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @booking/shared && npm run build -w @booking/web

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# статические файлы (скриншоты и иллюстрации главной страницы)
COPY --from=build /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
