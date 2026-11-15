#!/usr/bin/env python3
"""Capture public directional monthly totals for an offline, reproducible study.
No TBO bookings, credentials, price data or supplier information are retrieved.
Output is a derived ODbL dataset: attribute DGCA, MoCA and the upstream project.
"""
import hashlib
import json
import pathlib
import urllib.parse
import urllib.request

BASE = 'https://tbo-assemble.vercel.app/api/india-market/traffic'
ROUTES = [('BOM','DEL'),('DEL','BOM'),('DEL','PNQ'),('PNQ','DEL'),('BLR','DEL'),('DEL','BLR')]
OUT = pathlib.Path('data/statsforecast/route-traffic-snapshot.json')

def main():
    output={'description':'Derived industry-wide directional traffic; not TBO demand or fares.', 'api':BASE,
            'attribution':'DGCA and Ministry of Civil Aviation; historical CSV via Vonter/india-aviation-traffic (ODbL 1.0); official DGCA workbooks per manifest.', 'routes':[]}
    for origin,destination in ROUTES:
        url=BASE+'?'+urllib.parse.urlencode({'origin':origin,'destination':destination})
        with urllib.request.urlopen(url,timeout=60) as response:
            if response.status != 200: raise RuntimeError(f'{origin}-{destination}: API status {response.status}')
            data=json.load(response)
        route=data['route']; rows=data['monthly'];
        if route['origin']!=origin or route['destination']!=destination or not rows or len(rows)>250: raise ValueError('Unexpected route data')
        if len({r['month'] for r in rows})!=len(rows): raise ValueError('Duplicate month in API response')
        cleaned=[{'month':r['month'],'passengers':r['passengers'],'quality':r['quality']} for r in rows]
        canonical=json.dumps(cleaned,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf-8')
        output['routes'].append({'origin':origin,'destination':destination,'retrievedAt':data['retrievedAt'],'sourceManifestSha256':data['sourceSha256'],'sources':data['sources'],'rowsSha256':hashlib.sha256(canonical).hexdigest(),'monthly':cleaned})
        print(f'{origin}→{destination}: {len(rows)} months through {rows[-1]["month"]}')
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Wrote {OUT}')

if __name__=='__main__': main()
