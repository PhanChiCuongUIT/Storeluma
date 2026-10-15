FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY services ./services
USER node
ARG SERVICE
ENV SERVICE_NAME=$SERVICE
CMD ["sh", "-c", "node dist/services/$SERVICE_NAME/main.js"]
