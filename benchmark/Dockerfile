FROM node:22-slim

# Install build tools for native modules (better-sqlite3, sqlite-vec)
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install qmd globally
RUN npm install -g @tobilu/qmd

# Verify
RUN qmd --version

WORKDIR /workspace

# Default: keep container alive for exec calls
CMD ["tail", "-f", "/dev/null"]
