"""Draft: unsigned Dev archive only; exact identity contract required before launch."""
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import signal
import stat
import subprocess
import time


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    root = Path(os.environ['GITHUB_WORKSPACE'])
    out = Path(os.environ['RUNNER_TEMP']) / 'swiftui-dev-archive-evidence'
    out.mkdir(exist_ok=False)
    receipt = {'status': 'failed', 'startedAt': time.time()}
    try:
        contract = json.loads((root / 'apps/swift-ios/Scripts/dev-archive-identity.json').read_text())
        assert contract['build'].isdigit() and int(contract['build']) > 57, 'Dev build allocation is required'
        commit = os.environ['GITHUB_SHA']
        assert re.fullmatch('[0-9a-f]{40}', commit)
        assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip() == commit
        receipt.update(commit=commit, contract=contract, architecture=platform.machine())
        assert platform.machine() == 'arm64'
        receipt['xcode'] = subprocess.check_output(['xcodebuild', '-version'], text=True)
        assert 'Xcode 26.6\n' in receipt['xcode'] and '17F113' in receipt['xcode']
        receipt['disk'] = subprocess.check_output(['df', '-k', str(out)], text=True)
        tracked = subprocess.check_output(['git', 'ls-files', '-z', '--', 'apps/swift-ios', 'apps/mobile/modules/t3-terminal/Vendor/libghostty'], cwd=root).decode().split('\0')
        receipt['sourceHashes'] = {name: sha(root / name) for name in tracked if name and (root / name).is_file()}
        archive = Path(os.environ['RUNNER_TEMP']) / 'swiftui-dev-unsigned.xcarchive'
        command = ['xcodebuild', 'archive', '-project', str(root / 'apps/swift-ios/T3Code.xcodeproj'),
                   '-scheme', 'T3CodeTest', '-configuration', 'Test', '-destination', 'generic/platform=iOS',
                   '-jobs', '2', '-derivedDataPath', str(Path(os.environ['RUNNER_TEMP']) / 'swiftui-dev-archive-dd'),
                   '-archivePath', str(archive), 'CODE_SIGNING_ALLOWED=NO', 'T3_GIT_COMMIT=' + commit, 'CURRENT_PROJECT_VERSION=' + contract['build']]
        receipt['command'] = command
        with (out / 'xcodebuild.log').open('w') as log:
            child = subprocess.Popen(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            receipt['pid'] = child.pid
            try:
                receipt['xcodeExit'] = child.wait(timeout=1200)
            except subprocess.TimeoutExpired:
                receipt['timedOut'] = True
                os.killpg(child.pid, signal.SIGTERM)
                time.sleep(10)
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                receipt['xcodeExit'] = child.wait()
        assert receipt['xcodeExit'] == 0 and not receipt.get('timedOut')
        apps = list((archive / 'Products/Applications').glob('*.app'))
        assert len(apps) == 1
        app = apps[0]
        bundles = [app, *sorted(app.glob('PlugIns/*.appex'))]
        assert len(bundles) == 3 and len(contract['bundles']) == 3
        identities = {}
        for bundle in bundles:
            with (bundle / 'Info.plist').open('rb') as handle:
                info = plistlib.load(handle)
            identity = info['CFBundleIdentifier']
            assert identity in contract['bundles'] and identity not in identities, identity
            expected = contract['bundles'][identity]
            for key, value in expected.items():
                assert info.get(key) == value, (identity, key, info.get(key), value)
            assert info['CFBundleVersion'] == contract['build']
            assert info['CFBundleShortVersionString'] == contract['version']
            assert not list(bundle.glob('*.debug.dylib'))
            identities[identity] = info
        assert set(identities) == set(contract['bundles'])
        host = identities[contract['hostBundleIdentifier']]
        assert host.get('T3GitCommit') == commit and host.get('T3BuildChannel') == 'dev'
        schemes = [scheme for item in host.get('CFBundleURLTypes', []) for scheme in item.get('CFBundleURLSchemes', [])]
        assert schemes == [contract['hostURLScheme']], 'Unexpected host URL schemes'
        assert host.get('DTSDKName', '').startswith('iphoneos')
        assert host.get('CFBundleIcons', {}).get('CFBundlePrimaryIcon', {}).get('CFBundleIconName') == 'AppIconDev'
        lines = [line for line in (out / 'xcodebuild.log').read_text().splitlines()
                 if 'swiftc ' in line and ' -module-name T3Code ' in line]
        assert lines and all(' -O ' in line and ' -whole-module-optimization ' in line and ' -Onone ' not in line for line in lines)
        receipt['optimizationEvidence'] = lines
        receipt['builtIdentities'] = identities
        assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=root, text=True)
        dest = Path(os.environ['RUNNER_TEMP']) / 'swiftui-dev-unsigned-product'
        dest.mkdir(exist_ok=False)
        zipfile = dest / 'unsigned.xcarchive.zip'
        subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(archive), str(zipfile)], check=True, timeout=180)
        entries = []
        for path in [archive, *sorted(archive.rglob('*'))]:
            metadata = path.lstat()
            entry = {'path': str(path.relative_to(archive)), 'mode': oct(stat.S_IMODE(metadata.st_mode))}
            if path.is_symlink():
                entry.update(type='symlink', target=os.readlink(path))
            elif path.is_file():
                entry.update(type='file', bytes=metadata.st_size, sha256=sha(path))
            elif path.is_dir():
                entry.update(type='directory')
            else:
                raise RuntimeError('Unsupported archive entry: ' + str(path))
            entries.append(entry)
        manifest = out / 'archive-manifest.json'
        manifest.write_text(json.dumps(entries, indent=2) + '\n')
        receipt['manifestSha256'] = sha(manifest)
        receipt['expandedArchiveBytes'] = sum(entry.get('bytes', 0) for entry in entries)
        receipt['archive'] = {'bytes': zipfile.stat().st_size, 'sha256': sha(zipfile)}
        (out / 'artifact-size-summary.json').write_text(json.dumps({
            'commit': commit, 'archive': receipt['archive'],
            'expandedArchiveBytes': receipt['expandedArchiveBytes'],
            'manifestSha256': receipt['manifestSha256'],
        }, indent=2) + '\n')
        receipt['status'] = 'passed'
    except Exception as error:
        receipt['error'] = str(error)
    finally:
        receipt['finishedAt'] = time.time()
        (out / 'summary.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return 0 if receipt['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
