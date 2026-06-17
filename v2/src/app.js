import { createStore } from './store.js';
import { loadState, saveState } from './persist.js';

export const APP_VERSION = '0.1.0';

const store = createStore(loadState() || undefined);
store.subscribe(() => saveState(store));      // 変更があれば自動保存（デバウンス）
window.__store = store;                         // preview 検証用ハンドル

function renderDump(){
  const el = document.getElementById('dev-dump');
  if (el) el.textContent =
    `bodies:${Object.keys(store.toJSON().bodies).length} refs:${Object.keys(store.toJSON().refs).length}`;
}

function boot(){
  const ver = document.getElementById('ver');
  if (ver) ver.textContent = 'v' + APP_VERSION;
  const btn = document.getElementById('dev-add');
  if (btn) btn.onclick = () => {
    const day = store.ensureDayCard(new Date().toISOString().slice(0,10));
    store.createCard({ kind:'task', content:'テスト '+new Date().toLocaleTimeString('ja-JP'),
                       parentRefId: day.ref.id });
    renderDump();
  };
  renderDump();
  console.log('[tracker-v2] boot', APP_VERSION);
}
boot();
