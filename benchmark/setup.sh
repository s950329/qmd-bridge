#!/usr/bin/env bash
# benchmark/setup.sh
# Sets up the full benchmark environment:
#   1. Verifies test data exists
#   2. Builds Docker image with qmd
#   3. Starts Docker container and builds collection + embeddings
#   4. Registers qmd-bridge tenant for the benchmark collection
#   5. Starts qmd-bridge
set -euo pipefail

DOCS_PATH="/tmp/qmd-benchmark/docs"
COLLECTION="benchmark"
CONTAINER="qmd-benchmark"
IMAGE="qmd-benchmark:latest"
BRIDGE_CLI="node $(dirname "$0")/../bin/cli.js"
MODEL_CACHE="$HOME/.cache/qmd/models"

echo "╔══════════════════════════════════════╗"
echo "║   qmd-bridge Benchmark Setup         ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── Step 1: Verify docs ───────────────────────────────────────────────────────
echo "▶ Step 1: Verify test data..."
if [ ! -d "$DOCS_PATH" ] || [ "$(ls "$DOCS_PATH"/*.md 2>/dev/null | wc -l)" -lt 20 ]; then
  echo "  ✗ Test docs not found at $DOCS_PATH"
  echo "    Run this from the repo root: node benchmark/create-data.js"
  exit 1
fi
echo "  ✓ Found $(ls "$DOCS_PATH"/*.md | wc -l | tr -d ' ') markdown files"

# ─── Step 2: Mac collection ────────────────────────────────────────────────────
echo ""
echo "▶ Step 2: Check Mac qmd collection..."
if qmd collection list 2>/dev/null | grep -q "^$COLLECTION"; then
  echo "  ✓ Collection '$COLLECTION' already exists"
else
  echo "  Creating collection '$COLLECTION'..."
  qmd collection add "$DOCS_PATH" --name "$COLLECTION"
fi

# Ensure embeddings exist
echo "  Checking embeddings..."
STATUS=$(qmd status 2>/dev/null)
if echo "$STATUS" | grep -q "Vectors:  20"; then
  echo "  ✓ Embeddings already generated"
else
  echo "  Generating embeddings (this downloads ~330MB model on first run)..."
  qmd embed
fi

# ─── Step 3: Docker image ──────────────────────────────────────────────────────
echo ""
echo "▶ Step 3: Build Docker image ($IMAGE)..."
if docker image inspect "$IMAGE" &>/dev/null; then
  echo "  ✓ Image already exists (delete with: docker rmi $IMAGE)"
else
  echo "  Building... (first build downloads npm packages, may take a few minutes)"
  docker build -t "$IMAGE" "$(dirname "$0")"
  echo "  ✓ Image built"
fi

# ─── Step 4: Start Docker container ───────────────────────────────────────────
echo ""
echo "▶ Step 4: Start Docker container..."
if docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q "true"; then
  echo "  ✓ Container already running"
else
  docker rm -f "$CONTAINER" 2>/dev/null || true
  docker run -d \
    --name "$CONTAINER" \
    --add-host host.docker.internal:host-gateway \
    -v "$DOCS_PATH:/workspace/docs:ro" \
    -v "$MODEL_CACHE:/root/.cache/qmd/models:ro" \
    "$IMAGE"
  echo "  ✓ Container started"
fi

# ─── Step 5: Docker qmd collection ────────────────────────────────────────────
echo ""
echo "▶ Step 5: Build Docker qmd collection..."
DOCKER_STATUS=$(docker exec "$CONTAINER" qmd collection list 2>/dev/null || echo "")
if echo "$DOCKER_STATUS" | grep -q "$COLLECTION"; then
  echo "  ✓ Docker collection '$COLLECTION' already exists"
else
  echo "  Creating collection inside container..."
  docker exec "$CONTAINER" qmd collection add /workspace/docs --name "$COLLECTION"
fi

echo "  Generating Docker embeddings (shares model cache from Mac)..."
docker exec "$CONTAINER" qmd embed
echo "  ✓ Docker embeddings done"

# ─── Step 6: qmd-bridge tenant ────────────────────────────────────────────────
echo ""
echo "▶ Step 6: Register qmd-bridge tenant..."
BRIDGE_LIST=$($BRIDGE_CLI list 2>/dev/null || echo "")
if echo "$BRIDGE_LIST" | grep -q "$COLLECTION"; then
  echo "  ✓ Tenant '$COLLECTION' already registered"
else
  echo "  Adding tenant '$COLLECTION' to qmd-bridge..."
  # Use non-interactive mode by providing all options
  node "$(dirname "$0")/../bin/cli.js" add \
    --label "$COLLECTION" \
    --name "Benchmark Collection" \
    --path "$DOCS_PATH" \
    --collection "$COLLECTION" \
    --no-index 2>/dev/null || {
    echo ""
    echo "  Note: qmd-bridge add is interactive. Run manually:"
    echo "    node bin/cli.js add"
    echo "    Label: benchmark"
    echo "    Name: Benchmark Collection"
    echo "    Path: $DOCS_PATH"
    echo "    Collection: benchmark"
    echo "    Auto-index: no"
    echo ""
  }
fi

# Show token
echo "  Bridge token:"
$BRIDGE_CLI token show "$COLLECTION" 2>/dev/null || echo "  (run: node bin/cli.js token show benchmark)"

# ─── Step 7: Start qmd-bridge ─────────────────────────────────────────────────
echo ""
echo "▶ Step 7: Start qmd-bridge..."
BRIDGE_STATUS=$($BRIDGE_CLI status 2>/dev/null || echo "")
if echo "$BRIDGE_STATUS" | grep -q "running"; then
  echo "  ✓ qmd-bridge already running"
else
  $BRIDGE_CLI start --host 0.0.0.0
  sleep 1
  echo "  ✓ qmd-bridge started"
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Setup complete! Run benchmark:     ║"
echo "║   node benchmark/benchmark.js        ║"
echo "╚══════════════════════════════════════╝"
