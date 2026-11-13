"""Build the small, renamed OFL pixel subset used by the two public page headlines (selected Fusion Bold variant).
Requires: python -m pip install 'fonttools[woff]'
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
TEXT = '一起上线，一起造。'
SOURCE = ROOT / 'design/fonts/fusion-bold-pixel-12px-zh-hans-2026.11.10.woff2'
OUTPUT = ROOT / 'public/home/pixel-display-v2.woff2'
font = TTFont(SOURCE, recalcTimestamp=False)
missing = set(map(ord, TEXT)) - set(font.getBestCmap())
if missing:
    raise ValueError(f'Missing headline characters: {missing}')
# This is a modified subset; give it a distinct family while retaining copyright/license records.
names = {1: 'Joincraft Bold Pixel Display', 2: 'Regular', 3: 'JoincraftBoldPixelDisplay-v2',
         4: 'Joincraft Bold Pixel Display', 6: 'JoincraftBoldPixelDisplay',
         16: 'Joincraft Bold Pixel Display', 17: 'Regular'}
for record in list(font['name'].names):
    if record.nameID in names:
        font['name'].setName(names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
for name_id in [16, 17]:
    font['name'].setName(names[name_id], name_id, 3, 1, 0x409)
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=TEXT)
subsetter.subset(font)
font.flavor = 'woff2'
font.save(OUTPUT)
check = TTFont(OUTPUT)
assert set(map(ord, TEXT)).issubset(check.getBestCmap())
print(f'Pixel headline font: {OUTPUT.stat().st_size} bytes; all characters present')
