// 開発時のモジュールキャッシュ対策：エントリに付いた ?v= を兄弟モジュールへ伝播し、毎回新鮮に読み込む
const _q = new URL(import.meta.url).search;
const { createStore } = await import('./store.js' + _q);
const { loadState, saveState } = await import('./persist.js' + _q);
const { renderDaily, focusCard } = await import('./daily.js' + _q);
const { renderList, DEFAULT_COLUMNS } = await import('./list.js' + _q);
const GH = await import('./github.js' + _q);

export const APP_VERSION = '0.11.1';

const store = createStore(loadState() || undefined);
window.__store = store;                          // preview 検証用ハンドル

const todayStr = () => new Date().toISOString().slice(0, 10);
let currentView = 'daily';
const listState = { hideDone:false, dueFilter:'all', projFilter:'all', sort:'due', columns: DEFAULT_COLUMNS.slice() };

// 変更 → ローカル保存（デバウンス）＋ GitHub自動送信（有効時・デバウンス）
let _ghTimer = null;
function scheduleGhSync(){
  if (!GH.ghGetSettings().enabled) return;
  clearTimeout(_ghTimer);
  _ghTimer = setTimeout(() => GH.ghSyncSave(store, { onStatus: ghStatus }), 2500);
}
store.subscribe(() => { saveState(store); scheduleGhSync(); });

function renderAll(){
  const dv = document.getElementById('view-daily');
  const lv = document.getElementById('view-list');
  if (dv) dv.hidden = currentView !== 'daily';
  if (lv) lv.hidden = currentView !== 'list';
  if (currentView === 'daily' && dv) renderDaily(store, dv, renderAll);
  if (currentView === 'list'  && lv) renderList(store, lv, renderAll, listState);
  document.getElementById('view-daily-btn')?.classList.toggle('active', currentView === 'daily');
  document.getElementById('view-list-btn')?.classList.toggle('active', currentView === 'list');
}
function setView(v){ currentView = v; renderAll(); }

function addToday(){
  const day = store.ensureDayCard(todayStr());
  const { ref } = store.createCard({ kind:'task', content:'', parentRefId: day.ref.id });
  currentView = 'daily';
  renderAll();
  focusCard(ref.id, 0);
}
function addProject(){
  const p = store.createProject('新規プロジェクト');
  currentView = 'list';
  listState._pmOpen = true;
  renderAll();
  const el = document.querySelector(`.proj-manager-box input[data-proj="${p.id}"]`);
  if (el){ el.focus(); el.select(); }
}

// ── GitHub 同期 UI ──
const TOK_MASK = '●'.repeat(20);
function ghStatus(msg, isErr = false){
  const el = document.getElementById('gh-status');
  if (el){ el.textContent = msg; el.style.color = isErr ? '#d9534f' : 'var(--tx3)'; }
  const badge = document.getElementById('gh-badge');
  if (badge && GH.ghGetSettings().enabled){ badge.hidden = false; badge.textContent = msg; badge.style.color = isErr ? '#d9534f' : 'var(--tx3)'; }
}
function refreshBadge(){
  const badge = document.getElementById('gh-badge');
  if (!badge) return;
  const on = GH.ghGetSettings().enabled;
  badge.hidden = !on;
  if (on && !badge.textContent) badge.textContent = '同期: 待機';
}
function openSettings(){
  const g = GH.ghGetSettings();
  document.getElementById('gh-enabled').checked = g.enabled;
  document.getElementById('gh-repo').value = g.repo;
  document.getElementById('gh-file').value = g.file;
  const tok = document.getElementById('gh-token');
  tok.value = g.token ? TOK_MASK : '';
  document.getElementById('gh-status').textContent = '';
  document.getElementById('gh-modal').hidden = false;
}
function saveSettings(){
  const tokEl = document.getElementById('gh-token');
  let token;                                       // undefined = 変更なし（既存トークン据え置き）
  if (tokEl.value !== TOK_MASK) token = tokEl.value.trim();
  GH.ghSaveSettings({
    token,
    repo: document.getElementById('gh-repo').value,
    file: document.getElementById('gh-file').value,
    enabled: document.getElementById('gh-enabled').checked,
  });
  if (token !== undefined) tokEl.value = token ? TOK_MASK : '';
  ghStatus('設定を保存しました');
  refreshBadge();
}
function confirmOverwrite(remoteAt, localAt){
  return confirm('リモート(GitHub)のデータでローカルを上書きしますか？\n\n'
    + 'リモート: ' + (remoteAt ? new Date(remoteAt).toLocaleString() : '不明') + '\n'
    + 'ローカル: ' + (localAt  ? new Date(localAt).toLocaleString()  : '不明') + '\n\n'
    + '※ローカルの未送信変更は失われます。');
}

function boot(){
  const ver = document.getElementById('ver');
  if (ver) ver.textContent = 'v' + APP_VERSION;
  document.getElementById('view-daily-btn')?.addEventListener('click', () => setView('daily'));
  document.getElementById('view-list-btn')?.addEventListener('click', () => setView('list'));
  document.getElementById('add-today')?.addEventListener('click', addToday);
  document.getElementById('add-proj')?.addEventListener('click', addProject);

  document.getElementById('settings-btn')?.addEventListener('click', openSettings);
  document.getElementById('gh-save')?.addEventListener('click', saveSettings);
  document.getElementById('gh-push')?.addEventListener('click', () => GH.ghSyncSave(store, { manual:true, onStatus: ghStatus }));
  document.getElementById('gh-pull')?.addEventListener('click', async () => {
    const ok = await GH.ghSyncLoad(store, { manual:true, onStatus: ghStatus, confirmOverwrite });
    if (ok) renderAll();
  });
  document.getElementById('gh-backup')?.addEventListener('click', () => GH.ghBackupNow(store, { onStatus: ghStatus }));
  document.getElementById('gh-close')?.addEventListener('click', () => { document.getElementById('gh-modal').hidden = true; });

  renderAll();
  refreshBadge();

  // 起動時同期（有効時のみ）＋ 日次バックアップ（ノンブロッキング）
  if (GH.ghGetSettings().enabled){
    GH.ghSyncLoad(store, { onStatus: ghStatus }).then(loaded => { if (loaded) renderAll(); });
    setTimeout(() => GH.ghDailyBackupOnLoad(store, { onStatus: ghStatus }), 6000);
  }
  console.log('[tracker-v2] boot', APP_VERSION);
}
boot();
