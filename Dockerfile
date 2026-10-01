FROM node:20-alpine AS build
RUN apk add python3 make g++ --no-cache
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
FROM node:20-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY server.js package.json ./
VOLUME /data
EXPOSE 3210
ENV PAINEL_PASSWORD=L3g@cy
ENV TZ=America/Fortaleza
CMD ["node", "server.js"]
