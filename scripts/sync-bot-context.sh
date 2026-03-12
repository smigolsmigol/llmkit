#!/bin/bash
# Sync local context to the Hetzner bot server
# Run: bash scripts/sync-bot-context.sh
# Auto-runs via Claude Code hook on session end

SERVER="root@178.104.44.145"
REMOTE="/opt/llmkit-bot/repo"
MEMORY_LOCAL="$HOME/.claude/projects/C--f3d1-Weed-lando/memory"

echo "Syncing .claude/ ..."
scp -r .claude/* "$SERVER:$REMOTE/.claude/" 2>/dev/null

echo "Syncing docs/ ..."
scp -r docs/* "$SERVER:$REMOTE/docs/" 2>/dev/null

echo "Syncing memory/ ..."
scp -r "$MEMORY_LOCAL/"* "$SERVER:$REMOTE/memory/" 2>/dev/null

echo "Restarting bot..."
ssh "$SERVER" "systemctl restart llmkit-bot" 2>/dev/null

echo "Done. Bot context updated."
