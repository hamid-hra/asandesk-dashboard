FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY proto ./proto
COPY src ./src
USER node
EXPOSE 8200
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:8200/healthz >/dev/null || exit 1
# Node 24 فایل‌های TypeScript را مستقیم اجرا می‌کند (فقط نوع‌ها حذف می‌شوند؛ مرحلهٔ بیلد ندارد)
CMD ["node", "src/main.ts"]
