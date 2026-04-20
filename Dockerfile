# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
ARG NODE_AUTH_TOKEN
ENV NODE_AUTH_TOKEN=$NODE_AUTH_TOKEN
WORKDIR /app
COPY package.json package-lock.json* .npmrc ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
ARG NODE_AUTH_TOKEN
ENV NODE_AUTH_TOKEN=$NODE_AUTH_TOKEN
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 3009
CMD ["node", "dist/index.js"]
