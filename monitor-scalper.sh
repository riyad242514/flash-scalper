#!/bin/bash
# Real-time scalper monitoring script
# Shows trades, positions, P&L, and profits

LOG_FILE="/tmp/scalper-run.log"
PID_FILE="/tmp/scalper.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "❌ Scalper not running (no PID file)"
  echo "   Start it with: npm run start:scalper"
  exit 1
fi

PID=$(cat "$PID_FILE")
if ! ps -p $PID > /dev/null 2>&1; then
  echo "❌ Scalper process not running (PID: $PID)"
  exit 1
fi

echo "🚀 Scalper Monitor - Real-time Trading Activity"
echo "================================================"
echo "📊 PID: $PID"
echo "📝 Log: $LOG_FILE"
echo ""
echo "Press Ctrl+C to stop monitoring (scalper keeps running)"
echo ""

# Monitor for key events
tail -f "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do
  # Highlight important events
  if echo "$line" | grep -qE "Executing.*ORDER|Position opened|Position closed"; then
    echo -e "\033[1;32m$line\033[0m"  # Green for trades
  elif echo "$line" | grep -qE "Tick.*Equity|Daily P&L"; then
    echo -e "\033[1;33m$line\033[0m"  # Yellow for status
  elif echo "$line" | grep -qE "ERROR|Failed"; then
    echo -e "\033[1;31m$line\033[0m"  # Red for errors
  elif echo "$line" | grep -qE "Signal.*LONG|Signal.*SHORT"; then
    echo -e "\033[1;36m$line\033[0m"  # Cyan for signals
  elif echo "$line" | grep -qE "Win rate|winningTrades"; then
    echo -e "\033[1;35m$line\033[0m"  # Magenta for stats
  else
    echo "$line"
  fi
done

