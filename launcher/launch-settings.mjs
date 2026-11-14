const windows=new Set(['default','1280x720','1600x900','1920x1080','fullscreen']);
export function splitArguments(value=''){
 if(typeof value!=='string'||value.length>4096||/[\0\x01-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw Error('启动参数格式无效或超过 4096 字符');
 const args=[];let word='',quote=null,started=false;
 for(let i=0;i<value.length;i++){
  const char=value[i];
  if(quote){if(char===quote)quote=null;else if(char==='\\'){let count=1;while(value[i+count]==='\\')count++;if(value[i+count]===quote){word+='\\'.repeat(Math.floor(count/2));if(count%2)word+=quote;else quote=null;i+=count;}else{word+='\\'.repeat(count);i+=count-1;}}else word+=char;}
  else if(char==='"'||char==="'"){quote=char;started=true;}
  else if(/\s/.test(char)){if(started){args.push(word);word='';started=false;}}
  else{word+=char;started=true;}
 }
 if(quote)throw Error('启动参数的引号未闭合');if(started)args.push(word);
 if(args.length>128||args.some(arg=>!arg))throw Error('启动参数过多或包含空参数');return args;
}
export function launchSettings(input={}){
 const jvmArgs=input.jvmArgs??'',gameArgs=input.gameArgs??'',windowMode=input.windowMode??'default';
 const jvm=splitArguments(jvmArgs),game=splitArguments(gameArgs);
 const paired=new Set(['--add-opens','--add-exports','--add-reads','--add-modules','--limit-modules','--patch-module']);
 for(let i=0;i<jvm.length;i++){
  const arg=jvm[i];
  if(/^(?:-Xm[xs]|-cp(?:$|=)|-classpath(?:$|=)|--class-path(?:$|=)|-jar(?:$|=)|@)/i.test(arg))throw Error('内存、类路径和启动入口由启动器管理，请使用对应设置');
  if(/^-D(?:joincraft\.|log4j\.configurationFile)/i.test(arg))throw Error('联机组件和日志配置由启动器管理');
  if(!arg.startsWith('-')&&!paired.has(jvm[i-1]))throw Error('JVM 参数需以 - 开头，含空格的值请加引号');
 }
 const reserved=/^--(?:username|uuid|accessToken|clientId|xuid|gameDir|assetsDir|assetIndex|userType|version|versionType|server|port|quickPlay[^=]*|fml\.mods|fml\.mavenRoots|launchTarget|width|height|fullscreen)(?:$|=)/i;
 if(game.some(arg=>reserved.test(arg)))throw Error('账号、游戏目录、联机地址和窗口大小请使用对应设置');
 if(!windows.has(windowMode))throw Error('请选择有效的游戏窗口大小');
 return {jvmArgs:jvmArgs.trim(),gameArgs:gameArgs.trim(),windowMode};
}
export function compileLaunchSettings(input){
 const settings=launchSettings(input),resolution=settings.windowMode==='default'?undefined:settings.windowMode==='fullscreen'?{fullscreen:true}:Object.fromEntries(settings.windowMode.split('x').map((value,index)=>[index?'height':'width',Number(value)]));
 return {extraJVMArgs:splitArguments(settings.jvmArgs),extraMCArgs:splitArguments(settings.gameArgs),...(resolution?{resolution}:{})};
}
