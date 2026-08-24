#!/bin/bash
# Install or update the reproducible T3 perf worker. Run from this package.
set -euo pipefail

contract="t3perf-v1-node24-playwright1.60"
scheduler=""
otlp=""
token_source=""
enable=0
uninstall=0
purge_data=0
build_image=1

usage() {
  echo "usage: $0 --scheduler URL --otlp URL --token-file PATH [--enable] [--no-build]"
  echo "       $0 --uninstall [--purge-data]"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --scheduler) scheduler="$2"; shift 2 ;;
    --otlp) otlp="$2"; shift 2 ;;
    --token-file) token_source="$2"; shift 2 ;;
    --enable) enable=1; shift ;;
    --uninstall) uninstall=1; shift ;;
    --purge-data) purge_data=1; shift ;;
    --no-build) build_image=0; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

package_dir="$(cd "$(dirname "$0")/.." && pwd)"
os="$(uname -s)"

if [ "$os" = Linux ]; then
  install_dir=/opt/t3-perf-worker
  config_dir=/etc/t3-perf-worker
  data_dir=/var/lib/t3-perf-worker
  unit=/etc/systemd/system/t3-perf-worker.service
  if [ "$uninstall" -eq 1 ]; then
    sudo systemctl disable --now t3-perf-worker.service 2>/dev/null || true
    sudo rm -f "$unit"
    sudo rm -rf "$install_dir" "$config_dir"
    if [ "$purge_data" -eq 1 ]; then sudo rm -rf "$data_dir"; fi
    sudo systemctl daemon-reload
    echo "worker uninstalled; legacy and unrelated data were not touched"
    exit 0
  fi
  [ -n "$scheduler" ] && [ -n "$otlp" ] && [ -f "$token_source" ] || { usage >&2; exit 2; }
  command -v docker >/dev/null
  command -v python3 >/dev/null
  if [ "$build_image" -eq 1 ]; then
    docker build --pull -f "$package_dir/docker/Dockerfile" -t "t3-perf-worker:$contract" "$package_dir"
  fi
  sudo install -d -m 0755 "$install_dir" "$config_dir"
  sudo install -d -m 0750 -o saphid -g docker "$data_dir"
  sudo install -d -m 0750 -o saphid -g docker "$data_dir/docker-config"
  sudo install -m 0755 "$package_dir/scripts/fleet-worker.py" "$install_dir/fleet-worker.py"
  sudo install -m 0640 -o root -g docker "$token_source" "$config_dir/token"
  sudo tee "$config_dir/worker.env" >/dev/null <<EOF
T3_PERF_SCHEDULER=$scheduler
T3_PERF_OTLP=$otlp
T3_PERF_CONTRACT=$contract
T3_PERF_IMAGE=t3-perf-worker:$contract
EOF
  sudo chmod 0644 "$config_dir/worker.env"
  sudo tee "$unit" >/dev/null <<'EOF'
[Unit]
Description=T3 nightly performance worker
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=saphid
Group=docker
EnvironmentFile=/etc/t3-perf-worker/worker.env
Environment=DOCKER_CONFIG=/var/lib/t3-perf-worker/docker-config
ExecStart=/usr/bin/python3 /opt/t3-perf-worker/fleet-worker.py --scheduler ${T3_PERF_SCHEDULER} --token-file /etc/t3-perf-worker/token --data-dir /var/lib/t3-perf-worker --image ${T3_PERF_IMAGE} --contract ${T3_PERF_CONTRACT} --otlp ${T3_PERF_OTLP}
Restart=always
RestartSec=30
Nice=10
CPUWeight=20
IOWeight=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/t3-perf-worker

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  if [ "$enable" -eq 1 ]; then sudo systemctl enable --now t3-perf-worker.service; fi
  echo "installed Linux worker contract=$contract enabled=$enable"
elif [ "$os" = Darwin ]; then
  install_dir="$HOME/.local/share/t3-perf-worker"
  config_dir="$HOME/.config/t3-perf-worker"
  data_dir="$HOME/.local/state/t3-perf-worker"
  plist="$HOME/Library/LaunchAgents/dev.t3play.perf-worker.plist"
  if [ "$uninstall" -eq 1 ]; then
    launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
    rm -f "$plist"
    rm -rf "$install_dir" "$config_dir"
    if [ "$purge_data" -eq 1 ]; then rm -rf "$data_dir"; fi
    echo "worker uninstalled; existing perf batch directories were not touched"
    exit 0
  fi
  [ -n "$scheduler" ] && [ -n "$otlp" ] && [ -f "$token_source" ] || { usage >&2; exit 2; }
  command -v docker >/dev/null
  command -v python3 >/dev/null
  if [ "$build_image" -eq 1 ]; then
    docker build --pull -f "$package_dir/docker/Dockerfile" -t "t3-perf-worker:$contract" "$package_dir"
  fi
  install -d -m 0755 "$install_dir" "$config_dir" "$data_dir" "$HOME/Library/LaunchAgents"
  install -m 0755 "$package_dir/scripts/fleet-worker.py" "$install_dir/fleet-worker.py"
  install -m 0600 "$token_source" "$config_dir/token"
  /usr/bin/python3 - "$plist" "$install_dir" "$config_dir" "$data_dir" "$scheduler" "$otlp" "$contract" <<'PY'
import pathlib, plistlib, sys
plist, install_dir, config_dir, data_dir, scheduler, otlp, contract = sys.argv[1:]
value = {
    "Label": "dev.t3play.perf-worker",
    "ProgramArguments": ["/usr/bin/python3", f"{install_dir}/fleet-worker.py", "--scheduler", scheduler,
        "--token-file", f"{config_dir}/token", "--data-dir", data_dir, "--image",
        f"t3-perf-worker:{contract}", "--contract", contract, "--otlp", otlp],
    "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 30,
    "LowPriorityIO": True, "ProcessType": "Background",
    "StandardOutPath": f"{data_dir}/worker.log", "StandardErrorPath": f"{data_dir}/worker.err.log",
}
pathlib.Path(plist).write_bytes(plistlib.dumps(value))
PY
  plutil -lint "$plist" >/dev/null
  if [ "$enable" -eq 1 ]; then launchctl bootstrap "gui/$(id -u)" "$plist"; fi
  echo "installed macOS worker contract=$contract enabled=$enable"
else
  echo "unsupported OS: $os" >&2
  exit 1
fi
