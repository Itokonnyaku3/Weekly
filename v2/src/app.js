// 開発時のモジュールキャッシュ対策：エントリに付いた ?v= を兄弟モジュールへ伝播し、毎回新鮮に読み込む
const _q = new URL(import.meta.url).search;
const { createStore } = await import('./store.js' + _q);
const { loadState, saveState } = await import('./persist.js' + _q);
const { renderDaily, focusCard } = await import('./daily.js' + _q);
const { renderList, DEFAULT_COLUMNS } = await import('./list.js' + _q);

export const APP_VERSION = '0.5.0';

const store = createStore(loadState() || undefined);
window.__store = store;                          // preview 検証用ハンドル

store.subscribe(() => saveState(store));         // 変更→保存（デバウンス）

const todayStr = () => new Date().toISOString().slice(0, 10);
let currentView = 'daily';
const listState = { hideDone:false, dueFilter:'all', sort:'due', columns: DEFAULT_COLUMNS.slice() };

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
  focusCard(ref.id, 0);                           // 追加した空カードへ即フォーカス
}

function boot(){
  const ver = document.getElementById('ver');
  if (ver) ver.textContent = 'v' + APP_VERSION;
  document.getElementById('view-daily-btn')?.addEventListener('click', () => setView('daily'));
  document.getElementById('view-list-btn')?.addEventListener('click', () => setView('list'));
  document.getElementById('add-today')?.addEventListener('click', addToday);
  renderAll();
  console.log('[tracker-v2] boot', APP_VERSION);
}
boot();
