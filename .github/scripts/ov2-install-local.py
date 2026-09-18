#!/usr/bin/env python3
"""Install a ready local OV2 build on Alex's Mac. Default is a read-only preview."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request


def run(args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, text=True, **kwargs)


def active_runs(database):
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
        return db.execute("select count(*) from orchestration_v2_projection_runs where status in ('queued','preparing','starting','running','waiting')").fetchone()[0]


def backup_database(source, destination):
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src:
        with sqlite3.connect(destination) as dst:
            src.backup(dst)


def launcher_text(app, desktop_home, plist):
    q = shlex.quote
    return f'''#!/bin/sh
set -eu
unset ELECTRON_RUN_AS_NODE VITE_DEV_SERVER_URL T3CODE_PORT T3CODE_MODE T3CODE_HOST
service_target="gui/$(id -u)/com.t3tools.t3code.service"
if ! /bin/launchctl print "$service_target" >/dev/null 2>&1; then
  /bin/launchctl bootstrap "gui/$(id -u)" {q(str(plist))}
fi
/bin/launchctl kickstart "$service_target"
exec /usr/bin/open -a {q(str(app))} --env {q('T3CODE_HOME=' + str(desktop_home))}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('build', type=Path)
    parser.add_argument('--shortcut-backup', type=Path, help='Original Applications shortcut saved before staging a graphical handoff.')
    parser.add_argument('--install', action='store_true', help='Back up, install, and restart the live service. Run from macOS Terminal after all turns end.')
    args = parser.parse_args()
    output = args.build.resolve()
    info = json.loads((output / 'build.json').read_text())
    if info['status'] != 'ready':
        raise RuntimeError('Build has not passed its packaging checks.')
    home = Path.home()
    server_home = home / '.t3'
    desktop_home = home / '.t3-v2-desktop'
    database = server_home / 'userdata/statev2.sqlite'
    plist = home / 'Library/LaunchAgents/com.t3tools.t3code.service.plist'
    shortcut = Path('/Applications/T3 Code (V2 Preview).app')
    launcher = shortcut / 'Contents/MacOS/launch'
    cli_link = home / '.local/bin/t3'
    runtime = server_home / 'runtime/versions' / info['version']
    app = home / '.local/share/t3-v2-desktop/T3 Code (Fork Nightly).app'
    artifacts = output / 'artifacts'
    for line in (artifacts / 'SHA256SUMS').read_text().splitlines():
        expected, name = line.split('  ', 1)
        if Path(name).name != name:
            raise RuntimeError('Invalid checksum filename.')
        with (artifacts / name).open('rb') as artifact:
            digest = hashlib.file_digest(artifact, 'sha256').hexdigest()
        if digest != expected:
            raise RuntimeError(f'Checksum failed: {name}')
    old_plist = plistlib.loads(plist.read_bytes())
    if old_plist['Label'] != 'com.t3tools.t3code.service':
        raise RuntimeError('Unexpected service label. No changes made.')
    if str(server_home) not in old_plist['ProgramArguments']:
        # Newer service launchers use their state file to locate the same home.
        if old_plist.get('EnvironmentVariables', {}).get('T3CODE_HOME') != str(server_home):
            raise RuntimeError('Unexpected service configuration. No changes made.')
    if not launcher.is_file() or not cli_link.is_symlink():
        raise RuntimeError('Expected V2 shortcut and CLI symlink are missing. No changes made.')
    with urllib.request.urlopen('http://127.0.0.1:3773/.well-known/t3/environment', timeout=5) as response:
        previous = json.load(response)
    count = active_runs(database)
    print(f"Build: {info['version']}\nUpstream: {info['upstream']}\nActive turns: {count}\nDesktop: {app}\nServer: {runtime}\nShortcut: {shortcut}", flush=True)
    if not args.install:
        print('Preview only. Nothing changed. Use --install from macOS Terminal after all turns end and the desktop is quit.')
        return
    if count:
        raise RuntimeError(f'{count} turns are still active. Finish or stop them in T3, then rerun. Nothing changed.')
    processes = run(['ps', '-axo', 'command='], capture_output=True).stdout
    if '/T3 Code (Alpha).app/Contents/MacOS/' in processes or '/T3 Code (Fork Nightly).app/Contents/MacOS/' in processes:
        raise RuntimeError('Quit the T3 desktop with Command-Q before installing. Nothing changed.')
    if runtime.exists() or app.exists():
        raise RuntimeError('This runtime or desktop is already installed. Preserve it before replacing it.')
    stamp = time.strftime('%Y%m%d-%H%M%S')
    backup = home / '.local/share/t3-ov2-backups' / stamp
    db_size = sum(p.stat().st_size for p in (server_home / 'userdata').glob('*.sqlite'))
    if shutil.disk_usage(home).free < db_size + 4 * 1024**3:
        raise RuntimeError('Not enough free space for the database backup and installation.')
    backup.mkdir(parents=True, mode=0o700)
    print(f'Backing up to {backup}', flush=True)
    shutil.copy2(plist, backup / 'service.plist')
    shutil.copytree(args.shortcut_backup or shortcut, backup / shortcut.name, symlinks=True)
    (backup / 'cli-link.txt').write_text(os.readlink(cli_link))
    runtime_files = {}
    for path in (server_home / 'runtime').glob('*.json'):
        shutil.copy2(path, backup / path.name)
        runtime_files[path.name] = str(path)
    for path in (server_home / 'userdata').glob('*.sqlite'):
        backup_database(path, backup / path.name)
    if active_runs(database):
        raise RuntimeError('A turn started during backup. Backup retained; service left running.')
    # Extract only verified artifacts. The server's normal installer recognizes this sentinel.
    runtime.mkdir(parents=True)
    run(['tar', '-xzf', artifacts / f"t3-{info['version']}-darwin-arm64.tar.gz", '-C', runtime, '--strip-components=1'])
    reported = run([runtime / 't3', '--version'], capture_output=True).stdout.strip()
    if info['version'] not in reported:
        raise RuntimeError(f'Unexpected server version: {reported}')
    (runtime / '.install-complete').write_text(info['version'] + '\n')
    run(['ditto', output / 'desktop/T3 Code (Fork Nightly).app', app])
    run(['codesign', '--verify', '--deep', '--strict', app])
    # Recheck directly before the intentional service handoff. Never wait on this thread itself.
    if active_runs(database):
        raise RuntimeError('A turn started during staging. Service left running; staged files retained.')
    result = {'backup': str(backup), 'version': info['version'], 'runtimeFiles': runtime_files, 'previousEnvironment': previous, 'stage': 'staged'}
    (backup / 'install.json').write_text(json.dumps(result, indent=2) + '\n')
    env = {**os.environ, 'T3CODE_HOME': str(server_home)}
    run([runtime / 't3', 'service', 'install', '--base-dir', server_home], env=env)
    replacement = cli_link.with_name('t3.ov2-new')
    replacement.symlink_to(runtime / 't3')
    replacement.replace(cli_link)
    launcher.write_text(launcher_text(app, desktop_home, plist))
    launcher.chmod(0o755)
    run(['codesign', '--force', '--sign', '-', shortcut])
    result['stage'] = 'installed'
    (backup / 'install.json').write_text(json.dumps(result, indent=2) + '\n')
    # Local health readiness, bounded to one minute.
    deadline = time.monotonic() + 60
    while True:
        try:
            with urllib.request.urlopen('http://127.0.0.1:3773/.well-known/t3/environment', timeout=3) as response:
                descriptor = json.load(response)
            if descriptor.get('serverVersion') == info['version'] and descriptor.get('environmentId') == previous.get('environmentId'):
                break
        except (OSError, ValueError):
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError(f'New server did not become ready. Backup and rollback instructions: {backup}')
        time.sleep(1)
    result['stage'] = 'verified'
    (backup / 'install.json').write_text(json.dumps(result, indent=2) + '\n')
    print(f'Installed and verified. Open {shortcut.name}. Backup: {backup}')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Installation stopped: {error}', file=sys.stderr)
        sys.exit(1)
