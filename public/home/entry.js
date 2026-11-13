// Preserve previously shared room/friend URLs without sending visitors into a marketing page.
const params=new URLSearchParams(location.search);
if(/^#(?:friends(?:\/|$)|room\/|chat\/|home$)/.test(location.hash)||params.has('guest')||params.has('code')){
 location.replace('/app/'+location.search+location.hash);
}
