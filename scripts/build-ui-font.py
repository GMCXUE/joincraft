"""Build the renamed OFL UI font, covering GB2312 and every current product label.
Requires fonttools[woff]. The display headline remains a separate tiny subset.
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
ROOT = Path(__file__).resolve().parent.parent
source = ROOT / 'design/fonts/fusion-bold-pixel-12px-zh-hans-2026.11.10.woff2'
output = ROOT / 'public/brand/ui-pixel-v1.woff2'
font = TTFont(source, recalcTimestamp=False)
chars = set(range(32, 127))
for high in range(0xa1, 0xf8):
    for low in range(0xa1, 0xff):
        try: chars.update(map(ord, bytes((high, low)).decode('gb2312')))
        except UnicodeDecodeError: pass
for start, end in [(0x2000,0x2070),(0x3000,0x3040),(0xff00,0xfff0)]:
    chars.update(range(start,end))
labels = set()
for folder in ['public', 'src', 'desktop']:
    for path in (ROOT / folder).rglob('*'):
        if path.suffix not in ['.html','.js','.ts','.mjs','.cjs']: continue
        if path.name in ['ui.js','voice-sdk.js','joincraft-bridge.cjs','blockroom-bridge.cjs']: continue
        if 'node_modules' in path.parts: continue
        labels.update(map(ord, path.read_text()))
chars.update(labels)
# Source glyph coverage is deliberately explicit; the normal UI font handles other scripts.
chars.intersection_update(font.getBestCmap())
names = {1:'Joincraft Pixel UI',2:'Regular',3:'JoincraftPixelUI-v1',4:'Joincraft Pixel UI',6:'JoincraftPixelUI',16:'Joincraft Pixel UI',17:'Regular'}
for record in list(font['name'].names):
    if record.nameID in names:
        font['name'].setName(names[record.nameID],record.nameID,record.platformID,record.platEncID,record.langID)
for name_id in [16,17]: font['name'].setName(names[name_id],name_id,3,1,0x409)
options=subset.Options();options.name_IDs=['*'];options.name_legacy=True;options.name_languages=['*']
subsetter=subset.Subsetter(options=options);subsetter.populate(unicodes=chars);subsetter.subset(font)
font.flavor='woff2';font.save(output)
check=TTFont(output)
assert chars.issubset(check.getBestCmap())
print(f'Pixel UI font: {output.stat().st_size} bytes, {len(chars)} glyphs; copyright and license records retained')
