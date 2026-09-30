# Image commune aux 4 apps : docker build --build-arg APP=auth-service .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install
ARG APP
RUN pnpm --filter "@hub/${APP}" build

FROM node:22-alpine AS run
ARG APP
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 APP=${APP}
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
# Pas de root dans le conteneur
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node apps/${APP}/server.js"]
