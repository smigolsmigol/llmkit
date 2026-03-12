#!/bin/bash
# Sync local context to the remote server
# Run: bash scripts/sync-bot-context.sh
# Auto-runs via Claude Code hook on session end

SERVER="root@REDACTED_IP"
REMOTE="REDACTED_PATH/repo"
MEMORY_LOCAL="$HOME/.claude/projects/REDACTED_PATH/memory"

echo "Syncing .claude/ ..."
scp -r .claude/* "$SERVER:$REMOTE/.claude/" 2>/dev/null

echo "Syncing docs/ ..."
scp -r docs/* "$SERVER:$REMOTE/docs/" 2>/dev/null

echo "Syncing memory/ ..."
scp -r "$MEMORY_LOCAL/"* "$SERVER:$REMOTE/memory/" 2>/dev/null

echo "Restarting bot..."
ssh "$SERVER" "systemctl restart llmkit-bot" 2>/dev/null

echo "Done. Bot context updated."
