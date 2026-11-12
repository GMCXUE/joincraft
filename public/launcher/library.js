const $ = selector => document.querySelector(selector);
const api = window.blockroomLauncher;
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem('blockroom-launcher-preferences') || '{}'); if (!preferences || typeof preferences !== 'object') preferences = {}; } catch {}
const state = { instances: [], selected: null, javaPath: null, accountMode: 'offline', account: {}, runs: [], busy: false };
const text = (selector, value) => { $(selector).textContent = value; };
function message(error) { $('#message').hidden = !error; text('#message', error?.message || error || ''); }
function item() { return state.instances.find(i => i.id === state.selected); }
const prefKey = selected => `${selected.root}/${selected.version}`;
function remember() {
  const selected = item();
  if (!selected) return;
  preferences.selected = prefKey(selected);
  preferences.name = $('#player-name').value;
  preferences.accountMode = state.accountMode;
  preferences.instances ||= {};
  preferences.instances[prefKey(selected)] = { memory: $('#memory').value, mode: $('#directory-mode').value };
  try { localStorage.setItem('blockroom-launcher-preferences', JSON.stringify(preferences)); } catch {}
}
function input() { return { id: state.selected, name: $('#player-name').value.trim(), accountMode: state.accountMode, memoryMB: Number($('#memory').value), mode: $('#directory-mode').value }; }
function pathLabel() {
  const selected = item(); if (!selected) return;
  const mode = $('#directory-mode').value === 'auto' ? selected.isolation?.mode : $('#directory-mode').value;
  const sep = selected.root.includes('\\') ? '\\' : '/';
  text('#game-path', mode === 'isolated' ? `${selected.root}${sep}versions${sep}${selected.version}` : mode === 'shared' ? selected.root : '启动前需确认目录，避免读取错误的存档位置');
}
function controls() {
  const selected = item();
  const running = state.runs.some(r => ['checking', 'starting', 'running'].includes(r.state));
  for (const id of ['#pick-directory', '#empty-import', '#pick-java']) $(id).disabled = !api || state.busy || running;
  $('#check').disabled = !api || !selected || !!selected.error || state.busy || running;
  $('#launch').disabled = $('#check').disabled || (state.accountMode === 'microsoft' && !state.account.profile);
  for (const id of ['#memory', '#directory-mode', '#player-name', '#offline-tab', '#microsoft-tab']) $(id).disabled = state.busy || running;
  $('#login').disabled = !api || !state.account.configured || state.account.busy || state.busy || running;
  $('#logout').disabled = state.account.busy || state.busy || running;
  const run = state.runs.find(r => r.id === state.selected);
  text('#pack-status', run?.message || (selected?.error ? '需要修复' : '尚未启动'));
  text('#launch', run?.state === 'running' ? '游戏运行中' : state.busy ? '请稍候…' : '启动游戏');
}
function renderAccount() {
  const online = state.accountMode === 'microsoft';
  $('#offline-panel').hidden = online; $('#microsoft-panel').hidden = !online;
  $('#offline-tab').setAttribute('aria-pressed', String(!online)); $('#microsoft-tab').setAttribute('aria-pressed', String(online));
  text('#microsoft-name', state.account.profile?.name || '尚未登录');
  text('#microsoft-hint', !state.account.configured ? '此构建尚未配置微软登录。' : state.account.profile ? 'Java 版账号已授权 · 本次客户端会话有效' : '使用拥有 Java 版的微软账号。');
  $('#login').hidden = !!state.account.profile; $('#logout').hidden = !state.account.profile;
  controls();
}
function render() {
  text('#instance-count', state.instances.length);
  text('#root-path', state.root || '选择已安装整合包所在的文件夹');
  $('#instances').replaceChildren(...state.instances.map(instance => {
    const button = document.createElement('button'); button.className = 'instance'; button.setAttribute('aria-current', String(instance.id === state.selected));
    const avatar = document.createElement('span'); avatar.className = 'instance-avatar'; avatar.textContent = instance.name.slice(0, 2).toUpperCase();
    const copy = document.createElement('span'); copy.className = 'instance-text'; const title = document.createElement('strong'); title.textContent = instance.name; const meta = document.createElement('small'); meta.textContent = instance.error ? '配置需要修复' : `${instance.loader} · Java ${instance.javaMajor}`; copy.append(title, meta); button.append(avatar, copy);
    button.onclick = () => { if (state.busy) return; remember(); state.selected = instance.id; message(null); render(); remember(); }; return button;
  }));
  const selected = item(); $('#empty').hidden = !!selected; $('#details').hidden = !selected;
  if (selected) {
    text('#pack-name', selected.name); text('#pack-icon', selected.name.slice(0, 2).toUpperCase());
    text('#pack-meta', selected.error ? '已安装实例' : `${selected.loader} / ${selected.minecraft}`);
    text('#isolation-hint', selected.isolation?.source || '无法读取版本配置');
    const saved = preferences.instances?.[prefKey(selected)];
    $('#directory-mode').value = ['auto', 'shared', 'isolated'].includes(saved?.mode) ? saved.mode : 'auto';
    $('#memory').value = Number(saved?.memory) >= 512 && Number(saved?.memory) <= 32768 ? saved.memory : '4096';
    pathLabel(); text('#check-result', '启动前会检查 Java 和游戏文件');
    if (selected.error) message(selected.error);
  }
  text('#java-path', state.javaPath || '尚未选择 Java'); renderAccount();
}
async function action(fn) { message(null); state.busy = true; controls(); try { await fn(); } catch (e) { message(e); } finally { state.busy = false; controls(); } }
async function pick() { await action(async () => { const result = await api.pickDirectory(); if (result) { Object.assign(state, result); state.selected = state.instances[0]?.id; render(); if (!state.instances.length) message('这个目录里没有可识别的版本，请选择已经安装好的整合包。'); } }); }
$('#pick-directory').onclick = pick; $('#empty-import').onclick = pick;
$('#pick-java').onclick = () => action(async () => { const java = await api.pickJava(); if (java) { state.javaPath = java.path; text('#java-path', `Java ${java.major} · ${java.path}`); } });
$('#directory-mode').onchange = () => { pathLabel(); remember(); };
$('#memory').onchange = remember; $('#player-name').oninput = remember;
$('#offline-tab').onclick = () => { state.accountMode = 'offline'; remember(); renderAccount(); };
$('#microsoft-tab').onclick = () => { state.accountMode = 'microsoft'; remember(); renderAccount(); };
$('#login').onclick = () => action(async () => { try { state.account = await api.login(); renderAccount(); } finally { $('#device-code').hidden = true; } });
$('#logout').onclick = () => action(async () => { state.account = await api.logout(); renderAccount(); });
$('#open-microsoft').onclick = () => api.microsoftPage().catch(message);
$('#check').onclick = () => action(async () => { const result = await api.check(input()); text('#check-result', `${result.files} 个文件校验通过${result.accountReady ? '，可以启动' : '，还需登录微软账号'}`); text('#game-path', result.gamePath); });
$('#launch').onclick = () => action(async () => { await api.start(input()); text('#check-result', '已创建游戏进程，等待游戏窗口打开'); });
$('#rooms').onclick = () => api ? api.rooms().catch(message) : location.assign('/#friends');
$('.brand').onclick = event => { event.preventDefault(); $('#rooms').click(); };
if (!api) { $('#web-note').hidden = false; text('#surface-label', '网页预览'); render(); }
else {
  api.onEvent(event => {
    if (event.type === 'device-code') { text('#code', event.code); $('#device-code').hidden = false; }
    if (event.type === 'account') { state.account = event; renderAccount(); }
    if (event.type === 'run') { state.runs = [...state.runs.filter(r => r.id !== event.id), event]; controls(); if (event.id === state.selected) text('#check-result', event.message); if (event.state === 'failed') message(event.message); }
  });
  api.state().then(result => { Object.assign(state, result); state.selected = state.instances.find(i => prefKey(i) === preferences.selected)?.id || state.instances[0]?.id; state.accountMode = preferences.accountMode === 'microsoft' ? 'microsoft' : 'offline'; if (typeof preferences.name === 'string') $('#player-name').value = preferences.name.slice(0, 16); render(); }).catch(message);
}
