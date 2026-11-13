"""Draw the joincraft wordmark as SVG outlines; requires fonttools[woff]."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import re
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'design/fonts/fusion-bold-pixel-12px-zh-hans-2026.11.10.woff2'
font=TTFont(SOURCE);glyphs=font.getGlyphSet();cmap=font.getBestCmap();word='joincraft'
assert all(ord(char) in cmap for char in word)
bounds=BoundsPen(glyphs);offset=0
for char in word:
 name=cmap[ord(char)];glyphs[name].draw(TransformPen(bounds,(1,0,0,1,offset,0)));offset+=font['hmtx'][name][0]
x0,y0,x1,y1=bounds.bounds
pen=SVGPathPen(glyphs);offset=0;scale=.01;pad=1
for char in word:
 name=cmap[ord(char)]
 glyphs[name].draw(TransformPen(pen,(scale,0,0,-scale,(offset-x0)*scale+pad,y1*scale+pad)))
 offset+=font['hmtx'][name][0]
width=(x1-x0)*scale+pad*2;height=(y1-y0)*scale+pad*2
svg=f'<svg class="brand-wordmark" viewBox="0 0 {width:g} {height:g}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="{pen.getCommands()}"/></svg>'
(ROOT/'public/brand/wordmark-pixel-v1.svg').write_text(svg+'\n')
for file in ['public/home/index.html','public/auth/index.html','public/index.html','public/launcher/index.html']:
 path=ROOT/file
 content,count=re.subn(r'<svg class="brand-wordmark".*?</svg>',svg,path.read_text(),count=1,flags=re.S)
 assert count==1,file
 path.write_text(content)
print(f'Outlined lowercase wordmark: {width:g} x {height:g}; four brand headers updated')
