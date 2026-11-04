# ================================================================
# SpecForge — backend image
# ================================================================
FROM node:18-alpine

# Non-root user (uid 1000 is default for `node` on node:* images)
WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi \
    && npm cache clean --force

# Copy application source
COPY src ./src

# Runtime defaults (can be overridden via docker-compose environment:)
ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

# Drop privileges
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://localhost:${PORT}/api/health" || exit 1

CMD ["node", "src/index.js"]