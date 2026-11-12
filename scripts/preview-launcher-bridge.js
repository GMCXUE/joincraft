(() => {
  const listeners = [];
  const root = 'D:\\Minecraft\\PCL\\.minecraft';
  const instances = [
    { id: 'mock-fabric', name: '周末生存', version: '周末生存', root, minecraft: '1.20.1', loader: 'Fabric', javaMajor: 17, isolation: { mode: 'isolated', source: 'PCL 版本隔离设置' } },
    { id: 'mock-forge', name: '机械动力', version: '机械动力', root, minecraft: '1.20.1', loader: 'Forge', javaMajor: 17, isolation: { mode: 'isolated', source: '实例目录已有模组或存档' } },
    { id: 'mock-old', name: '旧版冒险', version: '旧版冒险', root, minecraft: '1.12.2', loader: 'Forge', javaMajor: 8, error: '模拟：缺少继承版本配置，请先在 PCL 中修复该实例' }
  ];
  let account = { configured: true, profile: null, busy: false };
  const emit = event => listeners.forEach(fn => fn(event));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  window.blockroomLauncher = {
    state: async () => ({ root, instances, javaPath: 'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe', account, runs: [] }),
    pickDirectory: async () => ({ root, instances }),
    pickJava: async () => ({ path: 'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe', major: 17 }),
    check: async input => { await delay(200); if (!/^[A-Za-z0-9_]{3,16}$/.test(input.name)) throw new Error('模拟：玩家名格式不正确'); return { files: 1426, gamePath: `${root}\\versions\\${instances.find(i => i.id === input.id).version}`, accountReady: input.accountMode === 'offline' || !!account.profile }; },
    start: async input => { emit({ type: 'run', id: input.id, state: 'checking', message: '模拟：正在检查文件' }); await delay(400); emit({ type: 'run', id: input.id, state: 'running', message: '模拟：游戏进程已启动' }); setTimeout(() => emit({ type: 'run', id: input.id, state: 'exited', message: '模拟完成，未运行真实游戏' }), 2500); return { started: true }; },
    login: async () => { account.busy = true; emit({ type: 'device-code', code: 'DEMO-ONLY' }); await delay(2000); account = { configured: true, busy: false, profile: { name: 'DemoPlayer' } }; emit({ type: 'account', ...account }); return account; },
    logout: async () => (account = { configured: true, busy: false, profile: null }),
    microsoftPage: async () => { throw new Error('这是模拟测试，不会打开真实登录页面。'); },
    rooms: async () => { location.assign('http://127.0.0.1:4180/'); },
    onEvent: fn => listeners.push(fn)
  };
  document.addEventListener('DOMContentLoaded', () => { const note = document.querySelector('#web-note'); note.hidden = false; note.textContent = '模拟测试 · 下方实例、账号与启动状态均为测试数据，不会运行游戏或进行真实登录。'; document.querySelector('#surface-label').textContent = '游戏库 · 模拟预览'; });
})();
