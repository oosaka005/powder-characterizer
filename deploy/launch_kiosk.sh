#!/bin/sh

if command -v chromium >/dev/null 2>&1; then
    browser="$(command -v chromium)"
elif command -v chromium-browser >/dev/null 2>&1; then
    browser="$(command -v chromium-browser)"
else
    exit 127
fi

exec "$browser" \
    --kiosk \
    --no-first-run \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    http://localhost:8000
