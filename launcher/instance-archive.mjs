import path from 'node:path';
export function instanceArchive(instance){const name=instance.archiveFile||'pack.mrpack';if(!/^pack(?:-[a-f0-9]{128})?\.mrpack$/.test(name))throw Error('实例整合包文件标识无效');return path.join(path.dirname(instance.root),name);}
