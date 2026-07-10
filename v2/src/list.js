// リストビュー（タスク本体のレンズ）: 絞り込み→並べ替え→選んだ列で表示。
// プロジェクト並べ替え時は PJ/中項目をツリー（見出し行）で表現し列は隠す。
// PJ/中項目/優先度/期限は表示専用＝Alt+Enter またはセルクリックで詳細ポップアップ（属性編集＋本文ミラー）。
// 列選択／カスタムビュー保存／プロジェクト（フィルタ＋割当＋管理）に対応。

const _q = new URL(import.meta.url).search;
const { renderOutlinePage, getHideDone } = await import('./daily.js' + _q);   // ポップアップの本文ミラーで共用／完了非表示の共通状態
const { showToast } = await import('./clipboard.js' + _q);   // 追加後の非表示通知に使用

// ── 純ロジック（テスト対象）──
// 指定PJ（body.proj===projId）のタスクの中項目を重複排除・ソートして返す。projId 空＝未所属タスクの中項目。
export function midsForProject(store, projId){
  const want = projId || '';
  return [...new Set(
    store.queryBodies(b => b.kind === 'task' && (b.proj || '') === want)
      .map(b => b.mid).filter(Boolean)
  )].sort();
}

// 今日の day カード直下に task を作成（グループの proj/mid を継承）。today 省略時は当日。
export function addTaskToday(store, { proj, mid } = {}, today){
  const date = today || new Date().toISOString().slice(0, 10);
  const day = store.ensureDayCard(date);
  const attrs = { kind:'task', content:'', parentRefId: day.ref.id };
  if (proj) attrs.proj = proj;
  if (mid)  attrs.mid  = mid;   // 明示mid＝親がdayなので#2継承は発生せずこの値が入る
  return store.createCard(attrs);
}

// D&Dで中項目を移動できる先か: 同一PJ内のみ許可（proj は変えない＝#1確定仕様）
export function canDropTask(store, taskId, targetProj){
  const b = store.getBody(taskId);
  if (!b) return false;
  return (b.proj || '') === (targetProj || '');
}

// サブタスク索引を全ref 1パス（＋メモ化した部分木走査）で構築。
//  subtaskIds: 祖先のどこかにタスクを持つ task カードの bodyId 集合（＝サブタスク）。
//  descCount : 各カード bodyId → 配下（子孫）の task カード総数（重複bodyは1回）。> 0 のみ格納。
// カードは複数refを持ちうるため、いずれかのrefが条件を満たせば subtask 扱い（bodyId で集約）。
export function subtaskIndex(store){
  const refs = store.allRefs();
  const childrenByParent = new Map();        // parentRefId(null=ルート) -> [ref]
  const refsByBody = new Map();              // bodyId -> [ref]
  for (const r of refs){
    const k = r.parentRefId || null;
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k).push(r);
    if (!refsByBody.has(r.bodyId)) refsByBody.set(r.bodyId, []);
    refsByBody.get(r.bodyId).push(r);
  }
  const isTaskRef = (r) => { const b = store.getBody(r.bodyId); return !!b && b.kind === 'task'; };

  // subtaskIds: ルートから辿り「祖先にタスクがあるか」を伝播（祖先タスク＋自分がタスク＝サブタスク）
  const subtaskIds = new Set();
  const markDown = (parentRefId, ancestorHasTask) => {
    for (const r of (childrenByParent.get(parentRefId) || [])){
      const thisIsTask = isTaskRef(r);
      if (ancestorHasTask && thisIsTask) subtaskIds.add(r.bodyId);
      markDown(r.id, ancestorHasTask || thisIsTask);
    }
  };
  markDown(null, false);

  // 各refの配下子孫タスク bodyId 集合（メモ化）→ body 単位に集約して件数化
  const memo = new Map();
  const subtreeTasks = (refId) => {
    if (memo.has(refId)) return memo.get(refId);
    const acc = new Set();
    for (const r of (childrenByParent.get(refId) || [])){
      if (isTaskRef(r)) acc.add(r.bodyId);
      for (const b of subtreeTasks(r.id)) acc.add(b);
    }
    memo.set(refId, acc);
    return acc;
  };
  const descCount = new Map();
  const descIncomplete = new Map();
  for (const [bodyId, rs] of refsByBody){
    const acc = new Set();
    for (const r of rs) for (const b of subtreeTasks(r.id)) acc.add(b);
    acc.delete(bodyId);                      // 念のため自分自身は除外
    if (acc.size){
      descCount.set(bodyId, acc.size);
      let inc = 0;
      for (const b of acc){ const body = store.getBody(b); if (body && !body.done) inc++; }
      descIncomplete.set(bodyId, inc);
    }
  }
  return { subtaskIds, descCount, descIncomplete };
}

// (proj,mid)ごとの件数マップ（#1 折りたたみ中の中項目に件数バッジを出すため）。キーは midKeyOf。
export function midCounts(rows){
  const m = {};
  for (const t of rows){ const k = midKeyOf(t.proj || '', t.mid || ''); m[k] = (m[k] || 0) + 1; }
  return m;
}

// 追加→再描画→新規タスクのタイトルへフォーカスして即編集。絞り込みで非表示ならトースト。
function doAddTask(store, requestRender, ctx, today){
  const { body } = addTaskToday(store, ctx, today);
  requestRender();
  const chip = document.querySelector('[data-fkey="title:' + body.id + '"]');
  if (chip){ chip.focus(); chip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }
  else showToast('タスクを追加しました（現在の絞り込みでは非表示）');
}

let _onJump = null;    // 行の「↗」→デイリーで該当カードを開くコールバック
let _onOpenProject = null;   // PJ見出しで Enter → そのプロジェクトを開く（#3・app から設定）
let _listCtx = null;   // { store, requestRender, state } 折りたたみ(Ctrl+↑↓)・ポップアップ用
let _dragTask = null;   // D&D中のタスク {id, proj}
let _dropHiEl = null;   // ドロップ候補のハイライト行
function clearDropHi(){ if (_dropHiEl){ _dropHiEl.classList.remove('drop-hi'); _dropHiEl = null; } }
function hiRow(tr){ if (_dropHiEl !== tr){ clearDropHi(); if (tr){ tr.classList.add('drop-hi'); _dropHiEl = tr; } } }
// ドロップ先の行から所属PJ・中項目を判定（中項目見出し / PJ見出し(中項目なしPJ) / タスク行）。対象外は null。
function dropInfo(tr){
  if (!tr) return null;
  if (tr.dataset && tr.dataset.task) return { proj: tr.dataset.proj || '', mid: tr.dataset.mid || '' };
  const head = tr.querySelector && tr.querySelector('td.nav-head');
  if (head){
    // 見出しの種別は dataset.mid の有無で判定: midRow は必ず dataset.mid を持ち、groupRow は持たない（両者の実装がこの前提）
    if ('mid' in head.dataset) return { proj: head.dataset.proj || '', mid: head.dataset.mid || '' };  // 中項目見出し
    return { proj: head.dataset.proj || '', mid: '' };                                                 // PJ見出し(中項目なしPJ)
  }
  return null;
}

// 1条件グループの既定値（全項目「すべて」＝絞り込みなし）。呼び出しごとに新しいオブジェクトを返す（状態間の共有を防ぐ）。
function defaultGroup(){
  return {
    due:  { mode: 'any', from: null, to: null },
    done: { mode: 'any', from: null, to: null },
    proj: 'all',
    mid:  '',
    prio: 'all',
  };
}
function dayDiff(due, today){
  return Math.round((Date.parse(due+'T00:00:00') - Date.parse(today+'T00:00:00')) / 86400000);
}
export function dueGroupMatch(due, cond, today){
  if (!cond || cond.mode === 'any') return true;
  if (cond.mode === 'none') return !due;
  if (!due) return false;                          // mode === 'range'
  const d = dayDiff(due, today);
  if (cond.from != null && d < cond.from) return false;
  if (cond.to   != null && d > cond.to)   return false;
  return true;
}
function doneGroupMatch(t, cond, today){
  if (!cond || cond.mode === 'any') return true;
  if (cond.mode === 'notDone') return !t.done;
  if (!t.done) return false;                       // mode === 'done'
  if (cond.from == null && cond.to == null) return true;   // 完了日は問わない
  if (!t.doneAt) return false;                      // 完了日時が未記録（過去に完了したタスク）
  const d = dayDiff(t.doneAt.slice(0, 10), today);
  if (cond.from != null && d < cond.from) return false;
  if (cond.to   != null && d > cond.to)   return false;
  return true;
}
export function projMatch(proj, filter){
  if (filter === 'all')  return true;
  if (filter === 'none') return !proj;
  return proj === filter;        // 特定PJのID
}
function groupMatch(t, g, today){
  return dueGroupMatch(t.due, g.due, today)
      && doneGroupMatch(t, g.done, today)
      && projMatch(t.proj, g.proj)
      && (!g.mid || (t.mid || '').toLowerCase().includes(g.mid.toLowerCase()))
      && (g.prio === 'all' || String(t.prio || 0) === g.prio);
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
// 旧フィルタ形式（dueFilter プリセット）→ 新しい range 条件へのマッピング（保存済みビューの移行用）
function legacyDueToGroup(dueFilter){
  if (dueFilter === 'none')    return { mode:'none',  from:null, to:null };
  if (dueFilter === 'has')     return { mode:'range', from:null, to:null };
  if (dueFilter === 'overdue') return { mode:'range', from:null, to:-1 };
  if (dueFilter === 'today')   return { mode:'range', from:null, to:0 };
  if (dueFilter === 'next3')   return { mode:'range', from:0,    to:3 };
  return { mode:'any', from:null, to:null };   // 'all' または未指定
}
// 保存済みビュー（新旧どちらの形式でも）→ 条件グループ配列。新形式はdefaultGroupで欠けたフィールドを補完するだけ。
export function viewToGroups(v){
  v = v || {};
  if (v.groups && v.groups.length) return v.groups.map(g => ({ ...defaultGroup(), ...g }));
  const g = defaultGroup();
  g.due  = legacyDueToGroup(v.dueFilter);
  g.done = v.hideDone ? { mode:'notDone', from:null, to:null } : { mode:'any', from:null, to:null };
  g.proj = v.projFilter || 'all';
  return [g];
}
export function selectTasks(tasks, opts, today, projOrder){
  const groups = (opts && opts.groups && opts.groups.length) ? opts.groups : [defaultGroup()];
  const sort = (opts && opts.sort) || 'proj';
  const sortDir = (opts && opts.sortDir) || 'asc';
  let cmp = sortCmp(sort, projOrder || {});
  if (sortDir === 'desc' && sort !== 'proj'){ const base = cmp; cmp = (a, b) => -base(a, b); }
  return tasks.filter(t => groups.some(g => groupMatch(t, g, today))).sort(cmp);
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
// 見出し行の右端に置く「＋ タスク追加」ボタン（行のトグルへ伝播させない）。カーソル移動の停止先にはならない。
function addBtnInline(onAdd){
  const btn = document.createElement('span'); btn.className = 'list-add-btn list-add-inline'; btn.textContent = '＋ タスク追加';
  btn.onclick = (e) => { e.stopPropagation(); onAdd(); };
  return btn;
}
function groupRow(store, projId, span, count, isCollapsed, onToggle, onAdd){
  const tr = document.createElement('tr'); tr.className = 'list-group';
  const td = document.createElement('td'); td.colSpan = span;
  const color = projId ? projColor(projId) : '#9aa0a6';
  td.style.background = color + '22';                  // 8桁hex=淡い背景
  td.style.boxShadow = 'inset 3px 0 0 ' + color;        // 左に色帯
  const tog = document.createElement('span'); tog.className = 'list-group-tog'; tog.textContent = isCollapsed ? '▸' : '▾';
  tog.onclick = (e) => { e.stopPropagation(); onToggle(); };       // #3 折りたたみは▸/▾トグルのみ
  const nm = document.createElement('span'); nm.className = 'list-group-name';
  if (projId){ const p = store.getBody(projId); nm.textContent = p ? (p.content || '(無題PJ)') : '(不明なPJ)'; nm.style.color = color; }
  else nm.textContent = '未割当';
  td.appendChild(tog); td.appendChild(nm);
  if (count){ const c = document.createElement('span'); c.className = 'list-group-count'; c.textContent = count; td.appendChild(c); }
  if (!isCollapsed && onAdd) td.appendChild(addBtnInline(onAdd));   // 中項目なしPJ: 見出し右端に追加ボタン
  td.tabIndex = -1; td.classList.add('nav-head'); td.dataset.fkey = 'g:' + (projId || ''); td.dataset.proj = projId || '';
  td.onclick = () => td.focus();                                   // #3 クリックは選択（折りたたまない）
  td.addEventListener('keydown', (e) => {
    if (e.key === 'Enter'){ e.preventDefault(); if (projId && _onOpenProject) _onOpenProject(projId); }   // #3 Enter=そのPJを開く
    else navKey(e);
  });
  tr.appendChild(td); return tr;
}
// 中項目の小見出し行（PJグループの中・インデント・折りたたみトグル付き）
function midRow(projId, mid, span, isCollapsed, onToggle, count, onAdd){
  const tr = document.createElement('tr'); tr.className = 'list-submid';
  const td = document.createElement('td'); td.colSpan = span;
  td.tabIndex = -1; td.classList.add('nav-head');
  td.dataset.fkey = 'm:' + (projId || '') + ':' + (mid || ''); td.dataset.proj = projId || ''; td.dataset.mid = mid || '';
  td.style.borderBottom = '2px solid ' + (projId ? projColor(projId) : '#9aa0a6');   // 中項目見出しの下線はプロジェクトカラーに合わせる
  const tog = document.createElement('span'); tog.className = 'list-submid-tog'; tog.textContent = isCollapsed ? '▸' : '▾';
  const nm = document.createElement('span'); nm.className = 'list-submid-name';
  nm.textContent = mid || '（中項目なし）';
  if (!mid) nm.classList.add('none');
  td.appendChild(tog); td.appendChild(nm);
  if (isCollapsed && count){                       // 折りたたみ時のみ配下件数バッジ（#1）
    const c = document.createElement('span'); c.className = 'list-submid-count'; c.textContent = '(' + count + ')';
    td.appendChild(c);
  }
  if (!isCollapsed && onAdd) td.appendChild(addBtnInline(onAdd));   // 見出し右端に追加ボタン（展開時のみ）
  td.onclick = onToggle;
  td.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); onToggle(); } else navKey(e); });
  tr.appendChild(td); return tr;
}

// ── 描画 ──
export function renderList(store, mount, requestRender, state, onJump, onOpenProject){
  if (onJump) _onJump = onJump;
  if (onOpenProject) _onOpenProject = onOpenProject;
  _listCtx = { store, requestRender, state };
  const today = new Date().toISOString().slice(0, 10);
  const all = store.queryBodies(b => b.kind === 'task');
  const { subtaskIds, descCount, descIncomplete } = subtaskIndex(store);   // サブタスク判定＋配下タスク数（バッジ用）
  _listCtx.descCount = descCount;                          // cellTitle が （未完了/全体）表示に参照
  _listCtx.descIncomplete = descIncomplete;
  const projOrder = {}; store.listProjects().forEach((p, i) => { projOrder[p.id] = i; });
  const groups = ensureGroups(state);
  let rows = selectTasks(all, { groups, sort: state.sort, sortDir: state.sortDir }, today, projOrder);
  if (!state._showSubtasks) rows = rows.filter(t => !subtaskIds.has(t.id));   // 既定=サブタスク非表示
  if (getHideDone()) rows = rows.filter(t => !t.done);   // 完了非表示（全ビュー共通トグル・Alt+H）
  if (state._focusProj != null) rows = rows.filter(t => (t.proj || '') === state._focusProj);   // プロジェクトフォーカス＝他PJを隠す
  const grouped = state.sort === 'proj';                 // プロジェクト並べ替え時だけツリー（区切り＋インデント）
  let cols = activeColumns(state);
  if (grouped) cols = cols.filter(k => k !== 'project' && k !== 'mid');   // ツリー表示時は PJ/中項目を見出し行に一本化（列は隠す）

  // 再描画でコントロールが作り直されてもフォーカスを保つ: 直前のフォーカス先を記録
  const active = document.activeElement;
  const refocus = (active && mount.contains(active) && active.dataset && active.dataset.fkey) ? active.dataset.fkey : null;

  mount.innerHTML = '';
  mount.appendChild(buildViewBar(store, requestRender, state));
  mount.appendChild(buildControls(store, requestRender, state, rows.length, all.length));
  if (state._focusProj != null) mount.appendChild(projFocusCrumb(store, requestRender, state));   // プロジェクトフォーカス中のパンくず

  const table = document.createElement('table');
  table.className = 'list-table' + (grouped ? ' list-tree' : '');   // ツリー表示は状態列を広げてインデント分を確保（#5 重なり解消）
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
    // #5 中項目が全く無いPJでも「（中項目なし）」見出しを出してインデントを統一（全グループを mid あり扱い）
    if (grouped) for (const t of rows){ const g = t.proj || ''; counts[g] = (counts[g] || 0) + 1; projHasMid[g] = true; }
    const midCnt = grouped ? midCounts(rows) : {};   // #1 中項目ごとの件数（折りたたみバッジ用）
    const midColl = state._midCollapsed || (state._midCollapsed = {});
    let curGroup, curMid, skip = false, midSkip = false;
    for (const t of rows){
      const g = t.proj || '';
      if (grouped && g !== curGroup){
        curGroup = g; curMid = undefined; skip = !!collapsed[g];
        tb.appendChild(groupRow(store, g, cols.length, counts[g], !!collapsed[g],
          () => { collapsed[g] = !collapsed[g]; requestRender(); },
          !projHasMid[g] ? () => doAddTask(store, requestRender, { proj: g || undefined }, today) : null));   // 中項目なしPJのみ見出しに追加ボタン
      }
      if (grouped && skip) continue;                 // プロジェクト折りたたみ中はタスク行を出さない
      if (grouped && projHasMid[g]){                 // 中項目の小見出し（中項目を使うPJのみ）
        const m = t.mid || '';
        if (m !== curMid){
          curMid = m; midSkip = midIsColl(midColl, g, m);
          tb.appendChild(midRow(g, m, cols.length, midSkip, () => { midSetColl(midColl, g, m, !midIsColl(midColl, g, m)); requestRender(); }, midCnt[midKeyOf(g, m)],
            () => doAddTask(store, requestRender, { proj: g || undefined, mid: m || undefined }, today)));   // 見出し右端に追加ボタン
        }
      } else { midSkip = false; }
      if (midSkip) continue;                         // 中項目折りたたみ中はそのタスクを出さない
      const tr = document.createElement('tr');
      tr.dataset.task = t.id; tr.dataset.proj = g; tr.dataset.mid = t.mid || '';
      if (t.done) tr.classList.add('row-done');
      if (state._sel && state._sel.has(t.id)) tr.classList.add('row-sel');   // 行選択中のハイライト
      for (const k of cols) tr.appendChild(COLUMNS[k].render(store, requestRender, t));
      if (grouped && tr.firstChild) tr.firstChild.style.paddingLeft = (projHasMid[g] ? 48 : 18) + 'px';   // ツリーのインデント（中項目より明確に深く・#3）
      if (grouped){                                    // D&Dで中項目移動（同PJ内のみ）
        tr.draggable = true;
        tr.addEventListener('dragstart', (e) => { _dragTask = { id: t.id, proj: g }; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', t.id); } catch(_){} });
        tr.addEventListener('dragend', () => { _dragTask = null; clearDropHi(); });
      }
      tr.addEventListener('click', (e) => {            // クリックで行を選択（タイトルにフォーカス→ tr:focus-within で行全体ハイライト）
        if (e.target.closest('.list-title')) return;   // 編集中の入力からはフォーカスを奪わない
        clearListSel(tb);                              // 明示的な複数選択は解除
        const chip = tr.querySelector('.title-chip'); if (chip) chip.focus();
      });
      tb.appendChild(tr);
    }
  }
  tb.addEventListener('dragover', (e) => {
    if (!_dragTask) return;
    const info = dropInfo(e.target.closest && e.target.closest('tr'));
    if (info && canDropTask(store, _dragTask.id, info.proj)){ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; hiRow(e.target.closest('tr')); }
    else { clearDropHi(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; }
  });
  tb.addEventListener('drop', (e) => {
    if (!_dragTask) return;
    const info = dropInfo(e.target.closest && e.target.closest('tr'));
    if (info && canDropTask(store, _dragTask.id, info.proj)){
      e.preventDefault();
      const newMid = info.mid || undefined;
      if ((store.getBody(_dragTask.id).mid || '') !== (newMid || '')){ store.updateBody(_dragTask.id, { mid: newMid }); requestRender(); }
    }
    clearDropHi();
  });
  table.appendChild(tb);
  if (!grouped){                                     // ツリー以外の並べ替え: 上部に単一の追加バー（今日・PJ/中項目なし）
    const bar = document.createElement('div'); bar.className = 'list-addbar';
    const b = document.createElement('span'); b.className = 'list-add-btn'; b.textContent = '＋ タスク追加';
    b.onclick = () => doAddTask(store, requestRender, {}, today);
    bar.appendChild(b); mount.appendChild(bar);
  }
  mount.appendChild(table);

  // 中項目の入力サジェスト（既存の中項目を候補に）
  const mids = [...new Set(all.map(t => t.mid).filter(Boolean))].sort();
  const dl = document.createElement('datalist'); dl.id = 'pwt2-mids';
  mids.forEach(m => { const o = document.createElement('option'); o.value = m; dl.appendChild(o); });
  mount.appendChild(dl);

  if (refocus){ const el = mount.querySelector('[data-fkey="' + refocus + '"]'); if (el) el.focus(); }
}

// プロジェクトフォーカス中のパンくず（全体に戻る）
function projFocusCrumb(store, requestRender, state){
  const crumb = document.createElement('div'); crumb.className = 'zoom-crumb';
  const home = document.createElement('span'); home.className = 'crumb-item'; home.textContent = '全体';
  home.onclick = () => { state._focusProj = null; requestRender(); };
  const sep = document.createElement('span'); sep.className = 'crumb-sep'; sep.textContent = '›';
  const cur = document.createElement('span'); cur.className = 'crumb-item crumb-cur';
  const pid = state._focusProj;
  cur.textContent = pid ? ((store.getBody(pid) || {}).content || '(無題PJ)') : '未割当';
  crumb.appendChild(home); crumb.appendChild(sep); crumb.appendChild(cur);
  return crumb;
}

// ── 保存ビュー バー（＋プロジェクト管理）──
// リスト本体（テーブル内の先頭フォーカス可能要素）へフォーカス。#3/#4 で共用。
export function focusListBody(){
  const el = document.querySelector('#view-list .list-table .nav-head, #view-list .list-table .cell-chip, #view-list .list-table input, #view-list .list-table [tabindex]');
  if (el) el.focus();
}
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
    focusListBody();               // 選択後はリスト本体へフォーカスを戻す（#4）
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
      name: nm, groups: cloneGroups(ensureGroups(state)),
      sort: state.sort, sortDir: state.sortDir || 'asc', columns: activeColumns(state).slice(),
      showSubtasks: !!state._showSubtasks,
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

  // サブタスク表示トグル（バー右端・既定=非表示）。件数はタイトルの（n）バッジで常に分かる。
  const subLab = document.createElement('label');
  subLab.className = 'view-subtask-toggle';
  const subCb = document.createElement('input');
  subCb.type = 'checkbox'; subCb.checked = !!state._showSubtasks; subCb.dataset.fkey = 'showsubtasks';
  subCb.onchange = () => { state._showSubtasks = subCb.checked; state._viewId = null; requestRender(); };
  subLab.appendChild(subCb);
  subLab.appendChild(document.createTextNode(' サブタスクを表示'));
  bar.appendChild(subLab);
  return bar;
}
function applyView(state, v){
  state.groups = cloneGroups(viewToGroups(v));   // 新旧どちらの保存形式でも読み込める（旧形式は自動でグループへ変換）
  state.sort = v.sort || 'proj';
  state.sortDir = v.sortDir === 'desc' ? 'desc' : 'asc';
  state.columns = (v.columns && v.columns.length ? v.columns.slice() : DEFAULT_COLUMNS.slice());
  state._showSubtasks = !!v.showSubtasks;   // 旧ビューは未定義→false（非表示）＝望ましい既定
  state._viewId = v.id;
}

// ── プロジェクト管理（作成・改名・削除）──
function buildProjectManager(store, requestRender, state){
  const det = document.createElement('details');
  det.className = 'proj-manager';
  det.open = !!state._pmOpen;
  det.addEventListener('toggle', () => { state._pmOpen = det.open; });
  det.addEventListener('keydown', (e) => { if (e.key === 'Escape'){ e.preventDefault(); det.open = false; state._pmOpen = false; const su = det.querySelector('summary'); if (su) su.focus(); } });   // Esc で閉じる
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

function ensureGroups(state){
  if (!state.groups || !state.groups.length) state.groups = [defaultGroup()];
  return state.groups;
}
function cloneGroups(groups){ return groups.map(g => JSON.parse(JSON.stringify(g))); }

function dayRangeInputs(cond, touch, fkeyPrefix){
  const wrap = document.createElement('span'); wrap.className = 'filter-range';
  wrap.appendChild(document.createTextNode('今日から'));
  const from = document.createElement('input');
  from.type = 'number'; from.className = 'filter-range-input'; from.placeholder = '無制限';
  from.dataset.fkey = fkeyPrefix + ':from';
  from.value = cond.from == null ? '' : cond.from;
  from.addEventListener('change', () => { cond.from = from.value === '' ? null : Number(from.value); touch(); });
  wrap.appendChild(from);
  wrap.appendChild(document.createTextNode('〜'));
  const to = document.createElement('input');
  to.type = 'number'; to.className = 'filter-range-input'; to.placeholder = '無制限';
  to.dataset.fkey = fkeyPrefix + ':to';
  to.value = cond.to == null ? '' : cond.to;
  to.addEventListener('change', () => { cond.to = to.value === '' ? null : Number(to.value); touch(); });
  wrap.appendChild(to);
  wrap.appendChild(document.createTextNode('日'));
  return wrap;
}
function buildGroupCard(store, groups, g, i, touch){
  const card = document.createElement('div'); card.className = 'filter-group';

  const dueRow = document.createElement('div'); dueRow.className = 'filter-group-row';
  dueRow.appendChild(labelWrap('期限', selectEl([
    ['any','すべて'], ['range','範囲指定'], ['none','期限なし'],
  ], g.due.mode, v => { g.due.mode = v; touch(); }, 'g'+i+':duemode')));
  if (g.due.mode === 'range') dueRow.appendChild(dayRangeInputs(g.due, touch, 'g'+i+':due'));
  card.appendChild(dueRow);

  const doneRow = document.createElement('div'); doneRow.className = 'filter-group-row';
  doneRow.appendChild(labelWrap('完了', selectEl([
    ['any','すべて'], ['notDone','未完了のみ'], ['done','完了のみ'],
  ], g.done.mode, v => { g.done.mode = v; touch(); }, 'g'+i+':donemode')));
  if (g.done.mode === 'done') doneRow.appendChild(dayRangeInputs(g.done, touch, 'g'+i+':done'));
  card.appendChild(doneRow);

  const row3 = document.createElement('div'); row3.className = 'filter-group-row';
  const projOpts = [['all','すべて'], ['none','未割当'], ...store.listProjects().map(p => [p.id, p.content || '(無題)'])];
  row3.appendChild(labelWrap('PJ', selectEl(projOpts, g.proj, v => { g.proj = v; touch(); }, 'g'+i+':proj')));
  const midInp = document.createElement('input');
  midInp.type = 'text'; midInp.placeholder = '中項目(部分一致)'; midInp.value = g.mid || ''; midInp.setAttribute('list', 'pwt2-mids');
  midInp.dataset.fkey = 'g'+i+':mid';
  midInp.addEventListener('change', () => { g.mid = midInp.value; touch(); });
  row3.appendChild(midInp);
  row3.appendChild(labelWrap('優先度', selectEl([
    ['all','すべて'], ['0','なし'], ['1','低'], ['2','中'], ['3','高'],
  ], g.prio, v => { g.prio = v; touch(); }, 'g'+i+':prio')));
  card.appendChild(row3);

  if (groups.length > 1){
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'filter-group-del'; del.textContent = '×'; del.title = 'この条件グループを削除';
    del.onclick = () => { groups.splice(i, 1); touch(); };
    card.appendChild(del);
  }
  return card;
}
function buildFilterGroups(store, state, touch){
  const groups = ensureGroups(state);
  const wrap = document.createElement('div'); wrap.className = 'filter-groups';
  groups.forEach((g, i) => wrap.appendChild(buildGroupCard(store, groups, g, i, touch)));
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn filter-add-group'; addBtn.dataset.fkey = 'addgroup';
  addBtn.textContent = '＋ OR条件を追加';
  addBtn.onclick = () => { groups.push(defaultGroup()); touch(); };
  wrap.appendChild(addBtn);
  return wrap;
}

// ── フィルタ/並べ替え/列 バー ──
function buildControls(store, requestRender, state, shown, total){
  const wrap = document.createElement('div'); wrap.className = 'list-controls-wrap';
  const touch = () => { state._viewId = null; requestRender(); };

  // 条件バー全体を折りたたみ可能に（#7）。既定は開。件数はサマリに出し、折りたたみ時も見える。
  const det = document.createElement('details'); det.className = 'cond-collapse';
  det.open = state._condOpen !== false;
  det.addEventListener('toggle', () => { state._condOpen = det.open; });
  const sum = document.createElement('summary'); sum.className = 'cond-summary';
  sum.appendChild(document.createTextNode('条件'));
  const count = document.createElement('span'); count.className = 'list-count cond-count'; count.textContent = `${shown} / ${total} 件`;
  sum.appendChild(count);
  det.appendChild(sum);

  det.appendChild(buildFilterGroups(store, state, touch));

  const bar = document.createElement('div');
  bar.className = 'list-controls';

  bar.appendChild(labelWrap('並べ替え', selectEl([
    ['proj','プロジェクト'], ['due','期限'], ['priority','優先度'], ['created','作成日'], ['title','タイトル'],
  ], state.sort, v => { state.sort = v; touch(); }, 'sort')));

  const dirBtn = document.createElement('button');
  dirBtn.type = 'button'; dirBtn.className = 'btn sort-dir-btn'; dirBtn.dataset.fkey = 'sortdir';
  dirBtn.textContent = state.sortDir === 'desc' ? '▼ 降順' : '▲ 昇順';
  dirBtn.disabled = state.sort === 'proj';
  dirBtn.title = state.sort === 'proj' ? 'プロジェクト表示では階層順（昇降順の指定は不可）' : '';
  dirBtn.onclick = () => { state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc'; touch(); };
  bar.appendChild(dirBtn);

  bar.appendChild(buildColumnPicker(state, touch));

  det.appendChild(bar);
  wrap.appendChild(det);
  return wrap;
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
  chip.addEventListener('click', () => chip.focus());        // クリックは選択（カーソル）のみ
  chip.addEventListener('dblclick', edit);                   // ダブルクリックでその場編集（クイックリネーム）
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.altKey && !e.shiftKey){ e.preventDefault(); if (_listCtx) openTaskDetail(_listCtx.store, t.id, _listCtx.requestRender); }   // Enter=詳細モード
    else navKey(e);
  });
  const wrap = document.createElement('div'); wrap.className = 'c-title-wrap';
  wrap.appendChild(jump); wrap.appendChild(chip);
  const sub = _listCtx && _listCtx.descCount && _listCtx.descCount.get(t.id);   // 配下タスク数（>0のとき常に表示・編集不可）
  if (sub){
    const inc = (_listCtx.descIncomplete && _listCtx.descIncomplete.get(t.id)) || 0;
    const badge = document.createElement('span'); badge.className = 'title-subcount';
    badge.textContent = '（' + inc + '/' + sub + '）';
    badge.title = 'サブタスク 未完了' + inc + ' / 全体' + sub + ' 件';
    wrap.appendChild(badge);
  }
  td.appendChild(wrap); return td;
}
// 表示専用チップ（#行選択: 個別フォーカス/クリック選択なし・純粋な表示）。優先度/期限等の編集は行を選択して Enter→詳細で。
function displayChip({ text, muted, color, cls }){
  const chip = document.createElement('span');
  chip.className = 'cell-chip' + (muted ? ' none' : '') + (cls ? ' ' + cls : '');
  chip.textContent = text;
  if (color) chip.style.color = color;
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
  if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){   // Alt+Shift+↑↓=プロジェクト並べ替え（PJ見出し上で）
    const el = e.currentTarget;
    if (_listCtx && el.classList && el.classList.contains('nav-head') && el.dataset.proj && !('mid' in el.dataset)){
      e.preventDefault();
      if (_listCtx.store.moveProject(el.dataset.proj, e.key === 'ArrowUp' ? -1 : 1)) _listCtx.requestRender();
    }
    return;
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')){   // Alt+↓=PJにフォーカス / Alt+↑=全体へ
    if (!_listCtx) return;
    const st = _listCtx.state;
    if (e.key === 'ArrowUp'){
      if (st._focusProj != null){ e.preventDefault(); st._focusProj = null; _listCtx.requestRender(); }   // 解除（フォーカスは data-fkey で復元）
      return;
    }
    const el = e.currentTarget;
    let proj = null;
    if (el.classList && el.classList.contains('nav-head')) proj = el.dataset.proj || '';
    else { const tr = el.closest && el.closest('tr'); if (tr && tr.dataset.task) proj = tr.dataset.proj || ''; }
    if (proj != null){ e.preventDefault(); st._focusProj = proj; _listCtx.requestRender(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){ collapseKey(e); return; }   // #3 カスケード折りたたみ/展開
  const el0 = e.currentTarget; const tr0 = el0.closest && el0.closest('tr');
  // Shift+↑↓: 行選択を拡張（複数行削除のための選択）
  if (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
    if (!_listCtx || !tr0 || !tr0.dataset.task) return;
    e.preventDefault();
    const sel = _listCtx.state._sel || (_listCtx.state._sel = new Set());
    sel.add(tr0.dataset.task); tr0.classList.add('row-sel');
    const rs = [...tr0.parentElement.children]; let j = rs.indexOf(tr0) + (e.key === 'ArrowUp' ? -1 : 1);
    while (rs[j] && !rs[j].dataset.task) j += (e.key === 'ArrowUp' ? -1 : 1);
    if (rs[j] && rs[j].dataset.task){ sel.add(rs[j].dataset.task); rs[j].classList.add('row-sel'); focusRowCol(rs, j, el0.dataset.col || null); }
    return;
  }
  // Delete/Backspace: 選択行（無ければ現在行）を削除
  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey){
    if (!_listCtx || !tr0 || !tr0.dataset.task) return;
    if (el0.tagName === 'INPUT' && el0.type !== 'checkbox') return;        // 編集中の入力は対象外
    if (el0.classList && el0.classList.contains('list-title')) return;     // タイトル編集中は対象外
    e.preventDefault(); deleteListRows(tr0);
    return;
  }
  if (e.key === 'Escape'){ clearListSel(tr0 && tr0.parentElement); return; }
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const el = e.currentTarget; const tr = el.closest && el.closest('tr');
  const tbody = tr && tr.parentElement; if (!tbody) return;
  const rows = [...tbody.children]; const ri = rows.indexOf(tr);
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){
    e.preventDefault();
    clearListSel(tbody);                                                   // 通常移動で選択解除
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

// ── 行の選択と削除（複数行可）──
function clearListSel(tbody){
  if (_listCtx && _listCtx.state._sel) _listCtx.state._sel.clear();
  if (tbody) tbody.querySelectorAll('tr.row-sel').forEach(r => r.classList.remove('row-sel'));
}
function deleteListRows(tr0){
  if (!_listCtx) return;
  const { store, state, requestRender } = _listCtx;
  const ids = state._sel && state._sel.size ? [...state._sel] : [tr0.dataset.task];
  const hasKids = ids.some(id => { const r = store.refsForBody(id)[0]; return r && store.childRefs(r.id).length; });
  if ((ids.length > 1 || hasKids) && !confirm(`${ids.length}件のタスク${hasKids ? '（子を含む）' : ''}を削除しますか？`)) return;
  for (const id of ids){ for (const r of store.refsForBody(id)) store.deleteRef(r.id); }
  if (state._sel) state._sel.clear();
  requestRender();
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
    } else if (kind === 'mid'){                                                                      // 中項目見出し: 段階的（配下優先）
      if (!midIsColl(midColl, proj, mid)){ midSetColl(midColl, proj, mid, true); requestRender(); focusHeader(proj, mid); }  // まず配下を畳む→中項目見出しに留まる
      else { projColl[proj] = true; requestRender(); focusHeader(proj); }                            // 既に畳み済み→PJ全体を畳む→PJ見出しへ
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
  const midDl = document.createElement('datalist'); midDl.id = 'pwt2-mids-' + body.id;
  midsForProject(store, body.proj || '').forEach(m => { const o = document.createElement('option'); o.value = m; midDl.appendChild(o); });
  const mid = document.createElement('input'); mid.type = 'text'; mid.className = 'td-input'; mid.value = body.mid || ''; mid.setAttribute('list', midDl.id);
  mid.addEventListener('change', () => store.updateBody(body.id, { mid: mid.value.trim() || undefined }));
  add('中項目', mid);
  grid.appendChild(midDl);
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

  // Tab フォーカスリング: ↗参照元 → 各項目(PJ/中項目/優先度/期限) → ノード見出し をぐるぐる。
  // ミラーの子カードにフォーカスがあるときは通常の Tab（アウトラインのインデント）に任せる。
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const ring = [box.querySelector('.td-open'), ...box.querySelectorAll('.td-fields select, .td-fields input'), box.querySelector('.zoom-title-txt')].filter(Boolean);
    const i = ring.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault(); e.stopPropagation();
    ring[(i + (e.shiftKey ? -1 : 1) + ring.length) % ring.length].focus();
  }, true);                                  // capture: ノード見出しの onKey より先に処理

  const render = () => {
    box.innerHTML = '';
    const head = document.createElement('div'); head.className = 'td-head';
    const ttl = document.createElement('span'); ttl.className = 'td-title'; ttl.textContent = 'カードの詳細';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'td-open'; open.textContent = '↗ 参照元を開く'; open.title = 'デイリー/プロジェクトの元ノードへ';
    open.onclick = () => { close(); if (_onJump) _onJump(bodyId); };
    const x = document.createElement('button'); x.type = 'button'; x.className = 'td-close'; x.textContent = '×'; x.title = '閉じる (Esc)'; x.onclick = close;
    head.appendChild(ttl); head.appendChild(open); head.appendChild(x);
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
