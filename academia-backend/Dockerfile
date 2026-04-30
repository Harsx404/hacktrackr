# ── Stage 1: Build Go binaries for Linux ─────────────────────────────────────
FROM golang:1.24-alpine AS go-builder

# Build academia scraper (loginprobe)
WORKDIR /build/academia
COPY academia-scraper/ .
RUN go build -o loginprobe ./cmd/loginprobe

# Build faculty scraper HTTP server
WORKDIR /build/faculty
COPY faculty-scraper/ .
RUN go build -o faculty-scraper .

# ── Stage 2: Node.js production image ────────────────────────────────────────
FROM node:20-alpine

# Install ca-certificates so Go binaries can validate TLS.
RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy server source
COPY server.js .
COPY backend/ ./backend/

# Place compiled Go binaries
COPY --from=go-builder /build/academia/loginprobe ./academia-scraper/loginprobe
COPY --from=go-builder /build/faculty/faculty-scraper ./faculty-scraper-bin
RUN chmod +x ./academia-scraper/loginprobe ./faculty-scraper-bin

# Start script runs both processes
COPY start.sh .
RUN chmod +x start.sh

# $PORT is injected by Render at runtime
EXPOSE 3000

CMD ["./start.sh"]
