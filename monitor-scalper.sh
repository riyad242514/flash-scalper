#!/bin/bash
# Monitor scalper logs with pretty formatting using pino-pretty

LOG_FILE="${1:-/tmp/scalper-monitor.log}"

echo "📊 Monitoring scalper logs: $LOG_FILE"
echo "Press Ctrl+C to stop"
echo ""

# Use npx to run pino-pretty (works even if not globally installed)
tail -f "$LOG_FILE" | npx -y pino-pretty --colorize --translateTime 'SYS:standard' --ignore 'pid,hostname' --singleLine false
