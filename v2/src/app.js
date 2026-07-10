// 開発時のモジュールキャッシュ対策：エントリに付いた ?v= を兄弟モジュールへ伝播し、毎回新鮮に読み込む
const _q = new URL(import.meta.url).search;
const { createStore } = await import('./store.js' + _q);
const { loadState, saveState } = await import('./persist.js' + _q);
const { renderDaily, focusCard, resetZoom, clearDayFocus, setZoom, getZoom, getDayFocus, setDayFocus, revealDay, setMentionJump, setSavedSearchOpener, setImageLoader, clearSelection, serializeEditable, caretOffset, getHideDone, toggleHideDone, setAgendaJump } = await import('./daily.js' + _q);
const { renderList, DEFAULT_COLUMNS } = await import('./list.js' + _q);
const { renderProjectView } = await import('./project.js' + _q);
const { renderSearchView } = await import('./search.js' + _q);
const { openCommandPalette, openSearchPalette } = await import('./palette.js' + _q);
const { openCalendar } = await import('./calendar.js' + _q);
const { installClipboard, showToast } = await import('./clipboard.js' + _q);
const GH = await import('./github.js' + _q);

export const APP_VERSION = '0.88.0';

const store = createStore(loadState() || undefined);
window.__store = store;                          // preview 検証用ハンドル

const todayStr = () => new Date().toISOString().slice(0, 10);
let currentView = 'daily';                            // 現在アクティブなビュー（非分割の単一表示／分割時はフォーカス中ペイン）
const listState = { sort:'proj', sortDir:'asc', columns: DEFAULT_COLUMNS.slice() };
const projState = { projId: null, rootRef: null };   // プロジェクトビュー: 開いているPJ＋ページ内ルート
const searchState = { query: { keyword:'', tags:[], proj:'all', due:{mode:'any'}, done:{mode:'any'}, prio:'all' } };   // 検索ビューのクエリ（セッション）

// 画面分割（左=リスト / 右=デイリーまたはプロジェクト）。状態・幅比率・右ペイン内容・現ビューは localStorage に保存
let splitOn = false, splitRatio = 0.4;
let splitRight = 'daily';                             // 分割時の右ペイン内容: 'daily' | 'project'
const focusMem = { daily:null, list:null, project:null };   // ビューごとのフォーカス記憶（セッション内）
try {
  splitOn = localStorage.getItem('pwt2_split') === '1';
  const r = parseFloat(localStorage.getItem('pwt2_splitRatio'));
  if (r >= 0.15 && r <= 0.85) splitRatio = r;
  const sr = localStorage.getItem('pwt2_splitRight'); if (sr === 'daily' || sr === 'project') splitRight = sr;
  const cv = localStorage.getItem('pwt2_view'); if (cv === 'daily' || cv === 'list' || cv === 'project') currentView = cv;
} catch {}
function persistView(){ try {
  localStorage.setItem('pwt2_split', splitOn ? '1' : '0');
  localStorage.setItem('pwt2_splitRatio', String(splitRatio));
  localStorage.setItem('pwt2_splitRight', splitRight);
  localStorage.setItem('pwt2_view', currentView);
} catch {} }
const saveSplit = persistView;                        // 互換: ディバイダのドラッグから呼ばれる
function applySplitRatio(){ document.getElementById('app')?.style.setProperty('--split-left', (splitRatio * 100).toFixed(1) + '%'); }

// ビューを選択（分割対応）。状態だけ更新し描画はしない（呼び出し側で renderAll）。
function showView(v){
  if (splitOn && (v === 'daily' || v === 'project')) splitRight = v;   // 分割中はリスト以外＝右ペインの内容
  currentView = v;
}

// ── ナビゲーション履歴（Alt+←/→ で戻る/進む・#1）──
// 画面遷移（ビュー切替/日付ジャンプ/PJを開く/ズーム/カードジャンプ）の直前に navPush() で現状態を積む。
let navHist = [], navFuture = [];
const NAV_MAX = 50;
function navSnapshot(){
  return { view: currentView, splitRight, projId: projState.projId, projRoot: projState.rootRef, zoom: getZoom(), dayFocus: getDayFocus() };
}
function navEq(a, b){ return !!a && !!b && a.view===b.view && a.splitRight===b.splitRight && a.projId===b.projId && a.projRoot===b.projRoot && a.zoom===b.zoom && a.dayFocus===b.dayFocus; }
function navPush(){                                       // 遷移直前の状態を履歴へ（連続同一はまとめる・進む履歴は破棄）
  const cur = navSnapshot();
  if (navHist.length && navEq(navHist[navHist.length - 1], cur)) return;
  navHist.push(cur); if (navHist.length > NAV_MAX) navHist.shift();
  navFuture = [];
}
function navRestore(snap){                                // スナップショットの状態を復元して再描画
  currentView = snap.view; splitRight = snap.splitRight;
  projState.projId = snap.projId; projState.rootRef = snap.projRoot;
  if (snap.zoom && store.getRef(snap.zoom)) setZoom(snap.zoom);
  else if (snap.dayFocus) setDayFocus(snap.dayFocus);
  else { resetZoom(); clearDayFocus(); }
  renderAll();
}
function navBack(){
  if (!navHist.length) return false;
  navFuture.push(navSnapshot());
  navRestore(navHist.pop());
  return true;
}
function navForward(){
  if (!navFuture.length) return false;
  navHist.push(navSnapshot());
  navRestore(navFuture.pop());
  return true;
}
// ショートカット/ボタンからのビュー切替: 旧ペインのフォーカスを記憶→切替→新ビューのフォーカス復元。
function selectView(v){
  navPush();                        // 遷移前の状態を履歴へ（#1）
  captureFocus();
  showView(v);
  renderAll();
  restoreFocus(v);
}
// 分割の ON/OFF トグル。フォーカスを記憶→トグル→復元。
function toggleSplit(){
  captureFocus();
  splitOn = !splitOn;
  if (splitOn && (currentView === 'daily' || currentView === 'project')) splitRight = currentView;
  renderAll();
  restoreFocus(currentView);
}

// 完了カードの表示/非表示トグル（全ビュー共通）。フォーカスを保ったまま切替→再描画。
function toggleDone(){
  captureFocus();
  const hidden = toggleHideDone();
  renderAll();
  restoreFocus(currentView);
  showToast(hidden ? '完了を非表示にしました' : '完了を表示しました');
}

// ── フォーカス記憶/復元 ──
function focusToken(el){
  if (!el) return null;
  if (el.classList && el.classList.contains('proj-land-row')) return { kind:'proj', id: el.dataset.proj };
  if (el.dataset && el.dataset.ref) return { kind:'ref', id: el.dataset.ref };
  if (el.classList && el.classList.contains('day-head')) return { kind:'date', date: el.dataset.date };
  if (el.classList && el.classList.contains('zoom-title-txt')) return { kind:'title' };
  return null;
}
function captureFocus(){
  const ae = document.activeElement;
  if (!ae || !ae.closest) return;
  if (ae.closest('#view-list')) focusMem.list = ae.dataset.fkey || null;
  else if (ae.closest('#view-daily')) focusMem.daily = focusToken(ae);
  else if (ae.closest('#view-project')) focusMem.project = focusToken(ae);
}
function restoreFocus(v){
  if (v === 'list'){
    const key = focusMem.list;
    let el = key ? document.querySelector(`#view-list [data-fkey="${(window.CSS && CSS.escape) ? CSS.escape(key) : key}"]`) : null;
    // 記憶が無い時はリスト本体（テーブル内の先頭行）にフォーカス。ビューバー/条件バーの入力は対象外（#3）
    if (!el) el = document.querySelector('#view-list .list-table .nav-head, #view-list .list-table .cell-chip, #view-list .list-table input, #view-list .list-table [tabindex]');
    el && el.focus();
    return;
  }
  const cont = v === 'project' ? '#view-project' : '#view-daily';
  const tok = v === 'project' ? focusMem.project : focusMem.daily;
  if (tok && tok.kind === 'ref' && document.querySelector(`${cont} [data-ref="${tok.id}"]`)){ focusCard(tok.id, -1); return; }
  if (tok && tok.kind === 'date'){ const d = document.querySelector(`${cont} .day-head[data-date="${tok.date}"]`); if (d){ d.focus(); return; } }
  if (tok && tok.kind === 'proj'){ const r = document.querySelector(`${cont} .proj-land-row[data-proj="${tok.id}"]`); if (r){ r.focus(); return; } }
  const el = document.querySelector(`${cont} .zoom-title-txt, ${cont} .card-txt, ${cont} .day-head, ${cont} .card-block, ${cont} .proj-land-row`);
  el && el.focus();
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
  const sv = document.getElementById('view-search');
  app?.classList.toggle('split', splitOn);
  if (splitOn){
    // 左=リスト固定 / 右=デイリー or プロジェクト（splitRight）。両ペインを毎回再描画＝片側の変更がもう片側へ反映
    if (lv) lv.hidden = false;
    if (dv) dv.hidden = splitRight !== 'daily';
    if (pv) pv.hidden = splitRight !== 'project';
    if (sv) sv.hidden = true;                 // 検索は単独ビュー（分割対象外）
    if (lv) renderList(store, lv, renderAll, listState, zoomToCard, openProject);
    if (splitRight === 'project' && pv) renderProjectView(store, pv, renderAll, projState, jumpToCard);
    else if (dv) renderDaily(store, dv, renderAll, jumpToMention);
    applySplitRatio();
  } else {
    if (dv) dv.hidden = currentView !== 'daily';
    if (lv) lv.hidden = currentView !== 'list';
    if (pv) pv.hidden = currentView !== 'project';
    if (sv) sv.hidden = currentView !== 'search';
    if (currentView === 'daily' && dv) renderDaily(store, dv, renderAll, jumpToMention);
    if (currentView === 'list'  && lv) renderList(store, lv, renderAll, listState, zoomToCard, openProject);
    if (currentView === 'project' && pv) renderProjectView(store, pv, renderAll, projState, jumpToCard);
    if (currentView === 'search' && sv) renderSearchView(store, sv, renderAll, searchState, jumpToCard);
  }
  const doneBtn = document.getElementById('toggle-done-btn');
  if (doneBtn){
    const hidden = getHideDone();
    doneBtn.classList.toggle('active', hidden);
    doneBtn.textContent = hidden ? '✓ 完了を表示' : '✓ 完了を隠す';
    doneBtn.title = (hidden ? '完了カードを表示' : '完了カードを隠す') + '（Alt+H）';
  }
  document.getElementById('view-split-btn')?.classList.toggle('active', splitOn);
  document.getElementById('view-daily-btn')?.classList.toggle('active', currentView === 'daily');
  document.getElementById('view-list-btn')?.classList.toggle('active', currentView === 'list');
  document.getElementById('view-proj-btn')?.classList.toggle('active', currentView === 'project');
  document.getElementById('view-search-btn')?.classList.toggle('active', currentView === 'search');
  persistView();
  ensureViewFocus();               // どのビューでもキー操作用フォーカスを失わない安全網
}
// フォーカスが app 外（body等）へ落ちていたら、現在ビューの先頭要素へ戻す。編集中など app 内に在れば何もしない。
function focusActiveViewFirst(){
  const id = currentView === 'list' ? 'view-list' : currentView === 'project' ? 'view-project' : currentView === 'search' ? 'view-search' : 'view-daily';
  const cont = document.getElementById(id); if (!cont || cont.hidden) return;
  const el = cont.querySelector('.list-table .title-chip, .list-table .nav-head, .card-txt, .day-head, .card-block, .zoom-title-txt, .proj-land-row, .search-kw, .card-add, .proj-land-add, input, select, button, [tabindex]');
  if (el) el.focus();
}
function ensureViewFocus(){
  setTimeout(() => {
    const ae = document.activeElement;
    if (!ae || ae === document.body || !(ae.closest && ae.closest('#app'))) focusActiveViewFirst();
  }, 0);
}

function addToday(){
  const day = store.ensureDayCard(todayStr());
  const { ref } = store.createCard({ kind:'memo', content:'', parentRefId: day.ref.id });
  showView('daily');
  renderAll();
  focusCard(ref.id, 0);
}
function addProject(){
  const p = store.createProject('新規プロジェクト');
  projState.projId = p.id; projState.rootRef = null;
  showView('project');
  renderAll();
  const t = document.querySelector('#view-project .zoom-title-txt');   // 名前を全選択して即リネーム
  if (t){ t.focus(); const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}

// Ctrl+K パレット: カードへジャンプ（祖先を展開＋ズーム解除＋フォーカス）
function jumpToCard(bodyId){
  const refs = store.refsForBody(bodyId);
  if (!refs.length) return;
  navPush();                        // 遷移前の状態を履歴へ（#1）
  const ref = refs[0];
  let p = ref.parentRefId ? store.getRef(ref.parentRefId) : null;
  while (p){ if (p.collapsed) store.updateRef(p.id, { collapsed: false }); p = p.parentRefId ? store.getRef(p.parentRefId) : null; }
  let top = ref; while (top.parentRefId){ const pr = store.getRef(top.parentRefId); if (!pr) break; top = pr; }   // 所属の日を特定
  const dayBody = store.getBody(top.bodyId);
  resetZoom(); clearDayFocus();
  if (dayBody && dayBody.kind === 'day') revealDay(store, dayBody.content);   // 窓表示の外/折りたたみでも確実に描画
  showView('daily');
  renderAll();
  focusCard(ref.id, -1);
}
// リスト↗: そのノードにズームした状態でデイリーを開く（分割中は右ペインをデイリーに）
function zoomToCard(bodyId){
  const refs = store.refsForBody(bodyId);
  if (!refs.length) return;
  navPush();                        // 遷移前の状態を履歴へ（#1）
  const ref = refs[0];
  clearDayFocus();
  setZoom(ref.id);
  showView('daily');
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
function openProject(projId){             // プロジェクトのノートページを開く（分割中は右ペインをプロジェクトに）
  navPush();                        // 遷移前の状態を履歴へ（#1）
  projState.projId = projId; projState.rootRef = null;
  showView('project');
  renderAll();
}
function openSavedSearch(viewId){         // ⟦s:id⟧ チップ→ 検索ビューでその保存検索を実行
  const v = store.listViews().find(x => x.id === viewId && x.kind === 'search');
  if (!v) return;
  navPush();
  searchState.query = JSON.parse(JSON.stringify(v.query || {}));
  searchState._savedId = v.id;
  showView('search');
  renderAll();
}
function gotoDate(date){                  // カレンダー/コマンドからその日へ（全体表示でスクロール）
  navPush();                        // 遷移前の状態を履歴へ（#1）
  store.ensureDayCard(date);
  resetZoom(); clearDayFocus();
  revealDay(store, date);          // 窓表示の外/折りたたみでも、その日を展開して描画対象に含める
  showView('daily');
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
    { cat:'表示', label:'デイリーを表示', hint:'Alt+2', roma:'deiri hyouji daily', run: () => selectView('daily') },
    { cat:'表示', label:'リストを表示', hint:'Alt+1', roma:'risuto hyouji list', run: () => selectView('list') },
    { cat:'表示', label:'プロジェクトを表示', hint:'Alt+3', roma:'purojekuto hyouji project', run: () => selectView('project') },
    { cat:'表示', label:'分割表示の切替（リスト＋デイリー）', hint:'Alt+0', roma:'bunkatsu hyouji kirikae split', run: toggleSplit },
    { cat:'表示', label: getHideDone() ? '完了を表示' : '完了を隠す', hint:'Alt+H', roma:'kanryou hyouji kakusu done hide show', run: toggleDone },
    { cat:'表示', label:'今日へ移動', hint:'Alt+D', roma:'kyou idou today', run: () => gotoDate(todayStr()) },
    { cat:'表示', label:'日付へ移動（カレンダー）', roma:'hiduke idou karenda- calendar', run: () => openCalendar({ store, onPick: gotoDate }) },
    { cat:'追加', label:'今日に追加', roma:'kyou tsuika today add', run: addToday },
    { cat:'追加', label:'プロジェクトを追加', roma:'purojekuto tsuika project add', run: addProject },
    { cat:'追加', label:'表を挿入', roma:'hyou sounyuu table insert', run: () => insertTable(cardRef) },
    { cat:'設定', label:'GitHub同期設定', roma:'github douki settei sync setting', run: openSettings },
  ];
  const body = cardRef && store.getBody(store.getRef(cardRef)?.bodyId);
  if (cardRef && body){
    const id = body.id;
    cmds.push(
      { cat:'カード', label:'行メニューを開く', hint:'Alt+Enter', roma:'gyou menyu hiraku row menu open', run: () => dispatchCardKey(cardRef, { key:'Enter', altKey:true }) },
      { cat:'カード', label: body.kind === 'task' ? 'メモにする' : 'タスクにする', roma:'tasuku memo task', run: () => setCardAttr(id, { kind: body.kind === 'task' ? 'memo' : 'task' }, cardRef) },
      { cat:'カード', label:'完了の切替', hint:'Ctrl+Enter', roma:'kanryou kirikae done toggle', run: () => dispatchCardKey(cardRef, { key:'Enter', ctrlKey:true }) },
      { cat:'カード', label:'インデント', hint:'Tab', roma:'indento indent', run: () => dispatchCardKey(cardRef, { key:'Tab' }) },
      { cat:'カード', label:'アウトデント', hint:'Shift+Tab', roma:'autodento outdent', run: () => dispatchCardKey(cardRef, { key:'Tab', shiftKey:true }) },
      { cat:'カード', label:'上へ移動', hint:'Alt+Shift+↑', roma:'ue idou up move', run: () => dispatchCardKey(cardRef, { key:'ArrowUp', altKey:true, shiftKey:true }) },
      { cat:'カード', label:'下へ移動', hint:'Alt+Shift+↓', roma:'shita idou down move', run: () => dispatchCardKey(cardRef, { key:'ArrowDown', altKey:true, shiftKey:true }) },
      { cat:'カード', label:'折りたたみ', hint:'Ctrl+↑', roma:'oritatami collapse fold', run: () => dispatchCardKey(cardRef, { key:'ArrowUp', ctrlKey:true }) },
      { cat:'カード', label:'展開', hint:'Ctrl+↓', roma:'tenkai expand', run: () => dispatchCardKey(cardRef, { key:'ArrowDown', ctrlKey:true }) },
      { cat:'カード', label:'ズームイン', hint:'Alt+↓', roma:'zumu in zoom', run: () => dispatchCardKey(cardRef, { key:'ArrowDown', altKey:true }) },
      { cat:'カード', label:'ズームアウト', hint:'Alt+↑', roma:'zumu auto zoom out', run: () => dispatchCardKey(cardRef, { key:'ArrowUp', altKey:true }) },
      { cat:'カード', label:'削除', hint:'Ctrl+Shift+Backspace', roma:'sakujo delete', run: () => dispatchCardKey(cardRef, { key:'Backspace', ctrlKey:true, shiftKey:true }) },
      { cat:'優先度', label:'高', roma:'takai kou high priority', run: () => setCardAttr(id, { prio:3 }, cardRef) },
      { cat:'優先度', label:'中', roma:'chuu naka mid medium priority', run: () => setCardAttr(id, { prio:2 }, cardRef) },
      { cat:'優先度', label:'低', roma:'hikui tei low priority', run: () => setCardAttr(id, { prio:1 }, cardRef) },
      { cat:'優先度', label:'なし', roma:'nashi none priority', run: () => setCardAttr(id, { prio:0 }, cardRef) },
      { cat:'期限', label:'今日', roma:'kyou today due', run: () => setCardAttr(id, { due: todayStr() }, cardRef) },
      { cat:'期限', label:'明日', roma:'ashita asu tomorrow due', run: () => setCardAttr(id, { due: addDays(1) }, cardRef) },
      { cat:'期限', label:'来週', roma:'raishuu nextweek due', run: () => setCardAttr(id, { due: addDays(7) }, cardRef) },
      { cat:'期限', label:'なし', roma:'nashi none due', run: () => setCardAttr(id, { due: '' }, cardRef) },
      ...store.listProjects().map(p => ({ cat:'プロジェクト割当', label: p.content || 'PJ', roma: (p.content || 'pj').toLowerCase() + ' wariate assign', run: () => setCardAttr(id, { proj: p.id }, cardRef) })),
      { cat:'プロジェクト割当', label:'割当なし', roma:'wariate nashi none assign', run: () => setCardAttr(id, { proj: undefined }, cardRef) },
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
  document.getElementById('view-daily-btn')?.addEventListener('click', () => selectView('daily'));
  document.getElementById('view-list-btn')?.addEventListener('click', () => selectView('list'));
  document.getElementById('view-proj-btn')?.addEventListener('click', () => selectView('project'));
  document.getElementById('view-search-btn')?.addEventListener('click', () => selectView('search'));
  document.getElementById('view-split-btn')?.addEventListener('click', toggleSplit);
  document.getElementById('toggle-done-btn')?.addEventListener('click', toggleDone);
  installDividerDrag();
  setMentionJump(jumpToMention);                 // @チップ/バックリンクのクリック先（全ビュー共通）
  setAgendaJump(jumpToCard);                      // アジェンダ↗（元の場所へ）＝該当カードへジャンプ
  setSavedSearchOpener(openSavedSearch);         // ⟦s:id⟧ チップ→保存検索を開く
  setImageLoader(GH.ghFetchImageURL);            // 画像カード: repoパス→表示URL
  document.getElementById('add-today')?.addEventListener('click', addToday);
  document.getElementById('add-proj')?.addEventListener('click', addProject);
  document.addEventListener('keydown', (e) => {              // Alt+1/2/3=ビュー切替 / Alt+0=分割 / Alt+D=今日 / Ctrl/⌘+K,E
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey){
      if (e.code === 'Digit1'){ e.preventDefault(); selectView('list'); return; }     // リスト（分割中は左へフォーカス）
      if (e.code === 'Digit2'){ e.preventDefault(); selectView('daily'); return; }    // デイリー（分割中は右をデイリーに）
      if (e.code === 'Digit3'){ e.preventDefault(); selectView('project'); return; }  // プロジェクト（分割中は右をプロジェクトに）
      if (e.code === 'Digit0'){ e.preventDefault(); toggleSplit(); return; }          // 分割 ON/OFF トグル
      if (e.key === 'h' || e.key === 'H'){ e.preventDefault(); toggleDone(); return; }   // 完了の表示/非表示トグル（全ビュー共通）
      if (e.key === 'ArrowLeft'){ e.preventDefault(); navBack(); return; }            // 前の画面に戻る（#1・ブラウザ戻る抑止）
      if (e.key === 'ArrowRight'){ e.preventDefault(); navForward(); return; }        // 次の画面へ進む（#1）
      if (e.key === 'd' || e.key === 'D'){ e.preventDefault(); gotoDate(todayStr()); return; }   // 今日のデイリーへ
      if (e.key === 'v' || e.key === 'V'){                                                       // リスト表示中: 保存ビュー選択欄へ（#4・選択後はリスト本体へ復帰）
        const sel = document.querySelector('#view-list .view-select');
        if (sel && sel.offsetParent !== null){ e.preventDefault(); sel.focus(); return; }
      }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey){                 // Ctrl/⌘+Z=取り消し / Ctrl/⌘+Y・Shift+Z=やり直し
      const kk = (e.key || '').toLowerCase();
      if (kk === 'z' && !e.shiftKey){ e.preventDefault(); if (store.undo()){ renderAll(); showToast('取り消しました'); } return; }
      if (kk === 'y' || (kk === 'z' && e.shiftKey)){ e.preventDefault(); if (store.redo()){ renderAll(); showToast('やり直しました'); } return; }
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

  installClipboard(store, renderAll, focusCard, clearSelection, { uploadImage: GH.ghUploadImage, serializeEditable, caretOffset });   // コピー/カット/貼り付け＋画像＋書式検出
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
