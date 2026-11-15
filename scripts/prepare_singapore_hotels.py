#!/usr/bin/env python3
"""Derive the monthly gross-lettings series from the pinned licensed snapshot."""
import csv, json, hashlib, datetime, pathlib
root=pathlib.Path(__file__).resolve().parents[1]
source=root/'data/singapore-hotel-statistics-2026-11.csv'
b=source.read_bytes()
expected='1c66fdf7e8b49fafeb1287b010fd8a40bc3aa521e44a0800d7d33e623021d6a3'
if hashlib.sha256(b).hexdigest()!=expected: raise ValueError('source hash changed; inspect and update provenance deliberately')
rows=list(csv.DictReader(b.decode('utf-8-sig').splitlines()))
series=[r for r in rows if r['DataSeries']=='Gross Lettings']
if len(series)!=1: raise ValueError('unexpected series')
out=[]
for label,value in series[0].items():
 if label=='DataSeries':continue
 if not value.isdigit():raise ValueError('unexpected missing or noninteger value '+label)
 month=datetime.datetime.strptime(label,'%Y%b').strftime('%Y-%m')
 out.append({'month':month,'occupiedRoomNights':int(value)})
out.sort(key=lambda v:v['month'])
obj={'source':'Singapore Department of Statistics / Singapore Tourism Board','sourceUrl':'https://data.gov.sg/datasets/d_8e62605f0c1c948702b6ea0fe45242d3/view','licenseUrl':'https://data.gov.sg/open-data-licence','sourceLastUpdated':'2026-11-10','accessedAt':'2026-11-15T11:56:05Z','snapshotSha256':expected,'rows':out}
(root/'src/data/singapore-gross-lettings.json').write_text(json.dumps(obj,separators=(',',':'))+'\n')
print('wrote',len(out),'months',out[0]['month'],'to',out[-1]['month'])
