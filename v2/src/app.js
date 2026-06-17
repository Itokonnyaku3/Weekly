// 開発時のモジュールキャッシュ対策：エントリに付いた ?v= を兄弟モジュールへ伝播し、毎回新鮮に読み込む
const _q = new URL(import.meta.url).search;
const { createStore } = await import('./store.js' + _q);
const { loadState, saveState } = await import('./persist.js' + _q);
const { renderDaily } = await import('./daily.js' + _q);

export const APP_VERSION = '0.2.0';

const store = createStore(loadState() || undefined);
window.__store = store;                          // preview 検証用ハンドル

store.subscribe(() => saveState(store));         // 保存のみ（再描画は構造変更時に明示）

function renderDump(){
  const el = document.getElementById('dev-dump');
  if (el) el.textContent =
    `bodies:${Object.keys(store.toJSON().bodies).length} refs:${Object.keys(store.toJSON().refs).length}`;
}
function renderAll(){
  renderDump();
  const v = document.getElementById('view-daily');
  if (v){ v.hidden = false; renderDaily(store, v, renderAll); }
}

function boot(){
  const ver = document.getElementById('ver');
  if (ver) ver.textContent = 'v' + APP_VERSION;
  const btn = document.getElementById('dev-add');
  if (btn) btn.onclick = () => {
    const day = store.ensureDayCard(new Date().toISOString().slice(0,10));
    store.createCard({ kind:'task', content:'テスト '+new Date().toLocaleTimeString('ja-JP'),
                       parentRefId: day.ref.id });
    renderAll();
  };
  renderAll();
  console.log('[tracker-v2] boot', APP_VERSION);
}
boot();
