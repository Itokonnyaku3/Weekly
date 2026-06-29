// 開発時のモジュールキャッシュ対策：エントリに付いた ?v= を兄弟モジュールへ伝播し、毎回新鮮に読み込む
const _q = new URL(import.meta.url).search;
const { createStore } = await import('./store.js' + _q);
const { loadState, saveState } = await import('./persist.js' + _q);
const { renderDaily, focusCard, resetZoom, clearDayFocus, setZoom, setMentionJump, setImageLoader, clearSelection } = await import('./daily.js' + _q);
const { renderList, DEFAULT_COLUMNS } = await import('./list.js' + _q);
const { renderProjectView } = await import('./project.js' + _q);
const { openCommandPalette, openSearchPalette } = await import('./palette.js' + _q);
const { openCalendar } = await import('./calendar.js' + _q);
const { installClipboard } = await import('./clipboard.js' + _q);
const GH = await import('./github.js' + _q);

export const APP_VERSION = '0.37.0';

const store = createStore(loadState() || undefined);
window.__store = store;                          // preview 検証用ハンドル

const todayStr = () => new Date().toISOString().slice(0, 10);
let currentView = 'daily';
const listState = { hideDone:false, dueFilter:'all', projFilter:'all', sort:'proj', columns: DEFAULT_COLUMNS.slice() };
const projState = { projId: null, rootRef: null };   // プロジェクトビュー: 開いているPJ＋ページ内ルート

// 画面分割（左=リスト / 右=デイリー）。状態と幅比率は localStorage に保存
let splitOn = false, splitRatio = 0.4;
try {
  splitOn = localStorage.getItem('pwt2_split') === '1';
  const r = parseFloat(localStorage.getItem('pwt2_splitRatio'));
  if (r >= 0.15 && r <= 0.85) splitRatio = r;
} catch {}
function saveSplit(){ try { localStorage.setItem('pwt2_split', splitOn ? '1' : '0'); localStorage.setItem('pwt2_splitRatio', String(splitRatio)); } catch {} }
function applySplitRatio(){ document.getElementById('app')?.style.setProperty('--split-left', (splitRatio * 100).toFixed(1) + '%'); }
function toggleSplit(){
  splitOn = !splitOn;
  if (splitOn && currentView === 'project') currentView = 'daily';   // 分割はリスト+デイリー専用
  saveSplit();
  renderAll();
}

// 変更 → ローカル保存（デバウンス）＋ GitHub自動送信（有効時・デバウンス）
let _ghTimer = null;
function scheduleGhSync(){
  if (!GH.ghGetSettings().enabled) return;
  clearTimeout(_ghTimer);
  _ghTimer = setTimeout(() => GH.ghSyncSave(store, { onStatus: ghStatus }), 2500);
}
store.subscribe(() => { saveState(store); scheduleGhSync(); });

function renderAll(){
  const app = document.getElementById('app');
  const dv = document.getElementById('view-daily');
  const lv = document.getElementById('view-list');
  const pv = document.getElementById('view-project');
  app?.classList.toggle('split', splitOn);
  if (splitOn){
    // 左=リスト / 右=デイリー を同時表示。両方を毎回再描画し片側の変更がもう片側へ反映される
    if (lv) lv.hidden = false;
    if (dv) dv.hidden = false;
    if (pv) pv.hidden = true;
    if (lv) renderList(store, lv, renderAll, listState, zoomToCard);
    if (dv) renderDaily(store, dv, renderAll, jumpToMention);
    applySplitRatio();
  } else {
    if (dv) dv.hidden = currentView !== 'daily';
    if (lv) lv.hidden = currentView !== 'list';
    if (pv) pv.hidden = currentView !== 'project';
    if (currentView === 'daily' && dv) renderDaily(store, dv, renderAll, jumpToMention);
    if (currentView === 'list'  && lv) renderList(store, lv, renderAll, listState, zoomToCard);
    if (currentView === 'project' && pv) renderProjectView(store, pv, renderAll, projState);
  }
  document.getElementById('view-split-btn')?.classList.toggle('active', splitOn);
  document.getElementById('view-daily-btn')?.classList.toggle('active', !splitOn && currentView === 'daily');
  document.getElementById('view-list-btn')?.classList.toggle('active', !splitOn && currentView === 'list');
  document.getElementById('view-proj-btn')?.classList.toggle('active', !splitOn && currentView === 'project');
}
function setView(v){ if (splitOn){ splitOn = false; saveSplit(); } currentView = v; renderAll(); }

function addToday(){
  const day = store.ensureDayCard(todayStr());
  const { ref } = store.createCard({ kind:'memo', content:'', parentRefId: day.ref.id });
  currentView = 'daily';
  renderAll();
  focusCard(ref.id, 0);
}
function addProject(){
  const p = store.createProject('新規プロジェクト');
  projState.projId = p.id; projState.rootRef = null;
  currentView = 'project';
  renderAll();
  const t = document.querySelector('#view-project .zoom-title-txt');   // 名前を全選択して即リネーム
  if (t){ t.focus(); const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}

// Ctrl+K パレット: カードへジャンプ（祖先を展開＋ズーム解除＋フォーカス）
function jumpToCard(bodyId){
  const refs = store.refsForBody(bodyId);
  if (!refs.length) return;
  const ref = refs[0];
  let p = ref.parentRefId ? store.getRef(ref.parentRefId) : null;
  while (p){ if (p.collapsed) store.updateRef(p.id, { collapsed: false }); p = p.parentRefId ? store.getRef(p.parentRefId) : null; }
  resetZoom(); clearDayFocus();
  currentView = 'daily';
  renderAll();
  focusCard(ref.id, -1);
}
// リスト↗: そのノードにズームした状態でデイリーを開く
function zoomToCard(bodyId){
  const refs = store.refsForBody(bodyId);
  if (!refs.length) return;
  const ref = refs[0];
  clearDayFocus();
  setZoom(ref.id);
  currentView = 'daily';
  renderAll();
  focusCard(ref.id, -1);
}
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
function dispatchCardKey(refId, init){              // フォーカス中カードへキーを発火（既存のキー操作を再利用）
  focusCard(refId, -1);
  const el = document.querySelector(`.card-txt[data-ref="${refId}"]`);
  if (el) el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles:true, cancelable:true }, init)));
}
function setCardAttr(bodyId, patch, refId){ store.updateBody(bodyId, patch); renderAll(); focusCard(refId, -1); }

function jumpToMention(bodyId){           // @チップのクリック先（日付→日へ／PJ→ノートへ／他→カードへ）
  const b = store.getBody(bodyId);
  if (b && b.kind === 'day') gotoDate(b.content);
  else if (b && b.kind === 'project') openProject(bodyId);
  else jumpToCard(bodyId);
}
function openProject(projId){             // プロジェクトのノートページを開く
  projState.projId = projId; projState.rootRef = null;
  currentView = 'project';
  renderAll();
}
function gotoDate(date){                  // カレンダー/コマンドからその日へ（全体表示でスクロール）
  store.ensureDayCard(date);
  resetZoom(); clearDayFocus();
  currentView = 'daily';
  renderAll();
  const sec = document.querySelector(`.day-sec[data-date="${date}"]`);
  if (sec){
    sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const fc = sec.querySelector('.card-txt');
    if (fc) focusCard(fc.dataset.ref, 0);
  }
}
function insertTable(cardRef){            // 表ブロックを挿入（フォーカス中カードの次／無ければ今日）
  const rows = [['', '', ''], ['', '', '']];   // 3列×2行（1行目＝見出し）
  const attrs = { kind:'table', content: JSON.stringify({ rows }) };
  const ref = cardRef && store.getRef(cardRef);
  if (ref){
    store.createCard(Object.assign(attrs, { parentRefId: ref.parentRefId, order: store.orderAfter(cardRef) }));
  } else {
    const day = store.ensureDayCard(todayStr());
    store.createCard(Object.assign(attrs, { parentRefId: day.ref.id }));
    currentView = 'daily';
  }
  renderAll();
}
function installDividerDrag(){            // ディバイダのドラッグで左右の幅比率を変更（pointer capture）
  const divider = document.getElementById('split-divider');
  const app = document.getElementById('app');
  if (!divider || !app) return;
  divider.addEventListener('pointerdown', (e) => {
    if (!splitOn) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');
    const onMove = (ev) => {
      const rect = app.getBoundingClientRect();
      if (!rect.width) return;
      let r = (ev.clientX - rect.left) / rect.width;
      splitRatio = Math.max(0.15, Math.min(0.85, r));
      applySplitRatio();
    };
    const onUp = () => {
      divider.classList.remove('dragging');
      try { divider.releasePointerCapture(e.pointerId); } catch {}
      divider.removeEventListener('pointermove', onMove);
      divider.removeEventListener('pointerup', onUp);
      saveSplit();
    };
    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', onUp);
  });
}

function buildCommands(cardRef){
  const cmds = [
    { cat:'表示', label:'デイリーを表示', run: () => setView('daily') },
    { cat:'表示', label:'リストを表示', run: () => setView('list') },
    { cat:'表示', label:'分割表示の切替（リスト＋デイリー）', run: toggleSplit },
    { cat:'表示', label:'今日へ移動', hint:'Alt+D', run: () => gotoDate(todayStr()) },
    { cat:'表示', label:'日付へ移動（カレンダー）', run: () => openCalendar({ store, onPick: gotoDate }) },
    { cat:'追加', label:'今日に追加', run: addToday },
    { cat:'追加', label:'プロジェクトを追加', run: addProject },
    { cat:'追加', label:'表を挿入', run: () => insertTable(cardRef) },
    { cat:'設定', label:'GitHub同期設定', run: openSettings },
  ];
  const body = cardRef && store.getBody(store.getRef(cardRef)?.bodyId);
  if (cardRef && body){
    const id = body.id;
    cmds.push(
      { cat:'カード', label: body.kind === 'task' ? 'メモにする' : 'タスクにする', run: () => setCardAttr(id, { kind: body.kind === 'task' ? 'memo' : 'task' }, cardRef) },
      { cat:'カード', label:'完了の切替', hint:'Ctrl+Enter', run: () => dispatchCardKey(cardRef, { key:'Enter', ctrlKey:true }) },
      { cat:'カード', label:'インデント', hint:'Tab', run: () => dispatchCardKey(cardRef, { key:'Tab' }) },
      { cat:'カード', label:'アウトデント', hint:'Shift+Tab', run: () => dispatchCardKey(cardRef, { key:'Tab', shiftKey:true }) },
      { cat:'カード', label:'上へ移動', hint:'Alt+Shift+↑', run: () => dispatchCardKey(cardRef, { key:'ArrowUp', altKey:true, shiftKey:true }) },
      { cat:'カード', label:'下へ移動', hint:'Alt+Shift+↓', run: () => dispatchCardKey(cardRef, { key:'ArrowDown', altKey:true, shiftKey:true }) },
      { cat:'カード', label:'折りたたみ', hint:'Ctrl+↑', run: () => dispatchCardKey(cardRef, { key:'ArrowUp', ctrlKey:true }) },
      { cat:'カード', label:'展開', hint:'Ctrl+↓', run: () => dispatchCardKey(cardRef, { key:'ArrowDown', ctrlKey:true }) },
      { cat:'カード', label:'ズームイン', hint:'Alt+↓', run: () => dispatchCardKey(cardRef, { key:'ArrowDown', altKey:true }) },
      { cat:'カード', label:'ズームアウト', hint:'Alt+↑', run: () => dispatchCardKey(cardRef, { key:'ArrowUp', altKey:true }) },
      { cat:'カード', label:'削除', hint:'Ctrl+Shift+Backspace', run: () => dispatchCardKey(cardRef, { key:'Backspace', ctrlKey:true, shiftKey:true }) },
      { cat:'優先度', label:'高', run: () => setCardAttr(id, { prio:3 }, cardRef) },
      { cat:'優先度', label:'中', run: () => setCardAttr(id, { prio:2 }, cardRef) },
      { cat:'優先度', label:'低', run: () => setCardAttr(id, { prio:1 }, cardRef) },
      { cat:'優先度', label:'なし', run: () => setCardAttr(id, { prio:0 }, cardRef) },
      { cat:'期限', label:'今日', run: () => setCardAttr(id, { due: todayStr() }, cardRef) },
      { cat:'期限', label:'明日', run: () => setCardAttr(id, { due: addDays(1) }, cardRef) },
      { cat:'期限', label:'来週', run: () => setCardAttr(id, { due: addDays(7) }, cardRef) },
      { cat:'期限', label:'なし', run: () => setCardAttr(id, { due: '' }, cardRef) },
      ...store.listProjects().map(p => ({ cat:'プロジェクト割当', label: p.content || 'PJ', run: () => setCardAttr(id, { proj: p.id }, cardRef) })),
      { cat:'プロジェクト割当', label:'割当なし', run: () => setCardAttr(id, { proj: undefined }, cardRef) },
    );
  }
  return cmds;
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
  document.getElementById('view-proj-btn')?.addEventListener('click', () => setView('project'));
  document.getElementById('view-split-btn')?.addEventListener('click', toggleSplit);
  installDividerDrag();
  setMentionJump(jumpToMention);                 // @チップ/バックリンクのクリック先（全ビュー共通）
  setImageLoader(GH.ghFetchImageURL);            // 画像カード: repoパス→表示URL
  document.getElementById('add-today')?.addEventListener('click', addToday);
  document.getElementById('add-proj')?.addEventListener('click', addProject);
  document.addEventListener('keydown', (e) => {              // Alt+D=今日 / Ctrl/⌘+K=コマンド / Ctrl/⌘+E=検索
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'd' || e.key === 'D')){
      e.preventDefault(); gotoDate(todayStr()); return;     // 今日のデイリーへ
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.key === 'k' || e.key === 'K'){
      e.preventDefault();
      const ae = document.activeElement;
      const cardRef = (ae && ae.classList && ae.classList.contains('card-txt')) ? ae.dataset.ref : null;
      openCommandPalette({ commands: buildCommands(cardRef) });
    } else if (e.key === 'e' || e.key === 'E'){
      e.preventDefault();
      openSearchPalette({ store, onJump: jumpToCard });
    }
  });

  document.getElementById('cal-btn')?.addEventListener('click', () => openCalendar({ store, onPick: gotoDate }));
  document.getElementById('settings-btn')?.addEventListener('click', openSettings);
  document.getElementById('gh-save')?.addEventListener('click', saveSettings);
  document.getElementById('gh-push')?.addEventListener('click', () => GH.ghSyncSave(store, { manual:true, onStatus: ghStatus }));
  document.getElementById('gh-pull')?.addEventListener('click', async () => {
    const ok = await GH.ghSyncLoad(store, { manual:true, onStatus: ghStatus, confirmOverwrite });
    if (ok) renderAll();
  });
  document.getElementById('gh-backup')?.addEventListener('click', () => GH.ghBackupNow(store, { onStatus: ghStatus }));
  document.getElementById('gh-close')?.addEventListener('click', () => { document.getElementById('gh-modal').hidden = true; });

  installClipboard(store, renderAll, focusCard, clearSelection, { uploadImage: GH.ghUploadImage });   // コピー/カット/貼り付け＋画像
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
