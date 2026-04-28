# ── Stage 1: Build Go scraper binary for Linux ───────────────────────────────
FROM golang:1.24-alpine AS go-builder

WORKDIR /build
COPY academia-scraper/ .

RUN go build -o loginprobe ./cmd/loginprobe

# ── Stage 2: Node.js production image ────────────────────────────────────────
FROM node:20-alpine

# Chromium/headless deps are NOT needed — Go scraper handles all HTTP natively.
# Install ca-certificates so Go binary can validate TLS.
RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy server source
COPY server.js .
COPY backend/ ./backend/

# Place compiled Go binary where go_scraper_client.js expects it
COPY --from=go-builder /build/loginprobe ./academia-scraper/loginprobe
RUN chmod +x ./academia-scraper/loginprobe

# Port exposed by the Express server (Railway sets $PORT automatically)
EXPOSE 3000

# Run without --env-file; Railway injects env vars directly
CMD ["node", "server.js"]
