# 附件服務映像檔(file-api,port 51272;機密一律以 *_FILE 指向 Docker secret,不寫進映像檔)
#   docker build --secret id=npm_token,env=GITLAB_NPM_TOKEN file-api
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# @giganexus/* 取自公司 GitLab npm Registry:Token 以 BuildKit secret(npm_token)傳入,不留在映像層
RUN --mount=type=secret,id=npm_token GITLAB_NPM_TOKEN="$(cat /run/secrets/npm_token)" npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=51272 FILE_ROOT=/data/files
WORKDIR /app
COPY --from=build /app/node_modules node_modules/
COPY --from=build /app/dist dist/
COPY package.json ./
# migration(node dist/src/migrate.js,以 file_migrate 執行;DATABASE.md §0.2)
COPY db/migrations/ db/migrations/
# 檔案根目錄由主機 /srv/giga-files/{env} bind mount(擁有者 uid 1000 = node)
RUN mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 51272
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:51272/healthz >/dev/null || exit 1
CMD ["node", "dist/src/server.js"]
