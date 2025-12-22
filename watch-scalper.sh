#!/bin/bash
# Watch scalper status and key metrics

while true; do
    clear
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║     ZAARA SCALPER - STATUS MONITOR                           ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Check if running
    PID=$(ps aux | grep -E "scalper-strategy" | grep -v grep | awk '{print $2}')
    if [ -z "$PID" ]; then
        echo "❌ Scalper is NOT running"
    else
        echo "✅ Scalper running (PID: $PID)"
        echo ""
        echo "📈 Recent Activity (last 20 lines):"
        echo "────────────────────────────────────────────────────────────"
        tail -20 /tmp/scalper-output.log 2>/dev/null | grep -E "(SIGNAL|OPEN|CLOSE|Tick|Position|ERROR)" || echo "   Waiting for activity..."
    fi
    
    echo ""
    echo "⏱️  Refreshing in 5 seconds... (Ctrl+C to exit)"
    sleep 5
done
