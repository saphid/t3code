#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE_ID="${T3_SWIFT_DEVICE_ID:-${1:-}}"
[[ -n "$DEVICE_ID" ]] || { echo "set T3_SWIFT_DEVICE_ID" >&2; exit 1; }

STATE_DIR="$HOME/.t3/swiftui-stream"
LIBEXEC="$HOME/.local/libexec/t3-swiftui-stream"
LOG_DIR="$HOME/Library/Logs/t3-swiftui-stream"
PLIST="$HOME/Library/LaunchAgents/com.saphid.t3-swiftui-phone-watch.plist"
mkdir -p "$STATE_DIR" "$LIBEXEC" "$LOG_DIR" "$(dirname "$PLIST")"
install -m 755 "$SCRIPT_DIR/phone-watch.py" "$LIBEXEC/phone-watch.py"

CONFIG_TMP="$(mktemp "$STATE_DIR/watcher-config.XXXXXX")"
jq -n \
  --arg deviceId "$DEVICE_ID" \
  --arg discordCommand "/Users/saphid/bin/hermes-discord" \
  --arg discordHost "lxso1" \
  --arg discordChannel "agent-ops" \
  --arg trackingIssue "https://github.com/saphid/t3code-personal/issues/53" \
  '{schemaVersion:1,deviceId:$deviceId,discordCommand:$discordCommand,discordHost:$discordHost,discordChannel:$discordChannel,trackingIssue:$trackingIssue}' \
  > "$CONFIG_TMP"
mv "$CONFIG_TMP" "$STATE_DIR/watcher-config.json"

PLIST_TMP="$(mktemp "$STATE_DIR/phone-watch.XXXXXX")"
cat > "$PLIST_TMP" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.saphid.t3-swiftui-phone-watch</string>
<key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>$LIBEXEC/phone-watch.py</string></array>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>60</integer>
<key>StandardOutPath</key><string>$LOG_DIR/phone-watch.log</string>
<key>StandardErrorPath</key><string>$LOG_DIR/phone-watch.error.log</string>
<key>ProcessType</key><string>Background</string>
</dict></plist>
PLIST
plutil -lint "$PLIST_TMP"
mv "$PLIST_TMP" "$PLIST"
launchctl bootout "gui/$(id -u)/com.saphid.t3-swiftui-phone-watch" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.saphid.t3-swiftui-phone-watch"
echo "configured $PLIST"
