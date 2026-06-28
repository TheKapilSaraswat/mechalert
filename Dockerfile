FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM node:20-alpine AS backend-build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

# CACHEBUST: $(date)
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache wget && apk upgrade --no-cache libcrypto3 libssl3

COPY --from=frontend-build /app/dist ./frontend/dist
COPY --from=backend-build /app/node_modules ./node_modules
COPY backend/package*.json ./
COPY backend/src ./src

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

EXPOSE 3001

CMD ["node", "src/index.js"]
