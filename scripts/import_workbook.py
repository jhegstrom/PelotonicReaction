#!/usr/bin/env python3
"""Read-only XLSX conversion using Python's standard library. No Excel installation needed."""
import argparse, datetime, json, re, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

N = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
SHEETS = ['3 by 20-5 at 130', 'Mt Peloton 90 minute climb', '90-minute fat burn', '45-minute Tabata']
SHEET_TAGS = {
    '3 by 20-5 at 130': ['Climb', 'Endurance'],
    'Mt Peloton 90 minute climb': ['Climb', 'Intervals'],
    '90-minute fat burn': ['Endurance', 'Intervals'],
    '45-minute Tabata': ['Tabata', 'Intervals'],
}

def convert(source, output):
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as z:
        strings = [''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
        rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        wb = ET.fromstring(z.read('xl/workbook.xml'))
        for sheet in wb.find('m:sheets', N):
            name = sheet.get('name')
            if name not in SHEETS:
                continue
            target = next(x.get('Target') for x in rels if x.get('Id') == sheet.get(R))
            path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            rows = []
            for row in ET.fromstring(z.read(path)).findall('m:sheetData/m:row', N):
                values = {}
                for c in row:
                    value = c.findtext('m:v', '', N)
                    if c.get('t') == 's': value = strings[int(value)]
                    elif c.get('t') == 'inlineStr': value = ''.join(c.find('m:is', N).itertext())
                    elif value:
                        try: value = float(value)
                        except ValueError: pass
                    values[re.sub(r'\d', '', c.get('r'))] = value
                rows.append((int(row.get('r')), values))
            header = next(v for _, v in rows if 'Duration' in v.values())
            duration_col = next(k for k,v in header.items() if v == 'Duration')
            # The oldest sheet puts its labels in B, all later sheets in A.
            label_col = 'B' if duration_col == 'D' else 'A'
            start_col = next(k for k,v in header.items() if v == 'Start')
            metrics = {key: next((k for k,v in header.items() if str(v).strip() == label), None) for key,label in [('cadence','Cadence'),('resistance','Resistance'),('watts','Watts')]}
            steps = []
            for rownum, v in rows:
                duration = v.get(duration_col)
                if not isinstance(duration, (float,int)) or duration <= 0 or not isinstance(v.get(start_col), (float,int)) or not v.get(label_col): continue
                label = str(v[label_col]); lower = label.lower()
                kind = 'warmup' if 'warm' in lower else 'cooldown' if 'cool' in lower else 'recovery' if any(w in lower for w in ['rest','recover']) else 'work'
                step = {'label':label, 'durationSeconds':round(duration*86400), 'kind':kind}
                for key,col in metrics.items():
                    value = v.get(col) if col else None
                    if isinstance(value,(float,int)): step[key] = round(value,1)
                step['primaryTargets'] = [key for key in ['cadence', 'resistance'] if key in step] or None
                step['sourceRow'] = rownum
                steps.append(step)
            slug = re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
            notes = 'Converted planned cadence, resistance and estimated watts from the workbook. Actual ride averages are not targets.'
            if name == '3 by 20-5 at 130': notes = 'Three 20-minute climbs with easy resets. The source has timings only; cadence, resistance and power are intentionally unspecified. Total source duration is 85 minutes.'
            # Preserve tags assigned by the program's author, including an intentional empty list.
            destination = output/(slug+'.json')
            existing = json.loads(destination.read_text()) if destination.exists() else {}
            tags = existing.get('tags', SHEET_TAGS[name])
            authored = {s.get('sourceRow'): s for s in existing.get('steps', []) if 'sourceRow' in s}
            for step in steps:
                previous = authored.get(step['sourceRow'], {})
                for key in ['posture', 'powerZone', 'primaryTargets', 'heartRate', 'targetRanges']:
                    if key in previous: step[key] = previous[key]
                if step.get('powerZone') is not None: step.pop('watts', None)
            workout = {'schemaVersion':1, 'id':slug, 'name':name, 'description':notes, 'tags':tags, 'source':{'workbook':source.name,'sheet':name,'convertedOn':datetime.date.today().isoformat(),'power':'Workbook estimate; not live or measured power'}, 'steps':steps}
            (output/(slug+'.json')).write_text(json.dumps(workout,indent=2)+'\n')
            print(f'{name}: {len(steps)} intervals, {sum(s["durationSeconds"] for s in steps)/60:g} min -> {slug}.json')

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('workbook',type=Path);parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'workouts');args=parser.parse_args();convert(args.workbook,args.output)
