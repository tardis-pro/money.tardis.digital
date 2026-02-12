# Multi-stage build for Node.js/Bun + Python server
# Stage 1: Python environment with TA-Lib and dependencies
FROM python:3.11-slim AS python-base

# Install build dependencies for TA-Lib and other packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    curl \
    git \
    libxml2-dev \
    libxslt1-dev \
    libjpeg-dev \
    zlib1g-dev \
    libpng-dev \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Build and install TA-Lib C library
RUN cd /tmp && \
    wget http://prdownloads.sourceforge.net/ta-lib/ta-lib-0.4.0-src.tar.gz && \
    tar -xzf ta-lib-0.4.0-src.tar.gz && \
    cd ta-lib && \
    ./configure --prefix=/usr && \
    make && \
    make install && \
    cd / && \
    rm -rf /tmp/ta-lib*

# Stage 2: Final image with Bun + Python
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libxml2 \
    libxslt1.1 \
    libjpeg62-turbo \
    zlib1g \
    libpng16-16 \
    libffi8 \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Copy TA-Lib from python-base
COPY --from=python-base /usr/lib/libta_lib.* /usr/lib/
COPY --from=python-base /usr/include/ta-lib/ /usr/include/ta-lib/
COPY --from=python-base /usr/lib/pkgconfig/ta-lib.pc /usr/lib/pkgconfig/

# Install Python and pip
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

# Set working directory
WORKDIR /app

# Copy Python requirements first for better caching
COPY requirements.txt ./

# Install Python dependencies
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Copy package files for Bun
COPY package.json bun.lock* ./

# Install Node.js dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Environment defaults
ENV NODE_ENV=production
ENV STORE_BACKEND=postgres
ENV DATABASE_URL=postgres://postgres:postgres@timescaledb:5432/policy_signal
ENV PORT=3000
ENV SCREENIPY_PYTHON=python3
ENV SCREENIPY_SCRIPT_PATH=/app/src/screenipy.py

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Run the server
CMD ["bun", "run", "dev:server"]
