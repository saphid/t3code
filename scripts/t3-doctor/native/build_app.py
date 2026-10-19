#!/usr/bin/env python3
"""Build and optionally install the native macOS T3 Doctor app."""
import argparse
from pathlib import Path
import plistlib
import json
import shutil
import subprocess
import sys


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--test', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    build = root / '.build'
    build.mkdir(exist_ok=True)
    flags = ['-swift-version', '6', '-parse-as-library', '-O', '-target', 'arm64-apple-macosx14.0']
    if args.test:
        run('xcrun', 'swiftc', *flags, root / 'DoctorModels.swift', root / 'ModelTests.swift', '-o', build / 'ModelTests')
        run(build / 'ModelTests', '--live')
    app = build / 'T3 Doctor.app'
    contents = app / 'Contents'
    binaries, resources = contents / 'MacOS', contents / 'Resources'
    binaries.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)
    run('xcrun', 'swiftc', *flags, root / 'DoctorModels.swift', root / 'DoctorApp.swift', root / 'HealthViews.swift', root / 'InvestigationViews.swift',
        '-o', binaries / 'T3Doctor', '-framework', 'SwiftUI', '-framework', 'AppKit')
    icon = build / 'Doctor.png'
    run('xcrun', 'swift', root / 'MakeIcon.swift', icon)
    iconset = build / 'Doctor.iconset'
    iconset.mkdir(exist_ok=True)
    for points in [16, 32, 128, 256, 512]:
        for scale in [1, 2]:
            pixels = points * scale
            name = f'icon_{points}x{points}' + ('@2x' if scale == 2 else '') + '.png'
            subprocess.run(['sips', '-z', str(pixels), str(pixels), str(icon), '--out', str(iconset / name)], check=True, stdout=subprocess.DEVNULL)
    run('iconutil', '-c', 'icns', iconset, '-o', resources / 'Doctor.icns')
    for name in ['investigate.py', 'doctor.py', 'health_checks.py', 'storage.py', 'incident_tracking.py', 'related_incidents.py']:
        shutil.copy2(root.parent / name, resources / name)
    investigation_config = dict(project_id='bc15f253-9156-4469-8723-f00ab80a0d38', workspace=str(root.parents[2]),
        home=str(Path.home() / '.t3'),
        controller=str(Path.home() / 'projects/onboarding/.agents/skills/access-t3-code/scripts/t3_control.py'),
        model=dict(instanceId='opencode', model='enablers/xlarge'),
        jev_client=str(Path.home() / 'projects/stt-polish/stt_polish/jev.py'))
    (resources / 'investigation-config.json').write_text(json.dumps(investigation_config, indent=2))
    info = dict(CFBundleName='T3 Doctor', CFBundleDisplayName='T3 Doctor', CFBundleIdentifier='local.t3-doctor.app',
                CFBundleExecutable='T3Doctor', CFBundlePackageType='APPL', CFBundleShortVersionString='0.7.2',
                CFBundleVersion='10', CFBundleIconFile='Doctor', LSMinimumSystemVersion='14.0', DoctorPython=sys.executable,
                NSHighResolutionCapable=True, NSPrincipalClass='NSApplication',
                NSHumanReadableCopyright='T3 Doctor. Local agent monitoring.')
    (contents / 'Info.plist').write_bytes(plistlib.dumps(info))
    run('codesign', '--force', '--sign', '-', app)
    run('codesign', '--verify', '--strict', app)
    if args.install:
        target = Path.home() / 'Applications/T3 Doctor.app'
        if target.exists():
            old_info = plistlib.loads((target / 'Contents/Info.plist').read_bytes())
            if old_info.get('CFBundleIdentifier') != info['CFBundleIdentifier']:
                raise RuntimeError('A different app already occupies the install location.')
        shutil.copytree(app, target, dirs_exist_ok=True)
        run('codesign', '--verify', '--strict', target)
        print(f'Installed {target}')
    else:
        print(f'Built {app}')


if __name__ == '__main__':
    main()
