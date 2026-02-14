#!/bin/bash
# Backup script for MIT Trading System
# Usage: ./scripts/backup.sh

set -e

DATA_DIR="${DATA_DIR:-./data}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

echo "[Backup] Starting backup at $TIMESTAMP"

# Backup MIT state
if [ -f "$DATA_DIR/mit-state.json" ]; then
  cp "$DATA_DIR/mit-state.json" "$BACKUP_DIR/mit-state_$TIMESTAMP.json"
  echo "[Backup] Backed up mit-state.json"
fi

# Backup main state
if [ -f "$DATA_DIR/state.json" ]; then
  cp "$DATA_DIR/state.json" "$BACKUP_DIR/state_$TIMESTAMP.json"
  echo "[Backup] Backed up state.json"
fi

# Backup config
if [ -d "$DATA_DIR" ]; then
  tar -czf "$BACKUP_DIR/config_$TIMESTAMP.tar.gz" -C "$DATA_DIR" . 2>/dev/null || true
  echo "[Backup] Backed up config files"
fi

# Keep only last 30 backups
cd "$BACKUP_DIR"
ls -t mit-state_*.json 2>/dev/null | tail -n +31 | xargs -r rm
ls -t state_*.json 2>/dev/null | tail -n +31 | xargs -r rm
ls -t config_*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm

echo "[Backup] Completed. Backups in $BACKUP_DIR"
