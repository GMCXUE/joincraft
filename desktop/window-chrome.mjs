export const TITLEBAR_HEIGHT=40;
export const TITLEBAR_COLOR='#191b20';
export function windowChromeOptions(platform=process.platform){
  if(platform==='darwin')return {titleBarStyle:'hidden',trafficLightPosition:{x:14,y:13}};
  if(platform==='win32'||platform==='linux')return {titleBarStyle:'hidden',titleBarOverlay:{color:TITLEBAR_COLOR,symbolColor:'#aeb6c2',height:TITLEBAR_HEIGHT}};
  return {};
}
