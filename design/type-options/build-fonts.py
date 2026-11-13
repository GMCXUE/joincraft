from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset
import shutil
root=Path(__file__).resolve().parent
source=Path('/tmp/joincraft-type-candidates')
text='开个世界，叫上朋友。你的世界，叫上朋友。一起上线，一起造。和朋友，进同一个世界。'
fonts=[('fusion',source/'fusion/fusion-bold-pixel-12px-proportional-zh_hans.ttf.woff2'),('smiley',source/'smiley/SmileySans-Oblique.ttf.woff2'),('butter',source/'butter.ttf')]
for name,path in fonts:
 font=TTFont(path,recalcTimestamp=False)
 missing=set(map(ord,text))-set(font.getBestCmap())
 if missing:raise ValueError(f'{name} missing: '+''.join(map(chr,missing)))
 family='Joincraft Candidate '+name.title()
 names={1:family,2:'Regular',3:family+'-v1',4:family,6:'JoincraftCandidate'+name.title(),16:family,17:'Regular'}
 for record in list(font['name'].names):
  if record.nameID in names:font['name'].setName(names[record.nameID],record.nameID,record.platformID,record.platEncID,record.langID)
 options=subset.Options();options.name_IDs=['*'];options.name_legacy=True;options.name_languages=['*']
 worker=subset.Subsetter(options=options);worker.populate(text=text);worker.subset(font);font.flavor='woff2'
 target=root/'fonts'/f'{name}-headline.woff2';font.save(target)
 print(name,target.stat().st_size,'bytes', 'all candidate characters covered')
shutil.copyfile(source/'fusion/OFL.txt',root/'fonts/fusion-OFL.txt')
shutil.copytree(source/'fusion/LICENSES',root/'fonts/fusion-components',dirs_exist_ok=True)
shutil.copyfile(source/'smiley-LICENSE.txt',root/'fonts/smiley-OFL.txt')
shutil.copyfile(source/'butter-OFL.txt',root/'fonts/butter-OFL.txt')
