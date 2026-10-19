import concurrent.futures
import datetime as dt
import importlib.machinery
import json
import os
from pathlib import Path
import shutil
import urllib.parse
import urllib.error

HERE = Path(__file__).parent
HOME = Path.home()
m = importlib.machinery.SourceFileLoader('ai_usage', str(HOME / '.local/bin/ai-usage')).load_module()
START = '2026-09-09T00:00:00Z'
END = dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')

def save(name, data):
    (HERE / (name + '.json')).write_text(json.dumps(data, indent=2))

def pages(path, params, headers):
    result = []
    count = 0
    while True:
        d = m.http_json('https://api.anthropic.com' + path + '?' + urllib.parse.urlencode(params, doseq=True), headers, timeout=40)
        result.extend(d.get('data', []))
        count += 1
        if not d.get('has_more'):
            return {'data': result, 'pages': count, 'has_more': False, 'starting_at': START, 'ending_at': END}
        params = dict(params, page=d['next_page'])

def anthropic():
    key = m.anthropic_admin_key()
    if not key:
        return {'error': 'Anthropic admin credential unavailable'}
    headers = {'x-api-key': key, 'anthropic-version': '2023-06-01', 'User-Agent': 'LocalUsageAudit/1.0'}
    local = m.my_key_id(headers)
    keys = []
    url = 'https://api.anthropic.com/v1/organizations/api_keys?limit=100'
    while url:
        d = m.http_json(url, headers, timeout=40)
        keys.extend(d.get('data', []))
        url = 'https://api.anthropic.com/v1/organizations/api_keys?limit=100&after_id=' + d['last_id'] if d.get('has_more') else None
    matched = next(k for k in keys if k['id'] == local['id'])
    owner = matched.get('created_by')
    owned = [k for k in keys if k['id'] == local['id'] or (owner and k.get('created_by') == owner)]
    safe_keys = [{k: v for k,v in x.items() if k not in ['partial_key_hint', 'created_by']} for x in owned]
    save('anthropic_owned_key_metadata', safe_keys)
    params = {'starting_at': START, 'ending_at': END, 'bucket_width': '1d', 'limit': 31}
    jobs = {
        'anthropic_owned_usage': ('/v1/organizations/usage_report/messages', dict(params, **{'group_by[]': ['model', 'api_key_id', 'service_tier', 'context_window'], 'api_key_ids[]': [k['id'] for k in owned]})),
        'anthropic_org_costs': ('/v1/organizations/cost_report', dict(params, **{'group_by[]': ['workspace_id','description']})),
    }
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        fs = {name: pool.submit(pages,path,ps,headers) for name,(path,ps) in jobs.items()}
        for name,f in fs.items():
            try:
                data = f.result(); save(name,data)
                print(name, 'buckets',len(data['data']), 'pages', data['pages'], flush=True)
            except urllib.error.HTTPError as e:
                print(name,'HTTP',e.code,flush=True)
                save(name,{'error': 'HTTP '+str(e.code),'detail':e.read().decode()[:500]})
    print('Owned key names:', [k.get('name') for k in safe_keys], flush=True)

def openai():
    key = os.environ.get('OPENAI_ADMIN_KEY') or m.keychain_read('OpenAI Admin Key')
    if not key:
        data = {'error': 'No OpenAI Platform admin key in environment or named Keychain item. ChatGPT OAuth plan API is available separately.'}
    else:
        params = {'start_time': int(dt.datetime.fromisoformat(START.replace('Z','+00:00')).timestamp()), 'end_time': int(dt.datetime.fromisoformat(END.replace('Z','+00:00')).timestamp()), 'bucket_width': '1d', 'limit': 31}
        try:
            data=m.http_json('https://api.openai.com/v1/organization/costs?'+urllib.parse.urlencode(params), {'Authorization':'Bearer '+key},timeout=40)
        except urllib.error.HTTPError as e:
            data={'error':'HTTP '+str(e.code)}
    save('openai_platform_costs',data)
    print('OpenAI Platform costs:',data.get('error','retrieved'),flush=True)

if __name__ == '__main__':
    for src,dst in [(HOME/'projects/onboarding/.scratch/token-spend/daily.json','local_daily.json'), (HOME/'.t3/userdata/usage-snapshot.json','t3_snapshots.json'), (HOME/'.t3/userdata/usage-record-ledger.json','t3_ledger.json')]:
        shutil.copyfile(src,HERE/dst)
    save('collection',{'starting_at':START,'ending_at':END,'comparison_complete_days':['2026-09-09','2026-09-15']})
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for f in [pool.submit(anthropic),pool.submit(openai)]:
            f.result()
