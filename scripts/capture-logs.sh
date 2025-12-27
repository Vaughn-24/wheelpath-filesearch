#!/bin/bash

# Quick script to capture logs while testing voice agent
# Usage: ./scripts/capture-logs.sh

echo "📝 Log Capture Script"
echo "===================="
echo ""
echo "This will capture logs from your backend terminal."
echo "Make sure your backend is running in another terminal."
echo ""
echo "Press Ctrl+C when done testing to stop capturing."
echo ""

# Create logs directory if it doesn't exist
mkdir -p logs

# Capture timestamp
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="logs/voice-test-${TIMESTAMP}.log"

echo "📁 Logs will be saved to: ${LOG_FILE}"
echo ""
echo "⚠️  Note: This script reads from stdin."
echo "   If your backend is already running, copy/paste logs here,"
echo "   or restart backend with: npm run dev:api 2>&1 | tee ${LOG_FILE}"
echo ""
echo "Starting capture (press Ctrl+D when done)..."
echo ""

# Read from stdin and save to file
cat > "${LOG_FILE}"

echo ""
echo "✅ Logs saved to: ${LOG_FILE}"
echo ""
echo "To analyze:"
echo "  npm run logs:extract -- --file ${LOG_FILE} --component VoiceGateway --output debug.md"
echo "  npm run logs:extract -- --file ${LOG_FILE} --errors --output errors.md"

