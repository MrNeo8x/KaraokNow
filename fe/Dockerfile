FROM node:26-alpine AS build
WORKDIR /app
ARG BACKEND_API_ORIGIN=http://backend:3000
ENV BACKEND_API_ORIGIN=$BACKEND_API_ORIGIN
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3100
CMD ["npm", "run", "start"]
