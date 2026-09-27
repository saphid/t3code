#!/bin/zsh
# Copy the app's activity log (Settings > Diagnostics > Activity log) to stdout.
#   pull-activity-log.sh device <devicectl-device-id> [bundle-id]
#   pull-activity-log.sh sim <simulator-udid> [bundle-id]
# Physical devices need only normal developer pairing; the app must be a
# development-signed build.
set -eu
mode=$1
target=$2
bundle=${3:-com.t3tools.t3code.swiftui.dev}
dir="Library/Application Support/Diagnostics"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
case $mode in
  device)
    for name in events.1.log events.log; do
      xcrun devicectl device copy from --device "$target" --domain-type appDataContainer \
        --domain-identifier "$bundle" --source "$dir/$name" --destination "$tmp/$name" \
        >/dev/null 2>&1 || true
    done
    ;;
  sim)
    container=$(xcrun simctl get_app_container "$target" "$bundle" data)
    cp "$container/$dir/"events*.log "$tmp/" 2>/dev/null || true
    ;;
  *)
    echo "usage: $0 device|sim <id> [bundle-id]" >&2
    exit 2
    ;;
esac
cat "$tmp/events.1.log" "$tmp/events.log" 2>/dev/null
