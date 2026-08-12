#!/usr/bin/env bash
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
STATE_DIR="$HOME/.t3/swiftui-stream"
LIBEXEC="$HOME/.local/libexec/t3-swiftui-stream"
LOG_DIR="$HOME/Library/Logs/t3-swiftui-stream"
PLIST="$HOME/Library/LaunchAgents/com.saphid.t3-swiftui-drift-monitor.plist"
mkdir -p "$STATE_DIR" "$LIBEXEC" "$LOG_DIR" "$(dirname "$PLIST")"
install -m 755 "$REPO/scripts/swiftui-stream/drift-monitor.sh" "$LIBEXEC/drift-monitor.sh"

TMP="$(mktemp "$STATE_DIR/drift-monitor.XXXXXX")"
cat > "$TMP" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.saphid.t3-swiftui-drift-monitor</string>
<key>ProgramArguments</key><array><string>$LIBEXEC/drift-monitor.sh</string></array>
<key>EnvironmentVariables</key><dict><key>SWIFTUI_STREAM_REPO</key><string>$REPO</string></dict>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>7200</integer>
<key>StandardOutPath</key><string>$LOG_DIR/drift-monitor.log</string>
<key>StandardErrorPath</key><string>$LOG_DIR/drift-monitor.error.log</string>
<key>ProcessType</key><string>Background</string>
</dict></plist>
PLIST
plutil -lint "$TMP"
mv "$TMP" "$PLIST"
launchctl bootout "gui/$(id -u)/com.saphid.t3-swiftui-drift-monitor" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.saphid.t3-swiftui-drift-monitor"
echo "configured $PLIST"
