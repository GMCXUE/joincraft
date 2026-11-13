"""Original 16px creature portraits for joincraft; no remote texture dependency."""
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'public/avatars';OUT.mkdir(exist_ok=True)
def face(base):return [[base for _ in range(16)] for _ in range(16)]
def rect(a,x,y,w,h,c):
 for yy in range(max(0,y),min(16,y+h)):
  for xx in range(max(0,x),min(16,x+w)):a[yy][xx]=c
portraits={}
a=face('#648948');rect(a,0,0,16,2,'#789c50');rect(a,0,2,2,14,'#55753d');rect(a,12,1,4,3,'#5b7d42');rect(a,3,3,3,2,'#769550');rect(a,11,10,5,2,'#56783e');rect(a,3,6,4,3,'#263b2b');rect(a,10,6,4,3,'#263b2b');rect(a,4,8,2,1,'#172b23');rect(a,11,8,2,1,'#172b23');rect(a,7,9,2,3,'#4c7138');rect(a,5,13,7,1,'#3e5c31');rect(a,3,11,2,2,'#7c9755');portraits['zombie']=a
a=face('#bcbeb0');rect(a,2,0,12,1,'#dbdccc');rect(a,1,1,14,12,'#d7d7c6');rect(a,0,3,2,9,'#b2b4a9');rect(a,3,5,4,4,'#424b46');rect(a,10,5,4,4,'#424b46');rect(a,4,5,3,1,'#343d38');rect(a,11,5,3,1,'#343d38');rect(a,7,9,3,2,'#72786d');rect(a,3,13,11,3,'#d7d7c6');rect(a,3,12,11,1,'#747c70');
for x in [5,8,11]:rect(a,x,13,1,3,'#9a9e92')
portraits['skeleton']=a
a=face('#62a349');rect(a,0,0,16,2,'#82b65b');rect(a,1,2,3,2,'#7ab24d');rect(a,12,1,4,3,'#55923b');rect(a,0,11,3,5,'#528b3c');rect(a,12,10,4,2,'#79b34e');rect(a,4,14,3,2,'#80b553');rect(a,2,4,4,4,'#20392b');rect(a,10,4,4,4,'#20392b');rect(a,6,8,4,3,'#20392b');rect(a,4,10,8,3,'#20392b');rect(a,4,13,2,2,'#20392b');rect(a,10,13,2,2,'#20392b');portraits['creeper']=a
a=face('#22252b');rect(a,0,0,16,2,'#30323c');rect(a,0,2,2,14,'#191c24');rect(a,12,11,4,5,'#1a1d25');rect(a,2,6,5,3,'#b673ba');rect(a,9,6,5,3,'#b673ba');rect(a,4,6,2,3,'#df9de1');rect(a,10,6,2,3,'#df9de1');rect(a,2,9,5,1,'#5b3f6a');rect(a,9,9,5,1,'#5b3f6a');portraits['enderman']=a
a=face('#e7a0a1');rect(a,0,0,16,2,'#f2b2ae');rect(a,0,2,2,14,'#cb858e');rect(a,12,3,4,2,'#df9295');rect(a,2,5,3,3,'#f2d3bf');rect(a,11,5,3,3,'#f2d3bf');rect(a,3,5,2,3,'#393730');rect(a,11,5,2,3,'#393730');rect(a,4,9,9,5,'#f4b9b0');rect(a,4,13,9,1,'#cc8790');rect(a,6,10,2,2,'#b96c7b');rect(a,10,10,2,2,'#b96c7b');portraits['pig']=a
a=face('#785d48');rect(a,0,0,16,2,'#8e7158');rect(a,1,2,4,4,'#e0d9c5');rect(a,9,1,5,3,'#e4decb');rect(a,0,8,4,4,'#e1dcc9');rect(a,11,6,5,5,'#ebe3d2');rect(a,3,5,3,4,'#ece5d2');rect(a,10,5,3,4,'#ece5d2');rect(a,4,6,2,3,'#2c302b');rect(a,10,6,2,3,'#2c302b');rect(a,2,11,12,5,'#b5aa9b');rect(a,2,11,12,1,'#d6caba');rect(a,4,12,2,2,'#4c4b43');rect(a,10,12,2,2,'#4c4b43');portraits['cow']=a
a=face('#d48a45');rect(a,0,0,16,2,'#eaa350');rect(a,0,0,4,5,'#614733');rect(a,12,0,4,5,'#614733');rect(a,1,1,2,3,'#d9bb8b');rect(a,13,1,2,3,'#d9bb8b');rect(a,0,10,5,6,'#e9dec2');rect(a,11,10,5,6,'#e9dec2');rect(a,4,12,8,4,'#f1e5cc');rect(a,3,7,3,2,'#35362d');rect(a,10,7,3,2,'#35362d');rect(a,6,10,4,3,'#30362f');rect(a,7,13,2,1,'#826348');portraits['fox']=a
a=face('#aaa99a');rect(a,0,0,16,2,'#c2c1ae');rect(a,0,0,4,5,'#858c82');rect(a,12,0,4,5,'#858c82');rect(a,1,1,2,3,'#b6a491');rect(a,13,1,2,3,'#b6a491');rect(a,3,6,3,3,'#e0ddc8');rect(a,10,6,3,3,'#e0ddc8');rect(a,4,7,2,2,'#343c38');rect(a,10,7,2,2,'#343c38');rect(a,3,10,10,6,'#d8d5bd');rect(a,6,10,4,3,'#35403c');rect(a,7,13,2,2,'#8d9488');portraits['wolf']=a
a=face('#c99961');rect(a,0,0,16,2,'#dcad75');rect(a,0,0,4,5,'#806344');rect(a,12,0,4,5,'#806344');rect(a,1,1,2,3,'#dfa58c');rect(a,13,1,2,3,'#dfa58c');rect(a,6,0,1,4,'#977144');rect(a,9,0,1,3,'#977144');rect(a,2,6,4,3,'#bad08b');rect(a,10,6,4,3,'#bad08b');rect(a,4,6,1,3,'#3b4130');rect(a,11,6,1,3,'#3b4130');rect(a,3,10,10,6,'#edddba');rect(a,7,10,2,2,'#b87a72');rect(a,0,11,4,1,'#876f50');rect(a,12,11,4,1,'#876f50');rect(a,1,13,3,1,'#876f50');rect(a,12,13,3,1,'#876f50');portraits['cat']=a
a=face('#e5e4d4');rect(a,0,0,16,2,'#f6f1df');rect(a,0,2,2,14,'#c8cebd');rect(a,3,5,2,3,'#323b34');rect(a,11,5,2,3,'#323b34');rect(a,5,9,7,4,'#ddaf48');rect(a,5,9,7,1,'#f2cd64');rect(a,5,12,7,1,'#ac7a36');rect(a,7,13,3,3,'#b4503f');portraits['chicken']=a
for name,a in portraits.items():
 bycolor={}
 for y,row in enumerate(a):
  x=0
  while x<16:
   c=row[x];end=x+1
   while end<16 and row[end]==c:end+=1
   bycolor.setdefault(c,[]).append(f'M{x} {y}h{end-x}v1H{x}Z');x=end
 svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">'+''.join(f'<path fill="{c}" d="{"".join(paths)}"/>' for c,paths in bycolor.items())+'</svg>'
 (OUT/(name+'-v1.svg')).write_text(svg)
print('Built',len(portraits),'original pixel portraits')
