/** Domain root is the public homepage; the app keeps its own stable entry point. */
export function roomPageURL(value){
 const url=new URL(value);
 if(url.pathname==='/')url.pathname='/app/';
 else if(url.pathname==='/app')url.pathname='/app/';
 return url.href;
}
