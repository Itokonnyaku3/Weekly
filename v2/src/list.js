// リストビュー（タスク本体のレンズ）: 絞り込み→並べ替え→選んだ列で表示。
// プロジェクト並べ替え時は PJ/中項目をツリー（見出し行）で表現し列は隠す。
// PJ/中項目/優先度/期限は表示専用＝Alt+Enter またはセルクリックで詳細ポップアップ（属性編集＋本文ミラー）。
// 列選択／カスタムビュー保存／プロジェクト（フィルタ＋割当＋管理）に対応。

const _q = new URL(import.meta.url).search;
const { renderOutlinePage } = await import('./daily.js' + _q);   // ポップアップの本文ミラーで共用

// ── 純ロジック（テスト対象）──
let _onJump = null;    // 行の「↗」→デイリーで該当カードを開くコールバック
let _listCtx = null;   // { store, requestRender, state } 折りたたみ(Ctrl+↑↓)・ポップアップ用

export function selectTasks(tasks, opts, today, projOrder){
  const { hideDone=false, dueFilter='all', projFilter='all', sort='proj' } = opts || {};
  let out = tasks.slice();
  if (hideDone) out = out.filter(t => !t.done);
  out = out.filter(t => dueMatch(t.due, dueFilter, today));
  out = out.filter(t => projMatch(t.proj, projFilter));
  out.sort(sortCmp(sort, projOrder || {}));
  return out;
}
function dueMatch(due, filter, today){
  if (filter === 'all')  return true;
  if (filter === 'none') return !due;
  if (filter === 'has')  return !!due;
  if (!due) return false;
  const d = dayDiff(due, today);
  if (filter === 'overdue') return d < 0;
  if (filter === 'today')   return d <= 0;
  if (filter === 'next3')   return d >= 0 && d <= 3;
  return true;
}
function projMatch(proj, filter){
  if (filter === 'all')  return true;
  if (filter === 'none') return !proj;
  return proj === filter;        // 特定PJのID
}
function dayDiff(due, today){
  return Math.round((Date.parse(due+'T00:00:00') - Date.parse(today+'T00:00:00')) / 86400000);
}
function cmpStr(x, y){ x = x||''; y = y||''; return x < y ? -1 : x > y ? 1 : 0; }
function dueCmp(a, b){
  if (!a.due && !b.due) return 0;
  if (!a.due) return 1;
  if (!b.due) return -1;
  return cmpStr(a.due, b.due);
}
// 中項目の折りたたみキー（描画ループと collapseKey で共通・区切りは proj/mid に出ない制御文字）
function midKeyOf(g, m){ return (g || '') + '' + (m || ''); }
// 中項目の折りたたみ状態（ネスト: midColl[proj][mid]=true）。区切り文字を使わず取り違えを防ぐ
function midIsColl(midColl, g, m){ const o = midColl[g || '']; return !!(o && o[m || '']); }
function midSetColl(midColl, g, m, v){ const o = midColl[g || ''] || (midColl[g || ''] = {}); o[m || ''] = v; }
function sortCmp(sort, projOrder){
  if (sort === 'proj'){                       // プロジェクト→中項目→（期限→優先度→名前）。未割当/中項目なしは末尾
    projOrder = projOrder || {};
    const rank = (t) => !t.proj ? 1e9 : (projOrder[t.proj] != null ? projOrder[t.proj] : 1e9 - 1);
    const hasMid = (t) => t.mid ? 0 : 1;   // 中項目なしは群の末尾
    return (a,b) => rank(a) - rank(b) || hasMid(a) - hasMid(b) || cmpStr(a.mid || '', b.mid || '') || dueCmp(a,b) || (b.prio||0) - (a.prio||0) || cmpStr(a.content, b.content);
  }
  if (sort === 'priority') return (a,b) => (b.prio||0) - (a.prio||0) || cmpStr(a.content, b.content);
  if (sort === 'created')  return (a,b) => cmpStr(a.createdAt, b.createdAt);
  if (sort === 'title')    return (a,b) => cmpStr(a.content, b.content);
  return (a,b) => {
    if (!a.due && !b.due) return cmpStr(a.content, b.content);
    if (!a.due) return 1;
    if (!b.due) return -1;
    return cmpStr(a.due, b.due) || (b.prio||0) - (a.prio||0);
  };
}

const PRIO_LABEL = ['なし', '低', '中', '高'];
// プロジェクト色: id から安定したパレット色を引く（並べ替えに依らず一定）
const PROJ_PALETTE = ['#e0524d','#e08a00','#c9a227','#3a9d3a','#0a9b8a','#2a8fbd','#5b6ee0','#7a5cd0','#c0568f','#b5683a'];
export function projColor(id){
  let h = 0; const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PROJ_PALETTE[h % PROJ_PALETTE.length];
}
const COLUMNS = {
  status:   { label:'完了',       cls:'c-st',      render: cellStatus },
  title:    { label:'タイトル',   cls:'c-title',   render: cellTitle },
  project:  { label:'プロジェクト', cls:'c-proj',    render: cellProject },
  mid:      { label:'中項目',     cls:'c-mid',     render: cellMid },
  priority: { label:'優先度',     cls:'c-prio',    render: cellPriority },
  due:      { label:'期限',       cls:'c-due',     render: cellDue },
  created:  { label:'作成日',     cls:'c-created', render: cellCreated },
};
const COLUMN_ORDER = ['project', 'mid', 'status', 'title', 'priority', 'due', 'created'];
export const DEFAULT_COLUMNS = ['project', 'mid', 'status', 'title', 'priority', 'due'];

function activeColumns(state){
  const stored = (state.columns && state.columns.length ? state.columns : DEFAULT_COLUMNS).filter(k => COLUMNS[k]);
  const set = new Set(stored.length ? stored : DEFAULT_COLUMNS);
  set.add('title');                                  // タイトルは必須
  return COLUMN_ORDER.filter(k => set.has(k));        // 常にこの順（プロジェクトが左端）
}

// プロジェクト区切り行（行自体に淡色＋左の色帯＋折りたたみトグル）
function groupRow(store, projId, span, count, isCollapsed, onToggle){
  const tr = document.createElement('tr'); tr.className = 'list-group';
  const td = document.createElement('td'); td.colSpan = span;
  const color = projId ? projColor(projId) : '#9aa0a6';
  td.style.background = color + '22';                  // 8桁hex=淡い背景
  td.style.boxShadow = 'inset 3px 0 0 ' + color;        // 左に色帯
  const tog = document.createElement('span'); tog.className = 'list-group-tog'; tog.textContent = isCollapsed ? '▸' : '▾';
  const nm = document.createElement('span'); nm.className = 'list-group-name';
  if (projId){ const p = store.getBody(projId); nm.textContent = p ? (p.content || '(無題PJ)') : '(不明なPJ)'; nm.style.color = color; }
  else nm.textContent = '未割当';
  td.appendChild(tog); td.appendChild(nm);
  if (count){ const c = document.createElement('span'); c.className = 'list-group-count'; c.textContent = count; td.appendChild(c); }
  td.tabIndex = -1; td.classList.add('nav-head'); td.dataset.fkey = 'g:' + (projId || ''); td.dataset.proj = projId || '';
  td.onclick = onToggle;
  td.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); onToggle(); } else navKey(e); });
  tr.appendChild(td); return tr;
}
// 中項目の小見出し行（PJグループの中・インデント・折りたたみトグル付き）
function midRow(projId, mid, span, isCollapsed, onToggle){
  const tr = document.createElement('tr'); tr.className = 'list-submid';
  const td = document.createElement('td'); td.colSpan = span;
  td.tabIndex = -1; td.classList.add('nav-head');
  td.dataset.fkey = 'm:' + (projId || '') + ':' + (mid || ''); td.dataset.proj = projId || ''; td.dataset.mid = mid || '';
  const tog = document.createElement('span'); tog.className = 'list-submid-tog'; tog.textContent = isCollapsed ? '▸' : '▾';
  const nm = document.createElement('span'); nm.className = 'list-submid-name';
  nm.textContent = mid || '（中項目なし）';
  if (!mid) nm.classList.add('none');
  td.appendChild(tog); td.appendChild(nm);
  td.onclick = onToggle;
  td.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); onToggle(); } else navKey(e); });
  tr.appendChild(td); return tr;
}

// ── 描画 ──
export function renderList(store, mount, requestRender, state, onJump){
  if (onJump) _onJump = onJump;
  _listCtx = { store, requestRender, state };
  const today = new Date().toISOString().slice(0, 10);
  const all = store.queryBodies(b => b.kind === 'task');
  const projOrder = {}; store.listProjects().forEach((p, i) => { projOrder[p.id] = i; });
  const rows = selectTasks(all, state, today, projOrder);
  const grouped = state.sort === 'proj';                 // プロジェクト並べ替え時だけツリー（区切り＋インデント）
  let cols = activeColumns(state);
  if (grouped) cols = cols.filter(k => k !== 'project' && k !== 'mid');   // ツリー表示時は PJ/中項目を見出し行に一本化（列は隠す）

  // 再描画でコントロールが作り直されてもフォーカスを保つ: 直前のフォーカス先を記録
  const active = document.activeElement;
  const refocus = (active && mount.contains(active) && active.dataset && active.dataset.fkey) ? active.dataset.fkey : null;

  mount.innerHTML = '';
  mount.appendChild(buildViewBar(store, requestRender, state));
  mount.appendChild(buildControls(store, requestRender, state, rows.length, all.length));

  const table = document.createElement('table');
  table.className = 'list-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const k of cols){
    const th = document.createElement('th');
    th.className = COLUMNS[k].cls;
    th.textContent = k === 'status' ? '' : COLUMNS[k].label;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  table.appendChild(thead);

  const tb = document.createElement('tbody');
  if (!rows.length){
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = cols.length; td.className = 'list-empty';
    td.textContent = '該当するタスクがありません。';
    tr.appendChild(td); tb.appendChild(tr);
  } else {
    const collapsed = state._collapsedGroups || (state._collapsedGroups = {});
    const counts = {}, projHasMid = {};
    if (grouped) for (const t of rows){ const g = t.proj || ''; counts[g] = (counts[g] || 0) + 1; if (t.mid) projHasMid[g] = true; }
    const midColl = state._midCollapsed || (state._midCollapsed = {});
    let curGroup, curMid, skip = false, midSkip = false;
    for (const t of rows){
      const g = t.proj || '';
      if (grouped && g !== curGroup){
        curGroup = g; curMid = undefined; skip = !!collapsed[g];
        tb.appendChild(groupRow(store, g, cols.length, counts[g], !!collapsed[g],
          () => { collapsed[g] = !collapsed[g]; requestRender(); }));
      }
      if (grouped && skip) continue;                 // プロジェクト折りたたみ中はタスク行を出さない
      if (grouped && projHasMid[g]){                 // 中項目の小見出し（中項目を使うPJのみ）
        const m = t.mid || '';
        if (m !== curMid){
          curMid = m; midSkip = midIsColl(midColl, g, m);
          tb.appendChild(midRow(g, m, cols.length, midSkip, () => { midSetColl(midColl, g, m, !midIsColl(midColl, g, m)); requestRender(); }));
        }
      } else { midSkip = false; }
      if (midSkip) continue;                         // 中項目折りたたみ中はそのタスクを出さない
      const tr = document.createElement('tr');
      tr.dataset.task = t.id; tr.dataset.proj = g; tr.dataset.mid = t.mid || '';
      if (t.done) tr.classList.add('row-done');
      for (const k of cols) tr.appendChild(COLUMNS[k].render(store, requestRender, t));
      if (grouped && tr.firstChild) tr.firstChild.style.paddingLeft = (projHasMid[g] ? 34 : 18) + 'px';   // ツリーのインデント
      tb.appendChild(tr);
    }
  }
  table.appendChild(tb);
  mount.appendChild(table);

  // 中項目の入力サジェスト（既存の中項目を候補に）
  const mids = [...new Set(all.map(t => t.mid).filter(Boolean))].sort();
  const dl = document.createElement('datalist'); dl.id = 'pwt2-mids';
  mids.forEach(m => { const o = document.createElement('option'); o.value = m; dl.appendChild(o); });
  mount.appendChild(dl);

  if (refocus){ const el = mount.querySelector('[data-fkey="' + refocus + '"]'); if (el) el.focus(); }
}

// ── 保存ビュー バー（＋プロジェクト管理）──
function buildViewBar(store, requestRender, state){
  const bar = document.createElement('div');
  bar.className = 'view-bar';

  const sel = document.createElement('select');
  sel.className = 'view-select'; sel.dataset.fkey = 'view';
  const cur = document.createElement('option');
  cur.value = ''; cur.textContent = '（現在の条件）';
  sel.appendChild(cur);
  for (const v of store.listViews()){
    const o = document.createElement('option');
    o.value = v.id; o.textContent = v.name;
    if (state._viewId === v.id) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => {
    const v = store.listViews().find(x => x.id === sel.value);
    if (v) applyView(state, v); else state._viewId = null;
    requestRender();
  };
  bar.appendChild(labelWrap('ビュー', sel));

  const name = document.createElement('input');
  name.type = 'text'; name.className = 'view-name'; name.placeholder = 'ビュー名';
  name.value = state._draftName || '';
  name.addEventListener('input', () => { state._draftName = name.value; });
  bar.appendChild(name);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn'; saveBtn.textContent = '保存';
  saveBtn.onclick = () => {
    const nm = (state._draftName || '').trim();
    if (!nm){ name.focus(); return; }
    const v = store.saveView({
      name: nm, hideDone: state.hideDone, dueFilter: state.dueFilter,
      projFilter: state.projFilter || 'all', sort: state.sort, columns: activeColumns(state).slice(),
    });
    state._viewId = v.id; state._draftName = '';
    requestRender();
  };
  bar.appendChild(saveBtn);

  if (state._viewId){
    const del = document.createElement('button');
    del.className = 'btn'; del.textContent = '削除';
    del.onclick = () => { store.deleteView(state._viewId); state._viewId = null; requestRender(); };
    bar.appendChild(del);
  }

  bar.appendChild(buildProjectManager(store, requestRender, state));
  return bar;
}
function applyView(state, v){
  state.hideDone = !!v.hideDone;
  state.dueFilter = v.dueFilter || 'all';
  state.projFilter = v.projFilter || 'all';
  state.sort = v.sort || 'proj';
  state.columns = (v.columns && v.columns.length ? v.columns.slice() : DEFAULT_COLUMNS.slice());
  state._viewId = v.id;
}

// ── プロジェクト管理（作成・改名・削除）──
function buildProjectManager(store, requestRender, state){
  const det = document.createElement('details');
  det.className = 'proj-manager';
  det.open = !!state._pmOpen;
  det.addEventListener('toggle', () => { state._pmOpen = det.open; });
  const sum = document.createElement('summary');
  sum.textContent = 'プロジェクト ▾';
  det.appendChild(sum);

  const box = document.createElement('div');
  box.className = 'proj-manager-box';
  for (const p of store.listProjects()){
    const row = document.createElement('div');
    row.className = 'pm-row';
    const nm = document.createElement('input');
    nm.type = 'text'; nm.value = p.content || ''; nm.dataset.proj = p.id;
    nm.addEventListener('change', () => { store.updateBody(p.id, { content: nm.value }); requestRender(); });
    const del = document.createElement('button');
    del.className = 'btn'; del.textContent = '削除';
    del.onclick = () => { store.deleteProject(p.id); requestRender(); };
    row.appendChild(nm); row.appendChild(del);
    box.appendChild(row);
  }
  const addRow = document.createElement('div');
  addRow.className = 'pm-row';
  const ni = document.createElement('input');
  ni.type = 'text'; ni.placeholder = '新規PJ名'; ni.value = state._pmDraft || '';
  ni.addEventListener('input', () => { state._pmDraft = ni.value; });
  const addBtn = document.createElement('button');
  addBtn.className = 'btn'; addBtn.textContent = '＋追加';
  addBtn.onclick = () => {
    const nm = (state._pmDraft || '').trim();
    if (!nm){ ni.focus(); return; }
    store.createProject(nm); state._pmDraft = '';
    requestRender();
  };
  addRow.appendChild(ni); addRow.appendChild(addBtn);
  box.appendChild(addRow);

  det.appendChild(box);
  return det;
}

// ── フィルタ/並べ替え/列 バー ──
function buildControls(store, requestRender, state, shown, total){
  const bar = document.createElement('div');
  bar.className = 'list-controls';
  const touch = () => { state._viewId = null; requestRender(); };

  bar.appendChild(labelWrap('期限', selectEl([
    ['all','すべて'], ['next3','今後3日以内'], ['today','今日まで'],
    ['overdue','期限切れ'], ['has','期限あり'], ['none','期限なし'],
  ], state.dueFilter, v => { state.dueFilter = v; touch(); }, 'filter-due')));

  const projOpts = [['all','すべて'], ['none','未割当'],
    ...store.listProjects().map(p => [p.id, p.content || '(無題)'])];
  bar.appendChild(labelWrap('PJ', selectEl(projOpts, state.projFilter || 'all', v => { state.projFilter = v; touch(); }, 'filter-proj')));

  bar.appendChild(labelWrap('並べ替え', selectEl([
    ['proj','プロジェクト'], ['due','期限'], ['priority','優先度'], ['created','作成日'], ['title','タイトル'],
  ], state.sort, v => { state.sort = v; touch(); }, 'sort')));

  const cbWrap = document.createElement('label');
  cbWrap.className = 'list-cb';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = !!state.hideDone;
  cb.dataset.fkey = 'hidedone';
  cb.onchange = () => { state.hideDone = cb.checked; touch(); };
  cbWrap.appendChild(cb); cbWrap.appendChild(document.createTextNode('完了を隠す'));
  bar.appendChild(cbWrap);

  bar.appendChild(buildColumnPicker(state, touch));

  const count = document.createElement('span');
  count.className = 'list-count';
  count.textContent = `${shown} / ${total} 件`;
  bar.appendChild(count);
  return bar;
}
function buildColumnPicker(state, touch){
  const det = document.createElement('details');
  det.className = 'col-picker';
  det.open = !!state._colOpen;
  det.addEventListener('toggle', () => { state._colOpen = det.open; });
  const sum = document.createElement('summary');
  sum.textContent = '列 ▾';
  det.appendChild(sum);
  const box = document.createElement('div');
  box.className = 'col-picker-box';
  const cur = new Set(activeColumns(state));
  for (const k of COLUMN_ORDER){
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = cur.has(k);
    if (k === 'title'){ cb.checked = true; cb.disabled = true; }
    cb.onchange = () => {
      const set = new Set(activeColumns(state));
      if (cb.checked) set.add(k); else set.delete(k);
      set.add('title');
      state.columns = COLUMN_ORDER.filter(x => set.has(x));
      touch();
    };
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(' ' + COLUMNS[k].label));
    box.appendChild(lab);
  }
  det.appendChild(box);
  return det;
}

// ── セル ──
function cellStatus(store, requestRender, t){
  const td = document.createElement('td'); td.className = 'c-st';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!t.done;
  cb.dataset.fkey = 'status:' + t.id; cb.dataset.col = 'status';
  cb.onchange = () => { store.updateBody(t.id, { done: cb.checked }); requestRender(); };
  cb.addEventListener('keydown', navKey);
  td.appendChild(cb); return td;
}
function cellTitle(store, requestRender, t){
  const td = document.createElement('td');
  const jump = document.createElement('button');
  jump.type = 'button'; jump.className = 'list-jump'; jump.textContent = '↗'; jump.title = 'デイリーで開く';
  jump.onmousedown = (e) => e.preventDefault();
  jump.onclick = () => { if (_onJump) _onJump(t.id); };
  const chip = document.createElement('span');
  chip.className = 'cell-chip title-chip'; chip.tabIndex = 0; chip.dataset.fkey = 'title:' + t.id; chip.dataset.col = 'title';
  chip.textContent = t.content || '(無題)';
  if (!t.content) chip.classList.add('none');
  const revert = (ed, focus) => {
    chip.textContent = ed.textContent || '(無題)';
    chip.classList.toggle('none', !ed.textContent);
    if (ed.isConnected) ed.replaceWith(chip);
    if (focus) chip.focus();
  };
  const edit = () => {
    const ed = document.createElement('span');
    ed.className = 'list-title'; ed.contentEditable = 'true'; ed.spellcheck = false;
    ed.textContent = t.content || '';
    ed.addEventListener('input', () => store.updateBody(t.id, { content: ed.textContent }));
    ed.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape'){ e.preventDefault(); revert(ed, true); } });   // Enter/Escで編集を抜けてフォーカス維持
    ed.addEventListener('blur', () => revert(ed, false));
    chip.replaceWith(ed); ed.focus();
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  };
  chip.addEventListener('click', edit);
  chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.altKey){ e.preventDefault(); edit(); } else navKey(e); });   // Alt+Enter は navKey→詳細へ
  const wrap = document.createElement('div'); wrap.className = 'c-title-wrap';
  wrap.appendChild(jump); wrap.appendChild(chip);
  td.appendChild(wrap); return td;
}
// 表示専用チップ: クリック / Alt+Enter で詳細ポップアップを開く（直接編集はしない）。矢印はセルカーソル移動。
function displayChip({ text, muted, color, cls, fkey, col, taskId }){
  const chip = document.createElement('span');
  chip.className = 'cell-chip cell-open' + (muted ? ' none' : '') + (cls ? ' ' + cls : '');
  chip.tabIndex = 0; if (fkey) chip.dataset.fkey = fkey; if (col) chip.dataset.col = col;
  chip.textContent = text;
  if (color) chip.style.color = color;
  chip.title = 'クリック / Alt+Enter で詳細';
  chip.addEventListener('click', () => { if (_listCtx) openTaskDetail(_listCtx.store, taskId, _listCtx.requestRender); });
  chip.addEventListener('keydown', navKey);     // Alt+Enter=詳細 / 矢印=カーソル移動（navKey 内で処理）
  return chip;
}
function cellProject(store, requestRender, t){
  const td = document.createElement('td'); td.className = 'c-proj';
  const p = t.proj && store.getBody(t.proj);
  td.appendChild(displayChip({
    text: t.proj ? (p ? (p.content || '(無題)') : '(不明)') : '—',
    muted: !t.proj, color: t.proj ? projColor(t.proj) : null, cls: 'proj', fkey: 'proj:' + t.id, col: 'project', taskId: t.id,
  }));
  return td;
}
function cellMid(store, requestRender, t){
  const td = document.createElement('td'); td.className = 'c-mid';
  td.appendChild(displayChip({ text: t.mid || '—', muted: !t.mid, fkey: 'mid:' + t.id, col: 'mid', taskId: t.id }));
  return td;
}
function cellPriority(store, requestRender, t){
  const td = document.createElement('td'); td.className = 'c-prio';
  const prio = t.prio || 0;
  td.appendChild(displayChip({
    text: PRIO_LABEL[prio], muted: !prio, cls: prio === 3 ? 'prio-3' : prio === 2 ? 'prio-2' : '', fkey: 'prio:' + t.id, col: 'priority', taskId: t.id,
  }));
  return td;
}
function cellDue(store, requestRender, t){
  const td = document.createElement('td'); td.className = 'c-due';
  td.appendChild(displayChip({ text: t.due || '—', muted: !t.due, fkey: 'due:' + t.id, col: 'due', taskId: t.id }));
  return td;
}
function cellCreated(store, requestRender, t){
  const td = document.createElement('td'); td.className = 'c-created cell-muted';
  td.textContent = (t.createdAt || '').slice(0, 10) || '—';
  return td;
}

// ── 小物 ──
function selectEl(options, value, onChange, fkey){
  const sel = document.createElement('select');
  if (fkey) sel.dataset.fkey = fkey;                // 再描画後にフォーカスを戻すための識別キー
  for (const [v, label] of options){
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    if (v === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => onChange(sel.value);
  return sel;
}
function labelWrap(text, control){
  const wrap = document.createElement('label');
  wrap.className = 'list-field';
  wrap.appendChild(document.createTextNode(text));
  wrap.appendChild(control);
  return wrap;
}

// ── セルカーソル（行×列・ヘッダ含む）のキーボード移動 ──
function rowFocusables(tr){ return [...tr.querySelectorAll('[data-col], .nav-head')]; }
function focusRowCol(rows, ri, col){
  if (ri < 0 || ri >= rows.length) return;
  const cells = rowFocusables(rows[ri]);
  if (!cells.length) return;
  const target = (col && cells.find(c => c.dataset.col === col)) || cells[0];   // 同列が無ければ先頭（見出し等）
  target.focus();
}
function atTitleBoundary(el, key){      // タイトル内のキャレットが端にあるか（端でのみセル移動）
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const off = sel.getRangeAt(0).startOffset;
  return key === 'ArrowLeft' ? off === 0 : off >= (el.textContent || '').length;
}
function navKey(e){
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'Enter'){   // Alt+Enter=タスク詳細ポップアップ
    const tr = e.currentTarget.closest && e.currentTarget.closest('tr');
    if (tr && tr.dataset.task && _listCtx){ e.preventDefault(); openTaskDetail(_listCtx.store, tr.dataset.task, _listCtx.requestRender); return; }
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){ collapseKey(e); return; }   // #3 カスケード折りたたみ/展開
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const el = e.currentTarget; const tr = el.closest && el.closest('tr');
  const tbody = tr && tr.parentElement; if (!tbody) return;
  const rows = [...tbody.children]; const ri = rows.indexOf(tr);
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){
    e.preventDefault();
    focusRowCol(rows, ri + (e.key === 'ArrowUp' ? -1 : 1), el.dataset.col || null);
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
    if (el.classList.contains('list-title') && !atTitleBoundary(el, e.key)) return;   // タイトル内はキャレット移動
    e.preventDefault();
    const cells = rowFocusables(tr); const idx = cells.indexOf(el);
    const next = cells[idx + (e.key === 'ArrowLeft' ? -1 : 1)];
    if (next) next.focus();
    return;
  }
}

// ── #3 カスケード折りたたみ/展開（Ctrl+↑ 畳む / Ctrl+↓ 展開）──
function focusHeader(proj, mid){   // mid 省略=プロジェクト見出し／指定=中項目見出し
  const heads = [...document.querySelectorAll('.list-table .nav-head')];
  const el = heads.find(h => (h.dataset.proj || '') === (proj || '') &&
    (mid === undefined ? !('mid' in h.dataset) : (h.dataset.mid || '') === (mid || '')));
  if (el) el.focus();
}
function collapseKey(e){
  if (!_listCtx) return;
  e.preventDefault();
  const { state, requestRender } = _listCtx;
  const collapse = (e.key === 'ArrowUp');
  const projColl = state._collapsedGroups || (state._collapsedGroups = {});
  const midColl  = state._midCollapsed  || (state._midCollapsed  = {});
  const mk = (g, m) => g + '' + m;   // 描画ループと同じ区切り（中項目キー）
  const el = e.currentTarget;
  const tbody = el.closest('tbody'); if (!tbody) return;
  // 現在の表示（DOM基準・フィルタ追従）
  const midHeads   = (p) => [...tbody.querySelectorAll('.nav-head')].filter(h => (h.dataset.proj||'')===p && ('mid' in h.dataset)).map(h => h.dataset.mid||'');
  const hasMid     = (p) => midHeads(p).length > 0;
  const taskVisible= (p) => [...tbody.querySelectorAll('tr')].some(r => r.dataset.task && (r.dataset.proj||'')===p);
  const allProjs   = () => [...tbody.querySelectorAll('.nav-head')].filter(h => !('mid' in h.dataset)).map(h => h.dataset.proj||'');
  // フォーカス中の文脈
  let proj, mid, kind;
  if (el.classList.contains('nav-head')){
    proj = el.dataset.proj || '';
    if ('mid' in el.dataset){ kind = 'mid'; mid = el.dataset.mid || ''; } else kind = 'proj';
  } else {
    const tr = el.closest('tr'); if (!tr || !tr.dataset.task) return;
    proj = tr.dataset.proj || ''; mid = tr.dataset.mid || ''; kind = 'task';
  }

  if (collapse){
    if (kind === 'task'){
      if (hasMid(proj)){ midSetColl(midColl, proj, mid, true); requestRender(); focusHeader(proj, mid); }   // 同じ中項目を畳む→中項目見出しへ
      else { projColl[proj] = true; requestRender(); focusHeader(proj); }                            // 中項目なしPJ→PJを畳む
    } else if (kind === 'mid'){
      projColl[proj] = true; requestRender(); focusHeader(proj);                                     // PJ全体を畳む→PJ見出しへ
    } else {                                                                                         // PJ見出し: 段階的
      if (projColl[proj]){ for (const p of allProjs()) projColl[p] = true; requestRender(); focusHeader(proj); }              // 全畳み済み→全PJ畳む
      else if (hasMid(proj) && taskVisible(proj)){ for (const m of midHeads(proj)) midSetColl(midColl, proj, m, true); requestRender(); focusHeader(proj); }  // タスク表示中→中項目のみに
      else { projColl[proj] = true; requestRender(); focusHeader(proj); }                            // 中項目のみ/中項目なし→PJ見出しのみに
    }
  } else {   // 展開（逆順）
    if (kind === 'task') return;
    else if (kind === 'mid'){ midSetColl(midColl, proj, mid, false); requestRender(); focusHeader(proj, mid); }
    else {
      if (projColl[proj]){ projColl[proj] = false; requestRender(); focusHeader(proj); }             // PJ見出しのみ→中項目を表示
      else if (hasMid(proj) && midHeads(proj).some(m => midIsColl(midColl, proj, m))){ for (const m of midHeads(proj)) midSetColl(midColl, proj, m, false); requestRender(); focusHeader(proj); }  // 中項目のみ→タスク表示
      else { for (const p of allProjs()) projColl[p] = false; requestRender(); focusHeader(proj); }  // 全展開済み→全PJ展開
    }
  }
}

// ── タスク詳細ポップアップ（属性編集＋本文ミラー）──
// 上部: プロジェクト/中項目/優先度/期限を即反映で編集。下部: タイトル以下を共用アウトラインでミラー（直接編集）。
function buildDetailFields(store, body){
  const grid = document.createElement('div'); grid.className = 'td-fields';
  const add = (label, control) => {
    const l = document.createElement('span'); l.className = 'td-label'; l.textContent = label;
    grid.appendChild(l); grid.appendChild(control);
  };
  const projOpts = [['', '—'], ...store.listProjects().map(p => [p.id, p.content || '(無題)'])];
  add('プロジェクト', selectEl(projOpts, body.proj || '', v => store.updateBody(body.id, { proj: v || undefined })));
  const mid = document.createElement('input'); mid.type = 'text'; mid.className = 'td-input'; mid.value = body.mid || ''; mid.setAttribute('list', 'pwt2-mids');
  mid.addEventListener('change', () => store.updateBody(body.id, { mid: mid.value.trim() || undefined }));
  add('中項目', mid);
  add('優先度', selectEl(PRIO_LABEL.map((l, i) => [String(i), l]), String(body.prio || 0), v => store.updateBody(body.id, { prio: Number(v) })));
  const due = document.createElement('input'); due.type = 'date'; due.className = 'td-input'; due.value = body.due || '';
  due.addEventListener('change', () => store.updateBody(body.id, { due: due.value || '' }));
  add('期限', due);
  return grid;
}
function openTaskDetail(store, bodyId, listRequestRender){
  const body = store.getBody(bodyId); if (!body) return;
  const refs = store.refsForBody(bodyId);
  const rootStart = refs.length ? refs[0].id : null;     // ミラーの起点（先頭ref）
  let modalRoot = rootStart;

  const overlay = document.createElement('div'); overlay.className = 'td-overlay';
  const box = document.createElement('div'); box.className = 'td-box';
  overlay.appendChild(box);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); if (listRequestRender) listRequestRender(); };
  const onKey = (e) => { if (e.key === 'Escape'){ e.preventDefault(); close(); } };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });   // 外側クリックで閉じる
  document.addEventListener('keydown', onKey, true);

  const render = () => {
    box.innerHTML = '';
    const head = document.createElement('div'); head.className = 'td-head';
    const ttl = document.createElement('span'); ttl.className = 'td-title'; ttl.textContent = 'カードの詳細';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'td-close'; x.textContent = '×'; x.title = '閉じる (Esc)'; x.onclick = close;
    head.appendChild(ttl); head.appendChild(x);
    box.appendChild(head);
    box.appendChild(buildDetailFields(store, body));

    const mirror = document.createElement('div'); mirror.className = 'td-mirror';
    const fref = store.getRef(modalRoot), fbody = fref && store.getBody(fref.bodyId);
    if (fref && fbody){
      renderOutlinePage(store, mirror, render, fref, fbody, {
        inheritProj: body.proj,
        crumb: modalRoot !== rootStart ? [{ label: '▲ 上へ戻る', onClick: () => { modalRoot = rootStart; render(); } }] : null,
        onZoomIn: (rid) => { modalRoot = rid; render(); },
        onZoomOut: () => {                                  // タスク直下で Alt+↑ は閉じる／それ以外は親へ
          if (modalRoot === rootStart){ close(); return; }
          const cur = store.getRef(modalRoot);
          const parent = cur && cur.parentRefId ? store.getRef(cur.parentRefId) : null;
          modalRoot = parent ? parent.id : rootStart; render();
        },
      });
    } else {
      const e = document.createElement('p'); e.className = 'td-empty'; e.textContent = 'このタスクには本文の参照がありません。';
      mirror.appendChild(e);
    }
    box.appendChild(mirror);
  };
  render();
  document.body.appendChild(overlay);
  const t = box.querySelector('.zoom-title-txt'); if (t) t.focus();   // 初期フォーカス＝タイトル
}
