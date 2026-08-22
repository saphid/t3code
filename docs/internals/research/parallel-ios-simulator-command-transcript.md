# Parallel Simulator experiment command transcript

This is the secret-free command record for issue 136. It records the concrete
values and loops used on the test host; it is evidence, not a general runbook.
Aggregate results and exit statuses are in
[`parallel-ios-simulator-experiment-receipt.json`](parallel-ios-simulator-experiment-receipt.json).

```sh
repo=/Users/saphid/.t3/worktrees/t3code-swiftui-test-build-75/t3code-667fcef6
research_root=/Users/saphid/.local/state/t3/swiftui-delivery/research/136
udid_a=4401D856-DE6C-4769-A649-468778C929F6
udid_b=B0B16E05-D2DE-4243-B27B-6837D50FDFE6
app=/Users/saphid/.local/share/t3/swiftui-delivery/builds/6b3aaeab7e45a924f5f09831768c9a0819086b2eb97cd2cb2b6bc3c18191b25e/T3Code.app
bundle_id=com.t3tools.t3code.swiftui.dev
cd "$repo"

sysctl -n hw.ncpu hw.logicalcpu hw.memsize
memory_pressure -Q
df -k /private/tmp
ps -axo pid,rss,command

xcrun simctl boot "$udid_b"
xcrun simctl bootstatus "$udid_b" -b

scripts/swiftui-delivery/scripts/simulator-lane acquire \
  --lane-id research-a --simulator "$udid_a" \
  --receipt "$research_root/direct-flow-20/a/lease.json"
scripts/swiftui-delivery/scripts/simulator-lane acquire \
  --lane-id research-b --simulator "$udid_b" \
  --receipt "$research_root/direct-flow-20/b/lease.json"

# Run these two loops concurrently. The initial run used the same commands and
# retained its locator failures under direct-flow-20; the clean rerun wrote PNGs
# beneath direct-flow-20-clean.
for iteration in $(jot 20); do
  xcrun simctl install "$udid_a" "$app"
  xcrun simctl launch "$udid_a" "$bundle_id"
  scripts/swiftui-delivery/scripts/simulator-lane axe \
    --receipt "$research_root/direct-flow-20/a/lease.json" -- \
    swipe --start-x 200 --start-y 600 --end-x 200 --end-y 300 --duration 0.1
  scripts/swiftui-delivery/scripts/simulator-lane axe \
    --receipt "$research_root/direct-flow-20/a/lease.json" -- \
    screenshot --output "$research_root/direct-flow-20-clean/a/$iteration.png"
done

for iteration in $(jot 20); do
  xcrun simctl install "$udid_b" "$app"
  xcrun simctl launch "$udid_b" "$bundle_id"
  scripts/swiftui-delivery/scripts/simulator-lane axe \
    --receipt "$research_root/direct-flow-20/b/lease.json" -- \
    swipe --start-x 200 --start-y 600 --end-x 200 --end-y 300 --duration 0.1
  scripts/swiftui-delivery/scripts/simulator-lane axe \
    --receipt "$research_root/direct-flow-20/b/lease.json" -- \
    screenshot --output "$research_root/direct-flow-20-clean/b/$iteration.png"
done

# Serialized fallback: run lane a completely, then lane b.
for lane in a b; do
  if [ "$lane" = a ]; then udid=$udid_a; else udid=$udid_b; fi
  for iteration in $(jot 5); do
    xcrun simctl install "$udid" "$app"
    xcrun simctl launch "$udid" "$bundle_id"
    scripts/swiftui-delivery/scripts/simulator-lane axe \
      --receipt "$research_root/direct-flow-20/$lane/lease.json" -- \
      swipe --start-x 200 --start-y 600 --end-x 200 --end-y 300 --duration 0.1
    scripts/swiftui-delivery/scripts/simulator-lane axe \
      --receipt "$research_root/direct-flow-20/$lane/lease.json" -- \
      screenshot --output "$research_root/serialized-fallback-10/$lane/$iteration.png"
  done
done

# Snapshot stress: four batches; each batch starts five calls for A and five for
# B concurrently, for 40 total calls and 80 retained stdout/stderr files.
for batch in $(jot 4); do
  for index in $(jot 5); do
    number=$(((batch - 1) * 5 + index))
    npx --yes xcodebuildmcp@2.7.0 ui-automation snapshot-ui \
      --output json --simulator-id "$udid_a" \
      >"$research_root/xcb-2.7-stress/A-$number.json" \
      2>"$research_root/xcb-2.7-stress/A-$number.stderr" &
    npx --yes xcodebuildmcp@2.7.0 ui-automation snapshot-ui \
      --output json --simulator-id "$udid_b" \
      >"$research_root/xcb-2.7-stress/B-$number.json" \
      2>"$research_root/xcb-2.7-stress/B-$number.stderr" &
  done
  wait
done

# Persistent-driver candidate. Two copies of this command were started and
# addressed independently over stdio JSON-RPC.
npx --yes xcodebuildmcp@2.7.0 mcp --log-level error
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"lane-research","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"session_set_defaults","arguments":{"simulatorId":"4401D856-DE6C-4769-A649-468778C929F6","persist":false}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"session_show_defaults","arguments":{}}}
# The second process used client name lane-research-b and udid_b. Both captured
# processes were terminated with SIGINT after their defaults were read back.
npx --yes xcodebuildmcp@2.7.0 mcp --log-level error
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"lane-research-b","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"session_set_defaults","arguments":{"simulatorId":"B0B16E05-D2DE-4243-B27B-6837D50FDFE6","persist":false}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"session_show_defaults","arguments":{}}}

# Build isolation. These exact invocations ran simultaneously; their full
# command lines are also repeated by xcodebuild in the retained logs.
.agents/skills/ios-build-hygiene/scripts/run-xcodebuild-clean.sh -- \
  -project apps/swift-ios/T3Code.xcodeproj -scheme T3Code \
  -configuration Debug -destination "platform=iOS Simulator,id=$udid_a" \
  CODE_SIGNING_ALLOWED=NO build \
  >"$research_root/parallel-builds/build-a.log" 2>&1 &
pid_a=$!
.agents/skills/ios-build-hygiene/scripts/run-xcodebuild-clean.sh -- \
  -project apps/swift-ios/T3Code.xcodeproj -scheme T3Code \
  -configuration Debug -destination "platform=iOS Simulator,id=$udid_b" \
  CODE_SIGNING_ALLOWED=NO build \
  >"$research_root/parallel-builds/build-b.log" 2>&1 &
pid_b=$!
wait "$pid_a"
wait "$pid_b"

# 2.6.2 comparison: three explicit snapshots per UDID, all six concurrent.
for lane in A B; do
  if [ "$lane" = A ]; then udid=$udid_a; else udid=$udid_b; fi
  for index in $(jot 3); do
    npx --yes xcodebuildmcp@2.6.2 ui-automation snapshot-ui \
      --output json --simulator-id "$udid" \
      >"$research_root/explicit-targeting/xcb-$lane-$index.json" \
      2>"$research_root/explicit-targeting/xcb-$lane-$index.stderr" &
  done
done
wait

# Concurrent recording. Both commands started together and received SIGINT
# after roughly three seconds; their real CLI statuses and media durations are
# in the receipt.
npx --yes xcodebuildmcp@2.7.0 simulator record-video \
  --simulator-id "$udid_a" --fps 10 \
  --output-file "$research_root/xcb-2.7-video/A.mp4" \
  >"$research_root/xcb-2.7-video/A.stdout" \
  2>"$research_root/xcb-2.7-video/A.stderr" &
video_a=$!
npx --yes xcodebuildmcp@2.7.0 simulator record-video \
  --simulator-id "$udid_b" --fps 10 \
  --output-file "$research_root/xcb-2.7-video/B.mp4" \
  >"$research_root/xcb-2.7-video/B.stdout" \
  2>"$research_root/xcb-2.7-video/B.stderr" &
video_b=$!
sleep 3
kill -INT "$video_a" "$video_b"
wait "$video_a"
wait "$video_b"

# Multi-stream and failure isolation. The returned helper identities assigned
# ports 3320 and 3321; only the named A helper was stopped before B was checked.
npx --yes serve-sim@0.1.45 --detach --quiet --codec mjpeg -p 3320 \
  "$udid_a" "$udid_b"
curl --fail http://127.0.0.1:3320/stream.mjpeg -o /dev/null
curl --fail http://127.0.0.1:3321/stream.mjpeg -o /dev/null
npx --yes serve-sim@0.1.45 --kill "$udid_a"
curl --fail http://127.0.0.1:3321/stream.mjpeg -o /dev/null
npx --yes serve-sim@0.1.45 --kill "$udid_b"

# T3 preview used the product-native preview surface against the returned local
# serve-sim wrapper URL. preview_open loaded the page; preview_snapshot and
# preview_evaluate timed out on the canvas; preview_open(open:false) closed only
# the agent-created tab. The stream HTTP checks above remained green.

# Abandoned-lease CLI recovery, repeated after the lock-aware implementation.
scripts/swiftui-delivery/scripts/simulator-lane acquire \
  --lane-id recovery-smoke --simulator "$udid_b" \
  --receipt "$research_root/recovery-smoke/lost-receipt.json"
lease_hash=$(scripts/swiftui-delivery/scripts/simulator-lane inspect \
  --simulator "$udid_b" | jq -r .leaseSha256)
scripts/swiftui-delivery/scripts/simulator-lane recover \
  --simulator "$udid_b" --expected-lease-sha256 "$lease_hash" \
  --reason "The lock-aware smoke allocator deliberately lost release authority." \
  --receipt "$research_root/recovery-smoke/recovery.json"
scripts/swiftui-delivery/scripts/simulator-lane inspect --simulator "$udid_b"

scripts/swiftui-delivery/scripts/simulator-lane release \
  --receipt "$research_root/direct-flow-20/a/lease.json"
scripts/swiftui-delivery/scripts/simulator-lane release \
  --receipt "$research_root/direct-flow-20/b/lease.json"
xcrun simctl shutdown "$udid_b"
```

Artifact aggregates in the receipt are reproduced with:

```sh
find "$artifact_root" -type f -print0 | sort -z | \
  xargs -0 shasum -a 256 | shasum -a 256
```
