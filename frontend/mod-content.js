import {lexer} from 'marked';
// Build nodes from Markdown tokens, never execute author HTML or set innerHTML.
export function contentURL(value,{image=false}={}){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return '';return image?u.hostname==='cdn.modrinth.com'?u.href:'':['modrinth.com','github.com'].includes(u.hostname)?u.href:'';}catch{return '';}
}
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',copy:'©',reg:'®',ndash:'–',mdash:'—',hellip:'…'};
const decode=value=>String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(full,key)=>{if(key[0]!=='#')return entities[key]??full;const code=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return code>0&&code<=0x10ffff?String.fromCodePoint(code):full;});
export function renderModMarkdown(text,doc=document){
 const root=doc.createElement('div');root.className='mod-markdown';
 const node=(tag,value)=>{const n=doc.createElement(tag);if(value!==undefined)n.textContent=value;return n;};
 function inline(tokens,parent,depth=0){if(depth>20)return;for(const t of tokens||[]){
  let n;
  if(t.type==='html')continue;
  if(t.type==='image'){const src=contentURL(t.href,{image:true});if(!src)continue;n=node('img');n.src=src;n.alt=decode(t.text||'');n.loading='lazy';n.referrerPolicy='no-referrer';n.onerror=()=>n.remove();}
  else if(t.type==='link'){const href=contentURL(t.href);n=node(href?'a':'span');if(href){n.href=href;n.target='_blank';n.rel='noopener noreferrer';}inline(t.tokens||[{type:'text',text:t.text}],n,depth+1);}
  else if(t.type==='strong'||t.type==='em'||t.type==='del'){n=node({strong:'strong',em:'em',del:'del'}[t.type]);inline(t.tokens,n,depth+1);}
  else if(t.type==='codespan')n=node('code',decode(t.text));
  else if(t.type==='br')n=node('br');
  else if(t.tokens){inline(t.tokens,parent,depth+1);continue;}
  else {parent.append(doc.createTextNode(decode(t.text||'')));continue;}
  parent.append(n);
 }}
 function blocks(tokens,parent,depth=0){if(depth>20)return;for(const t of tokens||[]){let n;
  if(t.type==='html'||t.type==='space')continue;
  if(t.type==='heading'){n=node('h'+Math.min(4,t.depth+1));inline(t.tokens,n);}
  else if(t.type==='paragraph'||t.type==='text'){n=node('p');inline(t.tokens||[{type:'text',text:t.text}],n);}
  else if(t.type==='code'){n=node('pre');n.append(node('code',t.text));}
  else if(t.type==='hr')n=node('hr');
  else if(t.type==='blockquote'){n=node('blockquote');blocks(t.tokens,n,depth+1);}
  else if(t.type==='list'){n=node(t.ordered?'ol':'ul');for(const item of t.items){const li=node('li');blocks(item.tokens,li,depth+1);n.append(li);}}
  else if(t.type==='table'){n=node('table');const head=node('tr');for(const cell of t.header){const th=node('th');inline(cell.tokens,th);head.append(th);}const thead=node('thead');thead.append(head);n.append(thead);const body=node('tbody');for(const row of t.rows){const tr=node('tr');for(const cell of row){const td=node('td');inline(cell.tokens,td);tr.append(td);}body.append(tr);}n.append(body);}
  if(n)parent.append(n);
 }}
 blocks(lexer(String(text||'').slice(0,64000),{gfm:true}),root);return root;
}
