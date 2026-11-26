FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Operations image (OPS-005): migrations and background workers. Keeps dev tooling (node-pg-migrate, ts-node)
# out of the API runtime image. Default command applies migrations; workers override the command:
#   npm run db:migrate | npm run holds:expire | npm run outbox:work
FROM build AS tools
ENV NODE_ENV=production
COPY migrations ./migrations
COPY scripts ./scripts
CMD ["npm", "run", "db:migrate"]

# API runtime image (default target): compiled app and production dependencies only.
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
