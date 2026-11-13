// Room compatibility pins code/content, while personal settings and runtime
// caches may legitimately be rewritten by Minecraft or the embedded browser.
export function fixedPackFile(file){
  const value=file.toLowerCase();
  if(/^mods\/(?:mcef-cache|\.cache)(?:\/|$)/.test(value))return false;
  if(/^kubejs\/(?:config|cache|\.cache|logs|exported)(?:\/|$)/.test(value))return false;
  return /^(?:mods|defaultconfigs|scripts|kubejs)\//.test(value);
}
