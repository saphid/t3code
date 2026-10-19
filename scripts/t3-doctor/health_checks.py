"""Provider diagnostics and read-only release checks for the local doctor."""
import datetime as dt
import functools
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import struct
import urllib.error
import urllib.parse
import urllib.request


def timestamp(now):
    return dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat()


def age(value, now):
    try:
        return max(0, now - dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp())
    except (ValueError, TypeError, AttributeError):
        return float('inf')


def read_providers(home, now):
    settings_path = home / 'settings.json'
    settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
    instances = settings.get('providerInstances', {})
    legacy = settings.get('providers', {})
    caches, errors = {}, []
    for path in (home.parent / 'caches').glob('*.json'):
        try:
            value = json.loads(path.read_text())
            instance = value.get('instanceId')
            if not instance or instance != path.stem or not value.get('driver'):
                continue
            if instance in instances or instance == value['driver']:
                caches[instance] = value
        except (ValueError, OSError, AttributeError) as error:
            errors.append(f'Cannot read {path.name}: {error}')
    result = []
    lookup_path = os.pathsep.join([str(Path.home() / '.local/bin'), '/opt/homebrew/bin',
                                 str(Path.home() / '.bun/bin'), '/usr/local/bin', os.environ.get('PATH', '')])
    for instance in sorted(set(caches) | set(instances) | set(legacy)):
        cache = caches.get(instance, {})
        config = instances.get(instance, {})
        enabled = config.get('enabled', legacy.get(instance, {}).get('enabled', cache.get('enabled', True)))
        driver = config.get('driver', cache.get('driver', instance))
        checked = cache.get('checkedAt')
        fresh = age(checked, now) <= 900
        binary = config.get('config', {}).get('binaryPath')
        found = None
        if enabled and binary:
            expanded = str(Path(binary).expanduser())
            found = os.path.isfile(expanded) and os.access(expanded, os.X_OK) if '/' in expanded else bool(shutil.which(expanded, path=lookup_path))
        auth = cache.get('auth', {}).get('status', 'unknown')
        message = cache.get('message') or 'T3 has not reported a provider diagnostic.'
        state = cache.get('status', 'unknown')
        if not enabled:
            state, message = 'disabled', 'Disabled in T3 settings.'
        elif found is False:
            state, message = 'error', 'The configured provider executable is missing or not executable.'
        elif not fresh:
            state, message = 'stale', 'T3 provider diagnostics are older than 15 minutes or unavailable. Current readiness is unverified.'
        elif cache.get('enabled') is False:
            state, message = 'unknown', 'Provider was enabled after its last diagnostic. Waiting for a fresh T3 check.'
        elif cache.get('installed') is False:
            state, message = 'error', cache.get('message') or 'T3 reports this provider is not installed.'
        elif auth == 'unauthenticated':
            state, message = 'error', cache.get('message') or 'T3 reports that this provider is not authenticated.'
        elif state == 'ready':
            message = cache.get('message') or ('T3 reports ready. Authentication is unverified.' if auth == 'unknown' else 'T3 reports ready and authenticated.')
        result.append(dict(id=instance, name=config.get('displayName') or cache.get('displayName') or instance,
                           driver=driver, enabled=enabled, state=state, installed=cache.get('installed'),
                           version=cache.get('version'), auth=auth, checked_at=checked, observed_at=timestamp(now),
                           binary_found=found, message=message,
                           source='T3 provider diagnostics and configured executable check'))
    return result, errors


def version_parts(version):
    match = re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?', version or '')
    if not match:
        return None
    return tuple(int(match[n]) for n in (1, 2, 3)), match[4].split('.') if match[4] else []


def compare_versions(left, right):
    a, b = version_parts(left), version_parts(right)
    if a is None or b is None:
        raise ValueError('Cannot compare an unrecognized version.')
    if a[0] != b[0]:
        return (a[0] > b[0]) - (a[0] < b[0])
    if not a[1] or not b[1]:
        return bool(b[1]) - bool(a[1])
    for x, y in zip(a[1], b[1]):
        if x == y:
            continue
        if x.isdigit() and y.isdigit():
            return (int(x) > int(y)) - (int(x) < int(y))
        if x.isdigit() != y.isdigit():
            return -1 if x.isdigit() else 1
        return (x > y) - (x < y)
    return (len(a[1]) > len(b[1])) - (len(a[1]) < len(b[1]))


def matching_releases(releases, channel, component):
    candidates = []
    for release in releases:
        tag = release.get('tag_name', '')
        parts = version_parts(tag)
        if release.get('draft') or not release.get('published_at') or parts is None:
            continue
        release_channel = parts[1][0] if parts[1] else 'latest'
        if release_channel != channel:
            continue
        names = [asset.get('name', '') for asset in release.get('assets', [])]
        suffix = '-arm64.dmg' if component == 'desktop' else '-darwin-arm64.tar.gz'
        if not any(name.endswith(suffix) for name in names):
            continue
        candidates.append(release)
    return sorted(candidates, key=functools.cmp_to_key(lambda a, b: compare_versions(a['tag_name'], b['tag_name'])), reverse=True)


def select_release(releases, channel, component):
    candidates = matching_releases(releases, channel, component)
    return candidates[0] if candidates else None


def process_command(pid):
    if not isinstance(pid, int) or pid < 1:
        return ''
    return subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'comm='], capture_output=True, text=True, timeout=2).stdout.strip()


def desktop_metadata(app_path):
    if not app_path:
        return {}
    archive = Path(app_path) / 'Contents/Resources/app.asar'
    try:
        with archive.open('rb') as stream:
            prefix = stream.read(16)
            _, header_size, _, json_size = struct.unpack('<4I', prefix)
            if json_size > 8_000_000:
                raise ValueError('Oversized archive header')
            header = json.loads(stream.read(json_size))
            entry = header['files']['package.json']
            if entry['size'] > 1_000_000:
                raise ValueError('Oversized package metadata')
            stream.seek(8 + header_size + int(entry['offset']))
            package = json.loads(stream.read(entry['size']))
        return {key: package.get(key) for key in ['version', 'buildVersion', 't3codeCommitHash']}
    except (OSError, ValueError, KeyError, struct.error) as error:
        return {'metadata_error': str(error)}



def installed_components(home, config):
    components = []
    runtime = home / 'server-runtime.json'
    if runtime.exists():
        metadata = json.loads(runtime.read_text())
        executable = process_command(metadata.get('pid'))
        match = re.search(r'/runtime/versions/([^/]+)/t3$', executable)
        components.append(dict(id='server', name='T3 server', installed_version=match[1] if match else None,
                               path=executable or None))
    app = config.get('desktop_app')
    if app:
        path = Path(app).expanduser()
        info = plistlib.loads((path / 'Contents/Info.plist').read_bytes())
        package = desktop_metadata(path)
        commit = package.get('t3codeCommitHash')
        components.append(dict(id='desktop', name='T3 desktop', installed_version=info.get('CFBundleShortVersionString'),
                               source_commit=commit if re.fullmatch(r'[0-9a-fA-F]{7,40}', commit or '') else None, path=str(path)))
    return components


def github_json(repository, resource):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Release repository must have the form owner/repo.')
    request = urllib.request.Request(f'https://api.github.com/repos/{repository}/{resource}',
        headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'T3-Doctor/0.7'})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = response.read(5_000_001)
    except urllib.error.HTTPError as error:
        cli = shutil.which('gh') or ('/opt/homebrew/bin/gh' if Path('/opt/homebrew/bin/gh').is_file() else None)
        if error.code not in {403, 429} or not cli:
            raise
        error.close()
        try:
            result = subprocess.run([cli, 'api', '--hostname', 'github.com', f'repos/{repository}/{resource}'],
                                    capture_output=True, timeout=15, env=dict(os.environ, GH_PROMPT_DISABLED='1'))
        except subprocess.TimeoutExpired as timeout:
            raise OSError('The authenticated GitHub lookup timed out.') from timeout
        if result.returncode:
            raise OSError('The authenticated GitHub lookup failed: ' + result.stderr.decode(errors='replace')[:250])
        body = result.stdout
    if len(body) > 5_000_000:
        raise ValueError('Release response is larger than the bounded read limit.')
    return json.loads(body)


def fetch_releases(repository):
    releases = github_json(repository, 'releases?per_page=100')
    if not isinstance(releases, list):
        raise ValueError('Release service did not return a release list.')
    return releases


def fetch_comparison(repository, installed_ref, latest_ref):
    # GitHub omits the potentially large file/patch list after page one.
    refs = urllib.parse.quote(installed_ref, safe='') + '...' + urllib.parse.quote(latest_ref, safe='')
    result = github_json(repository, 'compare/' + refs + '?per_page=1&page=2')
    if result.get('status') not in {'identical', 'ahead', 'behind', 'diverged'}:
        raise ValueError('GitHub did not return a commit comparison.')
    if any(type(result.get(k)) is not int or result[k] < 0 for k in ['ahead_by', 'behind_by']):
        raise ValueError('GitHub returned invalid commit counts.')
    return dict(commit_status=result['status'], commits_behind=result['ahead_by'], commits_ahead=result['behind_by'],
                comparison_url=result.get('html_url'))


def release_distance(installed, releases, channel):
    parts = version_parts(installed)
    if not parts:
        return dict(release_distance_note='The installed version is unknown.')
    installed_channel = parts[1][0] if parts[1] else 'latest'
    if installed_channel != channel:
        return dict(release_distance_note='Different release channels. Use the source commit comparison below.')
    count = sum(compare_versions(r['tag_name'], installed) > 0 for r in releases)
    found = any(compare_versions(r['tag_name'], installed) == 0 for r in releases)
    return dict(releases_behind=count, releases_behind_exact=found or count == 0,
                release_distance_note=None if found or count == 0 else 'Minimum count from the latest 100 published releases; the installed release was not in that list.')


class ReleaseChecker:
    def __init__(self, home, output):
        self.home, self.output = home, output
        self.cache = {}
        try:
            self.cache = json.loads((output / 'release-cache.json').read_text())
        except (OSError, ValueError):
            pass

    def check(self, now, force=False):
        config_path = self.output / 'checks.json'
        if not config_path.exists():
            return [dict(id='setup', name='T3 Code', state='unknown', message='No release source configured in checks.json.')]
        config = json.loads(config_path.read_text())
        repository, channel = config['release_repository'], config['release_channel']
        components = [dict(component) for component in installed_components(self.home, config)]
        cache_key = repository + ':' + channel
        if force or self.cache.get('source') != cache_key or self.cache.get('schema') != 2 or now - self.cache.get('attempted_at', 0) >= 3600:
            previous = self.cache if self.cache.get('source') == cache_key else {}
            self.cache = dict(previous, schema=2, source=cache_key, attempted_at=now)
            try:
                releases = fetch_releases(repository)
                matches = {kind: matching_releases(releases, channel, kind) for kind in ['server', 'desktop']}
                self.cache.update(checked_at=timestamp(now), error=None, releases={
                    kind: [{field: release.get(field) for field in ['tag_name', 'html_url', 'published_at']} for release in rows]
                    for kind, rows in matches.items()})
            except (OSError, ValueError) as error:
                self.cache['error'] = str(error)
        active_comparisons = set()
        for component in components:
            releases = self.cache.get('releases', {}).get(component['id'], [])
            release = releases[0] if releases else None
            component.update(repository=repository, channel=channel, checked_at=self.cache.get('checked_at'),
                             next_check_at=timestamp(self.cache['attempted_at'] + 3600), state='unknown')
            if self.cache.get('error'):
                component['message'] = 'Release check failed: ' + self.cache['error']
                if release:
                    component.update(latest_version=release['tag_name'].removeprefix('v'), release_url=release['html_url'])
                continue
            if not release:
                component['message'] = 'No published release with a matching Apple Silicon artifact was found in the latest 100 releases.'
                continue
            component.update(latest_version=release['tag_name'].removeprefix('v'), release_url=release['html_url'])
            installed = component.get('installed_version')
            component.update(release_distance(installed, releases, channel))
            parts = version_parts(installed)
            if parts is None:
                component['message'] = 'The running build version could not be identified. The published release is shown for reference.'
            elif (parts[1][0] if parts[1] else 'latest') != channel:
                component.update(state='release_available', message='This build uses a different release channel. Commit history shows how it compares with the published build.')
            else:
                comparison = compare_versions(component['latest_version'], installed)
                component['state'] = 'update_available' if comparison > 0 else 'current' if comparison == 0 else 'ahead'
                component['message'] = {'update_available': 'A newer version is available.', 'current': 'This version matches the latest published release.',
                                        'ahead': 'The installed version is newer than the published release.'}[component['state']]
            base = component.get('source_commit')
            if not base and parts and component.get('releases_behind_exact') and any(compare_versions(r['tag_name'], installed) == 0 for r in releases):
                base = next(r['tag_name'] for r in releases if compare_versions(r['tag_name'], installed) == 0)
            if not base:
                component['commit_distance_note'] = 'The source commit of this build could not be identified.'
                continue
            key = base + ':' + release['tag_name']
            active_comparisons.add(key)
            comparisons = self.cache.setdefault('comparisons', {})
            cached = comparisons.get(key)
            if force or cached is None or now - cached['attempted_at'] >= 3600:
                cached = dict(attempted_at=now)
                try:
                    cached.update(fetch_comparison(repository, base, release['tag_name']))
                except (OSError, ValueError) as error:
                    cached['commit_distance_note'] = 'Commit comparison unavailable: ' + str(error)
                comparisons[key] = cached
            component.update({k: v for k, v in cached.items() if k != 'attempted_at'})
        self.cache['comparisons'] = {k: v for k, v in self.cache.get('comparisons', {}).items() if k in active_comparisons}
        temporary = self.output / 'release-cache.tmp'
        temporary.write_text(json.dumps(self.cache))
        temporary.chmod(0o600)
        temporary.replace(self.output / 'release-cache.json')
        return components
