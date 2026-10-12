FROM node:22-alpine
ENV NODE_ENV=production TZ=Asia/Tokyo DB_FILE=/data/groupware.db PORT=3000
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json server.mjs ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.mjs"]
