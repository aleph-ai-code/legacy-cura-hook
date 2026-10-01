FROM node:20-alpine AS build
RUN apk add python3 make g++ --no-cache
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY server.js package.json ./
VOLUME /data
EXPOSE 3210
CMD ["node", "server.js"]
