#!/usr/bin/env bash
# Build the Docker image and export it as a portable tar file.
# The resulting limp.tar can be copied to a thumbdrive and loaded on
# any machine that has Docker installed, no internet required.
#
# Usage:
#   ./export-docker.sh          # builds and exports to ./limp.tar
#
# On the target machine:
#   docker load < limp.tar
#   docker run -d -p 8080:8080 -v ./data:/app/data limp:latest

set -euo pipefail

IMAGE="limp:latest"
OUTPUT="limp.tar"

echo "==> Building Docker image (offline-ready, all deps baked in)..."
docker build -t "$IMAGE" .

echo "==> Exporting image to $OUTPUT..."
docker save -o "$OUTPUT" "$IMAGE"

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo ""
echo "Done. $OUTPUT ($SIZE) is ready for distribution."
echo ""
echo "On the target machine, run:"
echo "  docker load < limp.tar"
echo "  docker run -d -p 8080:8080 -v ./data:/app/data limp:latest"
