#!/usr/bin/env python3
"""One-time graphical migration from the Alpha preview into Fork OV2."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys


APPLE_DIALOG = '''on run argv
set reply to display dialog (item 1 of argv) with title "T3 Code update" buttons {"Later", "Open current app"} default button "Open current app" with icon caution
return button returned of reply
end run'''
APPLE_ERROR = '''on run argv
display alert "T3 Code update" message (item 1 of argv) as warning
end run'''


def run(args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, text=True, **kwargs)


def notify(message):
    run(['/usr/bin/osascript', '-e', 'on run argv\ndisplay notification (item 1 of argv) with title "T3 Code update"\nend run', message], capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('setup', type=Path)
    parser.add_argument('--check', action='store_true', help='Read-only readiness check without dialogs or installation.')
    args = parser.parse_args()
    setup = args.setup.resolve()
    config = json.loads((setup / 'handoff.json').read_text())
    output = Path(config['build'])
    if args.check:
        return run([sys.executable, output / 'install.py', output, '--connection-migration', setup / 'connection-migration.json']).returncode
    with (setup / 'handoff.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        with (setup / 'handoff.log').open('a') as log:
            notify('Preparing Fork OV2. T3 will open when the update is finished. This may take a few minutes.')
            offset = log.tell()
            result = subprocess.run([sys.executable, output / 'install.py', output, '--install',
                '--shortcut-backup', config['originalShortcut'],
                '--connection-migration', str(setup / 'connection-migration.json')], text=True, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                log.flush()
                with (setup / 'handoff.log').open() as current_log:
                    current_log.seek(offset)
                    text = current_log.read()
                if 'turns are still active' in text or 'Quit the T3 desktop' in text:
                    reply = run(['/usr/bin/osascript', '-e', APPLE_DIALOG,
                        'The update is ready, but T3 is still open or some turns are active. Open the current app, finish or stop those turns, quit with Command-Q, then reopen T3 Code (V2 Preview).'], capture_output=True).stdout.strip()
                    if reply == 'Open current app':
                        run(['/usr/bin/open', '-a', config['previousApp'], '--env', 'T3CODE_HOME=' + config['desktopHome']])
                    return result.returncode
                run(['/usr/bin/osascript', '-e', APPLE_ERROR,
                    'The update stopped. Your backup and diagnostic log are retained. Please share this log with the agent: ' + str(setup / 'handoff.log')], capture_output=True)
                return result.returncode
            (setup / 'completed.json').write_text(json.dumps({'build': str(output), 'status': 'installed'}) + '\n')
            notify('Fork OV2 is installed. Future updates will appear in the app.')
            run(['/usr/bin/open', '-a', config['newApp'], '--env', 'T3CODE_HOME=' + config['desktopHome']])
            return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        subprocess.run(['/usr/bin/osascript', '-e', APPLE_ERROR, str(error)], capture_output=True)
        sys.exit(1)
