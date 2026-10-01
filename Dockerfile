FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY server.js package.json ./
VOLUME /data
EXPOSE 3210
ENV PAINEL_PASSWORD=L3g@cy
ENV TZ=America/Fortaleza
CMD ["node", "server.js"]
