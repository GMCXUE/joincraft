const defaultDestination='/app/#friends';
// Only return to this app; never send credentials or users to an arbitrary origin.
export function appDestination(value,origin){
 try{
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//'))return defaultDestination;
  const target=new URL(value,origin);
  if(target.origin!==origin||!['/app','/app/'].includes(target.pathname))return defaultDestination;
  target.searchParams.delete('guest');
  return '/app/'+target.search+target.hash;
 }catch{return defaultDestination;}
}
export function loginPagePath(mode,returnTo,origin){
 const query=new URLSearchParams();
 if(mode==='register')query.set('mode','register');
 const next=appDestination(returnTo,origin);
 if(next!==defaultDestination)query.set('next',next);
 return '/login'+(query.size?'?'+query:'');
}
// Native clients keep their in-window dialog; guest conversion keeps its bearer session.
export function useLoginPage({desktop,guest,profile}){
 return !desktop&&!guest&&profile?.kind!=='guest';
}
