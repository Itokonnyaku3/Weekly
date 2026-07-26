// 週次ビュー: 縦=プロジェクト / 横=週 のマトリクス。
// データの正はデイリー/PJページのカードのままで、ここは「振り分けて見せる」だけ（派生ビュー）。
// 純ロジック（週キー・集約・カーソル移動・週報）は week.js。ここは描画とイベントに専念する。
//
// セルは2モード:
//  ・コンパクト（既定）… 1件1行の軽量レンダラ。矢印キーで自由移動し Enter で決定（ナビモード）
//  ・展開（Alt+↓/⤢）  … daily.js の renderChildren に差し替えて実体アウトラインとして編集（同時に1セルだけ）
// 繰越（over）は「参照行」として描き data-ref を付けない
//  ＝同一 refId が DOM に2つあると focusCard が誤爆するため（元の週と繰越先の両方に出るので必須の制約）。
const _q = new URL(import.meta.url).search;
const { buildWeeklyGrid, weeksFor, weekLabel, weekAdd, weekStart, moveCursor,
        toggleMsContent, buildWeekReport, FIRST_WEEK_COL, MS_TAG } = await import('./week.js' + _q);
const { renderChildren, setNavContainer, focusCard, getHideDone } = await import('./daily.js' + _q);
const { showToast, copyRichText } = await import('./clipboard.js' + _q);
const { projColor, tintRgba } = await import('./colors.js' + _q);   // リストと共通のプロジェクト色

const todayStr = () => new Date().toISOString().slice(0, 10);
const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s);
// 表示用テキスト: #マイルストーン は 🏁 ブロックで表しているので本文からは落とす（他のタグは情報なので残す）。
// 生テキストは span.dataset.raw に持ち、編集開始時にそれを戻す（list.js のタグ表示と同じ流儀＝直列化を壊さない）。
const _msRe = new RegExp('\\s*#' + MS_TAG + '(?=\\s|$)', 'g');
const displayText = (content) => String(content || '').replace(_msRe, '').trim();

// 外から差し込む遷移（app.js が設定）
let _onOpenProject = null;        // (projId) => void
let _onOpenProjectAt = null;      // (projId, refId) => void  PJページをそのノードにズームして開く
let _onJump = null;               // (bodyId) => void         元の場所（デイリー）へ
let _navPush = null;              // () => void               遷移前の状態をナビ履歴へ（Alt+←/→ で戻れる）
export function setWeeklyHandlers({ openProject, openProjectAt, jump, navPush } = {}){
  _onOpenProject = openProject || null;
  _onOpenProjectAt = openProjectAt || null;
  _onJump = jump || null;
  _navPush = navPush || null;
}

// ブロックの定義（表示順）。add はブロックの「＋」で作るカードの種類・ref:true は参照行（編集不可）
const BLOCKS = [
  { key:'ms',   label:'🏁 マイルストーン', cls:'wk-b-ms' },
  { key:'todo', label:'□ やること',        cls:'wk-b-todo', add:'todo' },
  { key:'done', label:'✓ やったこと',      cls:'wk-b-done', add:'done' },
  { key:'memo', label:'📝 メモ',           cls:'wk-b-memo', add:'memo' },
  { key:'over', label:'↩ 期限切れ',        cls:'wk-b-over', ref:true },
];

// ── モジュール状態（描画のたびに差し替え）──
let _mount = null, _store = null, _render = null, _state = null;
let _cursor = { row: null, colIdx: FIRST_WEEK_COL, idx: 0 };
let _shape = { rows: [], cols: [], counts: new Map() };
let _editing = null;                                  // 編集中の bodyId（null=ナビモード）
let _dragItem = null, _dropHi = null;

export function renderWeeklyView(store, mount, requestRender, state){
  const today = todayStr();
  const weeks = weeksFor(today, state.wkOff || 0);
  const grid = buildWeeklyGrid(store, { weeks, today, hideEmpty: !!state.hideEmpty });

  _mount = mount; _store = store; _render = requestRender; _state = state;
  _editing = null;                                    // 再描画で編集中の要素は失われる
  mount.innerHTML = '';
  mount.appendChild(buildBar(store, requestRender, state, grid, weeks, today));

  const scroll = document.createElement('div'); scroll.className = 'wk-scroll';
  const table = document.createElement('table'); table.className = 'wk-table';
  if (!state.cols) state.cols = { ...COL_DEFAULTS };      // 古い保存状態でも落ちない
  applyColWidths(table, state);
  table.appendChild(buildHead(grid, state));
  const tbody = document.createElement('tbody');
  for (const row of grid.rows) tbody.appendChild(buildRow(store, requestRender, state, row, grid));
  table.appendChild(tbody);
  scroll.appendChild(table);
  mount.appendChild(scroll);

  if (!grid.rows.length){
    const e = document.createElement('p'); e.className = 'wk-empty';
    e.textContent = state.hideEmpty
      ? '表示範囲に内容のあるプロジェクトがありません（「空PJを表示」で全件表示）。'
      : 'プロジェクトがありません。ツールバーの「＋ プロジェクト」で作成してください。';
    mount.appendChild(e);
  }

  _shape = buildShape(mount, grid);
  if (_cursor.row == null && _shape.rows.length) _cursor = { row: _shape.rows[0], colIdx: FIRST_WEEK_COL, idx: 0 };
  if (!mount.dataset.wkWired){                        // クリック等でもカーソルを同期（マウスとキーがずれない）
    mount.dataset.wkWired = '1';                      // mount は再利用されるので登録は1回だけ（リスナの積み重ねを防ぐ）
    mount.addEventListener('focusin', (ev) => {
      const it = ev.target.closest && ev.target.closest('.wk-item');
      if (it && !_editing) syncCursorFrom(it);
    });
  }
  if (!state.expanded) setTimeout(applyCursor, 0);    // 展開中は展開側にフォーカスを譲る
}

// ── ビューバー（週送り／今週／空PJ／週報コピー）──
function buildBar(store, requestRender, state, grid, weeks, today){
  const bar = document.createElement('div'); bar.className = 'wk-bar';
  const mkBtn = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn wk-btn'; b.textContent = label; b.title = title;
    b.onclick = fn; bar.appendChild(b); return b;
  };
  mkBtn('◀ 前週', '前の週へ（Alt+Shift+←）', () => pageWeeks(state, requestRender, -1));
  mkBtn('今週', '今週へ（Alt+0）', () => gotoThisWeek(state, requestRender));
  mkBtn('次週 ▶', '次の週へ（Alt+Shift+→）', () => pageWeeks(state, requestRender, 1));

  const range = document.createElement('span'); range.className = 'wk-range';
  range.textContent = weekLabel(weeks[0]) + ' 〜 ' + weekLabel(weeks[weeks.length - 1]);
  bar.appendChild(range);

  const sp = document.createElement('span'); sp.className = 'spacer'; bar.appendChild(sp);

  const chk = document.createElement('label'); chk.className = 'wk-chk';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !state.hideEmpty;
  cb.onchange = () => { state.hideEmpty = !cb.checked; savePrefs(state); requestRender(); };
  chk.appendChild(cb); chk.appendChild(document.createTextNode(' 空PJを表示'));
  bar.appendChild(chk);

  mkBtn('📋 週報コピー', 'この週のまとめをコピー（HTML＋テキスト）', () => {
    const cur = weekStart(today);
    const wk = weeks.includes(cur) ? cur : weeks[0];
    const r = buildWeekReport(grid, wk);
    if (!r.plain){ showToast('この週には内容がありません'); return; }
    copyRichText(r.html, r.plain).then(ok => showToast(ok ? '週報をコピーしました' : 'コピーに失敗しました'));
  });
  return bar;
}
export function pageWeeks(state, requestRender, d){
  if (_navPush) _navPush();                     // 週送りもナビ履歴（Alt+←/→）で戻れるように
  state.wkOff = (state.wkOff || 0) + d;
  savePrefs(state);
  requestRender();
}
export function gotoThisWeek(state, requestRender){
  if (!state.wkOff) return;                     // すでに今週なら履歴を汚さない
  if (_navPush) _navPush();
  state.wkOff = 0;
  savePrefs(state);
  requestRender();
}
function savePrefs(state){
  try {
    localStorage.setItem('pwt2_wkOff', String(state.wkOff || 0));
    localStorage.setItem('pwt2_wkHideEmpty', state.hideEmpty ? '1' : '0');
  } catch {}
}
// ── 列幅（ヘッダ右端のドラッグで変更・localStorage に保存）──
// 既定値と可動範囲。week は全週列に一律で効く（週ごとに違う幅にはしない＝比較しやすさを保つ）
export const COL_DEFAULTS = { proj: 200, link: 160, week: 240 };
const COL_RANGE = { proj: [120, 520], link: [60, 520], week: [140, 640] };
const COL_VAR = { proj: '--wk-w-proj', link: '--wk-w-link', week: '--wk-w-week' };
const clampCol = (which, px) => Math.round(Math.min(Math.max(px, COL_RANGE[which][0]), COL_RANGE[which][1]));

function applyColWidths(table, state){
  for (const which of ['proj', 'link', 'week']){
    table.style.setProperty(COL_VAR[which], (state.cols[which] || COL_DEFAULTS[which]) + 'px');
  }
}
function saveCols(state){
  try { localStorage.setItem('pwt2_wkCols', JSON.stringify(state.cols)); } catch {}
}
// ヘッダ右端のドラッグハンドル。ドラッグ中は再描画せず CSS 変数だけ書き換える（滑らかに動かすため）
function addResizeHandle(th, which, state){
  const h = document.createElement('div');
  h.className = 'wk-resize';
  h.title = 'ドラッグで幅を変更（ダブルクリックで既定に戻す）'
          + (which === 'week' ? ' ※すべての週列に適用' : '');
  h.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const table = th.closest('.wk-table');
    const x0 = e.clientX, w0 = state.cols[which] || COL_DEFAULTS[which];
    h.setPointerCapture(e.pointerId);
    h.classList.add('dragging');
    const onMove = (ev) => {
      state.cols[which] = clampCol(which, w0 + (ev.clientX - x0));
      applyColWidths(table, state);
    };
    const onUp = () => {
      h.classList.remove('dragging');
      try { h.releasePointerCapture(e.pointerId); } catch {}
      h.removeEventListener('pointermove', onMove);
      h.removeEventListener('pointerup', onUp);
      saveCols(state);
    };
    h.addEventListener('pointermove', onMove);
    h.addEventListener('pointerup', onUp);
  });
  h.addEventListener('dblclick', (e) => {
    e.preventDefault(); e.stopPropagation();
    state.cols[which] = COL_DEFAULTS[which];
    applyColWidths(th.closest('.wk-table'), state);
    saveCols(state);
  });
  th.appendChild(h);
}

// UI設定として localStorage に保存（undo履歴・GitHub同期には乗せない）
export function loadWeeklyPrefs(){
  const st = { wkOff: 0, hideEmpty: false, expanded: null, cols: { ...COL_DEFAULTS } };
  try {
    const o = parseInt(localStorage.getItem('pwt2_wkOff'), 10);
    if (Number.isFinite(o)) st.wkOff = o;
    st.hideEmpty = localStorage.getItem('pwt2_wkHideEmpty') === '1';
    const c = JSON.parse(localStorage.getItem('pwt2_wkCols') || 'null');
    if (c) for (const which of ['proj', 'link', 'week']){
      if (Number.isFinite(c[which])) st.cols[which] = clampCol(which, c[which]);   // 壊れた値は既定/範囲内に補正
    }
  } catch {}
  return st;
}

// ── ヘッダ行 ──
function buildHead(grid, state){
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  const th1 = document.createElement('th'); th1.className = 'wk-th wk-c-proj'; th1.textContent = 'プロジェクト';
  const th2 = document.createElement('th'); th2.className = 'wk-th wk-c-link'; th2.textContent = 'リンク';
  addResizeHandle(th1, 'proj', state);
  addResizeHandle(th2, 'link', state);
  tr.appendChild(th1); tr.appendChild(th2);
  grid.weeks.forEach((w, i) => {
    const th = document.createElement('th');
    th.className = 'wk-th wk-c-week' + (w.isCurrent ? ' wk-current' : '');
    const l = document.createElement('div'); l.className = 'wk-th-label'; l.textContent = w.label;
    th.appendChild(l);
    if (w.isCurrent){ const n = document.createElement('div'); n.className = 'wk-th-now'; n.textContent = '今週'; th.appendChild(n); }
    if (i === 0) addResizeHandle(th, 'week', state);      // 先頭の週列で全週列の幅を調整
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  return thead;
}

// ── 1プロジェクト行 ──
// 行の色: リストのPJ見出しと同じプロジェクト色を、薄く（半透明で重ねて）行の背景にする。
// PJ列は少し濃め＋左端に色帯＝リストの色地と視覚的に対応づける。
const TINT_ALPHA = 0.10, TINT_ALPHA_PROJ = 0.18;

function buildRow(store, requestRender, state, row, grid){
  const tr = document.createElement('tr');
  tr.className = 'wk-row' + (row.projId ? '' : ' wk-row-none');
  tr.dataset.row = row.projId || '__none';
  const color = projColor(row.projId);                       // 未割当は PROJ_NONE_COLOR（グレー）
  tr.style.setProperty('--pjc', color);
  tr.style.setProperty('--wk-tint', tintRgba(color, TINT_ALPHA));
  tr.style.setProperty('--wk-tint2', tintRgba(color, TINT_ALPHA_PROJ));
  tr.appendChild(buildProjCell(store, requestRender, row));
  tr.appendChild(buildLinkCell(row));
  for (const w of grid.weeks) tr.appendChild(buildWeekCell(store, requestRender, state, row, w));
  return tr;
}

function buildProjCell(store, requestRender, row){
  const td = document.createElement('td'); td.className = 'wk-cell wk-c-proj';
  td.dataset.col = 'proj'; td.dataset.row = row.projId || '__none';
  const title = document.createElement('div');
  title.className = 'wk-item wk-proj-title'; title.tabIndex = -1;
  title.dataset.act = row.projId ? 'proj' : 'none';
  title.dataset.proj = row.projId || '';
  const nm = document.createElement('span'); nm.className = 'wk-tx';
  nm.textContent = row.proj ? ('📕 ' + (row.proj.content || '(無題)')) : '未割当';
  title.appendChild(nm);
  if (row.projId){
    title.title = 'Enter / クリックでプロジェクトを開く';
    title.onclick = () => _onOpenProject && _onOpenProject(row.projId);
    const mv = document.createElement('span'); mv.className = 'wk-proj-move';
    for (const [label, dir, tip] of [['▲', -1, '上へ'], ['▼', 1, '下へ']]){
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'wk-mv'; b.textContent = label;
      b.title = tip + '（プロジェクト一覧の並び順）';
      b.onclick = (e) => { e.stopPropagation(); if (store.moveProject(row.projId, dir)) requestRender(); };
      mv.appendChild(b);
    }
    title.appendChild(mv);
  }
  td.appendChild(title);
  for (const k of row.kids){
    const it = document.createElement('div');
    it.className = 'wk-item wk-proj-kid'; it.tabIndex = -1;
    it.dataset.act = 'kid'; it.dataset.kidRef = k.ref.id; it.dataset.proj = row.projId;
    const tx = document.createElement('span'); tx.className = 'wk-tx';
    tx.textContent = k.body.content || '(空)';
    it.appendChild(tx);
    it.title = 'Enter / クリックでこのノードを開く';
    it.onclick = () => _onOpenProjectAt && _onOpenProjectAt(row.projId, k.ref.id);
    td.appendChild(it);
  }
  return td;
}

function buildLinkCell(row){
  const td = document.createElement('td'); td.className = 'wk-cell wk-c-link';
  td.dataset.col = 'link'; td.dataset.row = row.projId || '__none';
  if (!row.links.length){
    const ph = document.createElement('div');
    ph.className = 'wk-item wk-ph'; ph.tabIndex = -1; ph.dataset.act = 'none';
    td.appendChild(ph);
    return td;
  }
  for (const l of row.links){
    const it = document.createElement('div');
    it.className = 'wk-item wk-link'; it.tabIndex = -1;
    it.dataset.act = 'link'; it.dataset.url = l.body.url || ''; it.dataset.kidRef = l.ref.id;
    it.dataset.proj = row.projId || '';
    const tx = document.createElement('span'); tx.className = 'wk-tx';
    tx.textContent = '- ' + (l.body.content || '(空)');
    it.appendChild(tx);
    it.title = l.body.url || 'Enter / クリックでこのノードを開く';
    it.onclick = () => openLink(it);
    td.appendChild(it);
  }
  return td;
}
export function openLink(el){
  const url = el.dataset.url;
  if (url) window.open(url, '_blank', 'noopener');
  else if (_onOpenProjectAt && el.dataset.proj) _onOpenProjectAt(el.dataset.proj, el.dataset.kidRef);
}

// ── 週セル ──
function buildWeekCell(store, requestRender, state, row, w){
  const td = document.createElement('td');
  td.className = 'wk-cell wk-c-week' + (w.isCurrent ? ' wk-current' : '');
  td.dataset.col = w.wk; td.dataset.row = row.projId || '__none';
  const rowId = row.projId || '__none';
  const cell = row.cells[w.wk];
  const expKey = rowId + '|' + w.wk;

  if (state.expanded === expKey){                     // 展開中: 実体アウトライン（daily.js の描画を流用）
    td.classList.add('wk-expanded');
    const head = document.createElement('div'); head.className = 'wk-exp-head';
    const t = document.createElement('span'); t.textContent = '⤢ ' + w.label + '（Escapeで戻る）';
    head.appendChild(t);
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'wk-exp-close'; close.textContent = '×'; close.title = '畳む（Escape）';
    close.onclick = () => { state.expanded = null; requestRender(); applyCursor(); };
    head.appendChild(close);
    td.appendChild(head);
    const refs = [];                                  // 参照行（over）は実体化しない＝同一refIdをDOMに2つ作らない
    for (const B of BLOCKS){ if (B.ref) continue; for (const e of (cell[B.key] || [])) refs.push(e.ref); }
    if (refs.length) renderChildren(store, null, td, 0, requestRender, { refs, mirrorRoot: true });
    else { const p = document.createElement('div'); p.className = 'wk-exp-empty'; p.textContent = '(この週のカードはありません)'; td.appendChild(p); }
    setNavContainer(td, requestRender);               // ↑↓が別ビューのコンテナを掴まないように（v0.93.0の教訓）
    return td;
  }

  setupCellDrop(td, store, requestRender, rowId, w.wk);
  const hideDone = getHideDone();
  let n = 0;
  for (const B of BLOCKS){
    let items = cell[B.key] || [];
    // 完了非表示（Alt+H）は「やったこと」には適用しない（完了専用ブロックなので常に空になる）
    if (hideDone && B.key !== 'done') items = items.filter(e => !e.body.done);
    if (!items.length) continue;
    const bl = document.createElement('div'); bl.className = 'wk-block ' + B.cls;
    const h = document.createElement('div'); h.className = 'wk-block-h';
    const ht = document.createElement('span'); ht.textContent = B.label; h.appendChild(ht);
    if (B.add){
      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'wk-add'; plus.textContent = '＋';
      plus.title = B.label.replace(/^\S+\s*/, '') + 'に追加';
      plus.onclick = (ev) => { ev.stopPropagation(); addToCell(rowId, w.wk, B.add); };
      h.appendChild(plus);
    }
    bl.appendChild(h);
    for (const e of items){ bl.appendChild(buildItem(store, requestRender, e, B, rowId, w)); n++; }
    td.appendChild(bl);
  }
  const ph = document.createElement('div');           // 空セルもスロット1（フォーカス＆追加できる）
  ph.className = 'wk-item wk-ph' + (n ? ' wk-add-row' : '');
  ph.tabIndex = -1; ph.dataset.act = 'add';
  ph.dataset.row = rowId; ph.dataset.wk = w.wk;
  ph.title = 'Enter / クリックでこの週にタスクを追加';
  ph.onclick = () => addToCell(rowId, w.wk, 'todo');
  td.appendChild(ph);

  if (n){
    const ex = document.createElement('button');
    ex.type = 'button'; ex.className = 'wk-exp-btn'; ex.textContent = '⤢';
    ex.title = 'このセルを展開して編集（Alt+↓）';
    ex.onclick = (ev) => { ev.stopPropagation(); expandCell(rowId, w.wk); };
    td.appendChild(ex);
  }
  return td;
}

// 1件の行。over（繰越）は参照行＝data-item-ref を持たず編集・ドラッグ不可
function buildItem(store, requestRender, e, B, rowId, w){
  const it = document.createElement('div');
  it.className = 'wk-item wk-i-' + B.key; it.tabIndex = -1;
  it.dataset.act = 'card'; it.dataset.body = e.body.id;
  it.dataset.row = rowId; it.dataset.wk = w.wk; it.dataset.block = B.key;
  if (B.ref) it.dataset.overRef = e.ref.id; else it.dataset.itemRef = e.ref.id;

  if (!B.ref){
    it.draggable = true;
    it.addEventListener('dragstart', (ev) => {
      _dragItem = { refId: e.ref.id, bodyId: e.body.id };
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', e.body.id); } catch(_){}
    });
    it.addEventListener('dragend', () => { _dragItem = null; clearDropHi(); });
  }

  if (e.body.kind === 'task'){
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'wk-cb'; cb.checked = !!e.body.done;
    cb.onclick = (ev) => ev.stopPropagation();
    cb.onchange = () => { syncCursorFrom(it); store.updateBody(e.body.id, { done: cb.checked }); requestRender(); applyCursor(); };
    it.appendChild(cb);
  } else {
    const dot = document.createElement('span'); dot.className = 'wk-dot'; it.appendChild(dot);
  }
  const tx = document.createElement('span');
  tx.className = 'wk-tx' + (e.body.done ? ' done' : '');
  tx.dataset.raw = e.body.content || '';
  tx.textContent = displayText(e.body.content) || '(空)';
  it.appendChild(tx);

  const kids = store.childRefs(e.ref.id).length;
  if (kids){ const b = document.createElement('span'); b.className = 'wk-badge'; b.textContent = String(kids); b.title = '子カード ' + kids + ' 件（⤢ で展開）'; it.appendChild(b); }
  if (e.body.due){ const b = document.createElement('span'); b.className = 'wk-badge wk-due'; b.textContent = '📅' + e.body.due.slice(5); it.appendChild(b); }
  if (B.key === 'over'){ const b = document.createElement('span'); b.className = 'wk-badge wk-from'; b.textContent = weekLabel(e.wk).split('〜')[0] + '週'; b.title = '元の週'; it.appendChild(b); }

  if (!B.ref && e.body.kind === 'task'){              // ⏩ 翌週へ延期
    const pp = document.createElement('button');
    pp.type = 'button'; pp.className = 'wk-pp'; pp.textContent = '⏩';
    pp.title = '翌週へ延期（Ctrl+Shift+→）';
    pp.onmousedown = (ev) => ev.preventDefault();
    pp.onclick = (ev) => {
      ev.stopPropagation();
      setCardWeek(store, e.ref, e.body, weekAdd(w.wk, 1));
      requestRender(); showToast('翌週へ移しました');
    };
    it.appendChild(pp);
  }
  if (_onJump){                                       // ↗ 元の場所（デイリー）へ
    const jb = document.createElement('button');
    jb.type = 'button'; jb.className = 'wk-jump'; jb.textContent = '↗';
    jb.title = '元の場所（デイリー）へ（Alt+Enter）';
    jb.onmousedown = (ev) => ev.preventDefault();
    jb.onclick = (ev) => { ev.stopPropagation(); _onJump(e.body.id); };
    it.appendChild(jb);
  }
  return it;
}

// ── カーソル（ナビモード）──
// 矢印キーでは再描画せず DOM フォーカスだけ動かす（軽快さの維持）。
// データを変えたときだけ requestRender() → 描画後に applyCursor() で復帰する。
function buildShape(mount, grid){
  const rows = grid.rows.map(r => r.projId || '__none');
  const cols = ['proj', 'link', ...grid.weeks.map(w => w.wk)];
  const counts = new Map();
  for (const rowId of rows) for (const colId of cols){
    const n = itemsAt(rowId, colId, mount).length;
    counts.set(rowId + '|' + colId, n || 1);
  }
  return { rows, cols, counts };
}
function cellEl(rowId, colId, mount){
  const m = mount || _mount;
  return m && m.querySelector(`.wk-row[data-row="${cssEsc(rowId)}"] .wk-cell[data-col="${cssEsc(colId)}"]`);
}
function itemsAt(rowId, colId, mount){
  const c = cellEl(rowId, colId, mount);
  return c ? [...c.querySelectorAll('.wk-item')] : [];
}
// カーソルの位置に実際にフォーカスを当てる（行/列が消えていたら近傍にクランプ）
export function applyCursor(){
  // 編集中は割り込まない。addToCell は _render()（＝applyCursor を予約）→ startEdit の順に走るため、
  // このガードが無いと予約された applyCursor が編集開始直後のフォーカスを奪ってしまう。
  if (_editing) return;
  if (!_shape.rows.length || _state?.expanded) return;
  if (_shape.rows.indexOf(_cursor.row) < 0) _cursor.row = _shape.rows[0];
  _cursor.colIdx = Math.min(Math.max(_cursor.colIdx | 0, 0), _shape.cols.length - 1);
  const items = itemsAt(_cursor.row, _shape.cols[_cursor.colIdx]);
  if (!items.length) return;
  _cursor.idx = Math.min(Math.max(_cursor.idx | 0, 0), items.length - 1);
  const el = items[_cursor.idx];
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block:'nearest', inline:'nearest' });
}
function syncCursorFrom(el){
  const cell = el.closest('.wk-cell'), rowEl = el.closest('.wk-row');
  if (!cell || !rowEl) return;
  const ci = _shape.cols.indexOf(cell.dataset.col);
  if (ci < 0) return;
  _cursor = { row: rowEl.dataset.row, colIdx: ci, idx: [...cell.querySelectorAll('.wk-item')].indexOf(el) };
}

// ── 決定（Enter）──
function activate(el){
  switch (el.dataset.act){
    case 'proj': if (_onOpenProject && el.dataset.proj) _onOpenProject(el.dataset.proj); return;
    case 'kid':  if (_onOpenProjectAt) _onOpenProjectAt(el.dataset.proj, el.dataset.kidRef); return;
    case 'link': openLink(el); return;
    case 'add':  addToCell(el.dataset.row, el.dataset.wk, 'todo'); return;
    case 'card':
      if (el.dataset.overRef){ if (_onJump) _onJump(el.dataset.body); return; }   // 参照行は元の場所へ
      startEdit(el);
      return;
  }
}

// ── 編集モード（Enter で開始 / Escape で戻る）──
// contenteditable は「編集中の1行だけ」に付ける（常時ONにしない＝矢印キーがキャレットに食われない）
function startEdit(el){
  const tx = el.querySelector('.wk-tx'); if (!tx) return;
  const bodyId = el.dataset.body;
  _editing = bodyId;
  el.classList.add('wk-editing');
  tx.contentEditable = 'true';
  tx.spellcheck = false;
  tx.textContent = tx.dataset.raw || '';          // 編集中は生テキスト（#マイルストーン を消さない）
  tx.focus();
  const r = document.createRange(); r.selectNodeContents(tx); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  tx.oninput = () => {
    tx.dataset.raw = tx.textContent || '';
    _store.updateBody(bodyId, { content: tx.dataset.raw });
  };
  tx.onblur = () => endEdit(el);
  tx.onkeydown = (ev) => {
    if (ev.isComposing) return;
    if (ev.key === 'Escape'){
      ev.preventDefault(); ev.stopPropagation();
      endEdit(el); syncCursorFrom(el); el.focus();
      return;
    }
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey){
      ev.preventDefault(); ev.stopPropagation();
      const row = el.dataset.row, wk = el.dataset.wk, block = el.dataset.block || 'todo';
      endEdit(el);
      addToCell(row, wk, block === 'ms' ? 'todo' : block);   // 同じブロックに次の行を作り編集を継続
      return;
    }
    ev.stopPropagation();                                     // 他のキーはグリッドへ渡さない
  };
}
function endEdit(el){
  const tx = el && el.querySelector('.wk-tx');
  if (tx){
    tx.contentEditable = 'false'; tx.oninput = null; tx.onblur = null; tx.onkeydown = null;
    tx.textContent = displayText(tx.dataset.raw) || '(空)';   // 表示テキストへ戻す
  }
  if (el) el.classList.remove('wk-editing');
  _editing = null;
}

// ── セルへの追加 ──
// 今日の day カード直下に作り proj を割当。そのセルが今週以外なら gridWk で表示週を固定する。
export function addToCell(rowId, wk, blockKey){
  if (!_store) return;
  const today = todayStr();
  const day = _store.ensureDayCard(today);
  const attrs = { kind: blockKey === 'memo' ? 'memo' : 'task', content: '', parentRefId: day.ref.id };
  if (rowId && rowId !== '__none') attrs.proj = rowId;
  if (blockKey === 'done') attrs.done = true;
  if (wk && wk !== weekStart(today)) attrs.gridWk = wk;       // 今週以外のセル＝表示週を明示
  const { body } = _store.createCard(attrs);
  _render();
  const el = _mount && _mount.querySelector(`.wk-item[data-body="${cssEsc(body.id)}"]`);
  if (el){ syncCursorFrom(el); el.focus(); startEdit(el); }
  else showToast('追加しました（現在の表示範囲では見えません）');
}

// ── セルの展開 ──
function expandCell(rowId, wk){
  _state.expanded = rowId + '|' + wk;
  _render();
  const fc = _mount.querySelector('.wk-expanded .card-txt');   // 展開後は先頭カードへ
  if (fc && fc.dataset.ref) focusCard(fc.dataset.ref, 0);
}
function collapseCell(){
  if (!_state.expanded) return false;
  _state.expanded = null;
  _render();
  applyCursor();
  return true;
}

// ── 週の付け替え ──
// 期限があるカードは期限そのものを移動先週の同じ曜日へずらす（期限が意味を持つため）。
// 期限が無いカードは ref.gridWk で表示週だけを固定する。
export function setCardWeek(store, ref, body, wk){
  if (!ref || !body || !wk) return;
  if (body.due){
    const cur = weekStart(body.due);
    const offset = Math.round((Date.parse(body.due + 'T00:00:00') - Date.parse(cur + 'T00:00:00')) / 86400000);
    const d = new Date(Date.parse(wk + 'T00:00:00')); d.setDate(d.getDate() + offset);
    const p = (x) => String(x).padStart(2, '0');
    store.updateBody(body.id, { due: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) });
    if (ref.gridWk) store.updateRef(ref.id, { gridWk: undefined });   // 期限が正になるので上書きは外す
  } else {
    store.updateRef(ref.id, { gridWk: wk });
  }
}
export function setCardProj(store, body, projId){
  store.updateBody(body.id, { proj: projId && projId !== '__none' ? projId : undefined });
}

// ── セルへのドロップ（週の付け替え／別PJ行なら proj も変更）──
function clearDropHi(){ if (_dropHi){ _dropHi.classList.remove('wk-drop'); _dropHi = null; } }
function setupCellDrop(td, store, requestRender, rowId, wk){
  td.addEventListener('dragover', (ev) => {
    if (!_dragItem) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    if (_dropHi !== td){ clearDropHi(); td.classList.add('wk-drop'); _dropHi = td; }
  });
  td.addEventListener('dragleave', () => { if (_dropHi === td) clearDropHi(); });
  td.addEventListener('drop', (ev) => {
    if (!_dragItem) return;
    ev.preventDefault(); clearDropHi();
    const ref = store.getRef(_dragItem.refId), body = store.getBody(_dragItem.bodyId);
    _dragItem = null;
    if (!ref || !body) return;
    const curProj = body.proj || '__none';
    const moved = curProj !== rowId;
    if (moved) setCardProj(store, body, rowId);                // 別PJ行へ＝割当を変更
    setCardWeek(store, ref, body, wk);
    requestRender();
    showToast(moved ? 'プロジェクトと週を変更しました' : '週を変更しました');
  });
}

// ── キー処理（app.js の keydown から呼ばれる。true=処理した）──
export function onWeeklyKey(e){
  if (_editing) return false;                                  // 編集中は編集側のハンドラに任せる
  if (e.isComposing) return false;
  if (e.key === 'Escape' && _state && _state.expanded) return collapseCell();
  const el = document.activeElement;
  if (!el || !el.classList || !el.classList.contains('wk-item')) return false;
  const plain = !e.altKey && !e.ctrlKey && !e.metaKey;

  const navKey = (e.key === 'Tab') ? (e.shiftKey ? 'ShiftTab' : 'Tab')
               : (plain && !e.shiftKey) ? e.key : null;
  if (navKey && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab','ShiftTab','Home','End'].includes(navKey)){
    syncCursorFrom(el);
    const { cursor, page } = moveCursor(_shape, _cursor, navKey);
    _cursor = cursor;
    if (page){ pageWeeks(_state, _render, page); return true; }   // 週送り→再描画→applyCursor で端に乗る
    applyCursor();
    return true;
  }
  if (plain && !e.shiftKey && e.key === 'Enter'){ activate(el); return true; }
  if (plain && !e.shiftKey && e.key === ' '){ toggleDoneAt(el); return true; }
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'Enter'){ toggleDoneAt(el); return true; }
  if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'm' || e.key === 'M')){ toggleMsAt(el); return true; }
  if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'Enter'){ return jumpFrom(el); }   // 元のノードへ（↗ と同じ）
  if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'ArrowDown'){
    const cell = el.closest('.wk-cell');
    const col = cell && cell.dataset.col;
    if (col && col !== 'proj' && col !== 'link'){ syncCursorFrom(el); expandCell(el.closest('.wk-row').dataset.row, col); return true; }
    return false;
  }
  if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')){
    return moveCardWeek(el, e.key === 'ArrowRight' ? 1 : -1);
  }
  return false;
}
// コマンドパレット等から、カーソル位置のアイテムに対してキー操作と同じ処理を行う。
// パレットを開くとフォーカスは外れるが、カーソル（_cursor）は保持しているので applyCursor で戻してから実行する。
// 対象のアイテムが無い/対象外の種別なら false ＝呼び出し側が理由を通知できる。
export function weeklyCursorAction(kind){
  if (!_store || !_shape.rows.length) return false;
  applyCursor();
  const el = document.activeElement;
  if (!el || !el.classList || !el.classList.contains('wk-item')) return false;
  if (kind === 'jump') return jumpFrom(el);
  if (kind === 'ms')   { if (el.dataset.act !== 'card') return false; toggleMsAt(el); return true; }
  if (kind === 'next') return moveCardWeek(el, 1);
  if (kind === 'prev') return moveCardWeek(el, -1);
  if (kind === 'expand'){
    const cell = el.closest('.wk-cell'), col = cell && cell.dataset.col;
    if (!col || col === 'proj' || col === 'link') return false;
    syncCursorFrom(el); expandCell(el.closest('.wk-row').dataset.row, col); return true;
  }
  return false;
}

// 元のノード（デイリー／PJページ）へ飛ぶ。カード行のみ対象で、繰越の参照行でも同じ挙動。
// 対象外の行では false を返して他のキー処理（ビュー切替など）に譲る。
function jumpFrom(el){
  if (el.dataset.act !== 'card' || !_onJump || !el.dataset.body) return false;
  _onJump(el.dataset.body);
  return true;
}
function toggleDoneAt(el){
  if (el.dataset.act !== 'card') return;
  const b = _store.getBody(el.dataset.body);
  if (!b || b.kind !== 'task') return;
  syncCursorFrom(el);
  _store.updateBody(b.id, { done: !b.done });
  _render(); applyCursor();
}
function toggleMsAt(el){
  if (el.dataset.act !== 'card') return;
  const b = _store.getBody(el.dataset.body);
  if (!b) return;
  syncCursorFrom(el);
  _store.updateBody(b.id, { content: toggleMsContent(b.content) });
  _render(); applyCursor();
}
function moveCardWeek(el, d){
  if (el.dataset.act !== 'card' || el.dataset.overRef) return false;   // 参照行は動かさない
  const ref = _store.getRef(el.dataset.itemRef), body = _store.getBody(el.dataset.body);
  const cur = el.closest('.wk-cell')?.dataset.col;
  if (!ref || !body || !cur || cur === 'proj' || cur === 'link') return false;
  syncCursorFrom(el);
  setCardWeek(_store, ref, body, weekAdd(cur, d));
  _render(); applyCursor();
  showToast(d > 0 ? '翌週へ移しました' : '前の週へ移しました');
  return true;
}
