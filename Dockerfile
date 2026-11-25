FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
RUN npm run build

FROM build AS service-files
ARG SERVICE
RUN set -eu; test -f "dist/services/$SERVICE/main.js"; \
    mkdir -p "/runtime/dist/services" "/runtime/services/$SERVICE"; \
    cp -R "dist/services/$SERVICE" /runtime/dist/services/; \
    cp -R "services/$SERVICE/migrations" "/runtime/services/$SERVICE/"; \
    if [ "$SERVICE" = gateway ]; then mkdir -p /runtime/apps/web; cp -R apps/web/dist /runtime/apps/web/; fi

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist/packages ./dist/packages
COPY --from=service-files /runtime/ ./
USER node
ARG SERVICE
ENV SERVICE_NAME=$SERVICE
CMD ["sh", "-c", "exec node dist/services/$SERVICE_NAME/main.js"]
