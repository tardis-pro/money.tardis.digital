# Multi-stage build for Node.js/Bun + Python server
# Stage 1: Builder
FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
    wget \
    python3 \
    python3-pip \
    python3-dev \
    libxml2-dev \
    libxslt1-dev \
    libjpeg-dev \
    zlib1g-dev \
    libpng-dev \
    unzip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

WORKDIR /build

COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages \
    pandas numpy yfinance requests beautifulsoup4 lxml cloudscraper || true

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY . .
RUN bun run build

# Stage 2: Final runtime image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libxml2 \
    libxslt1.1 \
    libjpeg62-turbo \
    zlib1g \
    libpng16-16 \
    nodejs \
    npm \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages \
    pandas numpy yfinance requests beautifulsoup4 lxml cloudscraper || true

COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./
COPY --from=builder /build/index.html ./
COPY --from=builder /build/public ./public
COPY --from=builder /build/src/screenipy.py ./src/screenipy.py
COPY --from=builder /build/src/config ./src/config

RUN mkdir -p /app/data /app/logs

ENV NODE_ENV=production
ENV STORE_BACKEND=postgres
ENV DATABASE_URL=postgres://postgres:postgres@timescaledb:5432/policy_signal
ENV PORT=3000
ENV SCREENIPY_PYTHON=python3
ENV SCREENIPY_SCRIPT_PATH=/app/src/screenipy.py
ENV MIT_INTRADAY_REFRESH_SLOTS=10:00,12:30,14:45
ENV LOG_LEVEL=info

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

CMD ["node", "dist/src/server.js"]
