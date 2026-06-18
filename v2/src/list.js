// リストビュー（タスク本体のレンズ）: 絞り込み→並べ替え→選んだ列で表示。
// 行で直接編集（完了・タイトル・優先度・期限）→本体更新で全ビューに反映。
// 列の選択＋カスタムビュー保存（条件＝絞り込み/並べ替え/列の組）に対応。

// ── 純ロジック（テスト対象）: タスク配列を絞り込み＋並べ替え ──
export function selectTasks(tasks, opts, today){
  const { hideDone=false, dueFilter='all', sort='due' } = opts || {};
  let out = tasks.slice();
  if (hideDone) out = out.filter(t => !t.done);
  out = out.filter(t => dueMatch(t.due, dueFilter, today));
  out.sort(sortCmp(sort));
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
function dayDiff(due, today){
  return Math.round((Date.parse(due+'T00:00:00') - Date.parse(today+'T00:00:00')) / 86400000);
}
function cmpStr(x, y){ x = x||''; y = y||''; return x < y ? -1 : x > y ? 1 : 0; }
function sortCmp(sort){
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
const COLUMNS = {
  status:   { label:'完了',       cls:'c-st',      render: cellStatus },
  title:    { label:'タイトル',   cls:'c-title',   render: cellTitle },
  project:  { label:'プロジェクト', cls:'c-proj',    render: cellProject },
  priority: { label:'優先度',     cls:'c-prio',    render: cellPriority },
  due:      { label:'期限',       cls:'c-due',     render: cellDue },
  created:  { label:'作成日',     cls:'c-created', render: cellCreated },
};
const COLUMN_ORDER = ['status', 'title', 'project', 'priority', 'due', 'created'];
export const DEFAULT_COLUMNS = ['status', 'title', 'priority', 'due'];

function activeColumns(state){
  const list = (state.columns && state.columns.length ? state.columns : DEFAULT_COLUMNS).filter(k => COLUMNS[k]);
  return list.length ? list : DEFAULT_COLUMNS;
}

// ── 描画 ──
export function renderList(store, mount, requestRender, state){
  const today = new Date().toISOString().slice(0, 10);
  const all = store.queryBodies(b => b.kind === 'task');
  const rows = selectTasks(all, state, today);
  const cols = activeColumns(state);

  mount.innerHTML = '';
  mount.appendChild(buildViewBar(store, requestRender, state));
  mount.appendChild(buildControls(requestRender, state, rows.length, all.length));

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
    for (const t of rows){
      const tr = document.createElement('tr');
      if (t.done) tr.classList.add('row-done');
      for (const k of cols) tr.appendChild(COLUMNS[k].render(store, requestRender, t));
      tb.appendChild(tr);
    }
  }
  table.appendChild(tb);
  mount.appendChild(table);
}

// ── 保存ビュー バー ──
function buildViewBar(store, requestRender, state){
  const bar = document.createElement('div');
  bar.className = 'view-bar';

  const sel = document.createElement('select');
  sel.className = 'view-select';
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
  name.addEventListener('input', () => { state._draftName = name.value; }); // 入力中は再描画しない
  bar.appendChild(name);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn'; saveBtn.textContent = '保存';
  saveBtn.onclick = () => {
    const nm = (state._draftName || '').trim();
    if (!nm){ name.focus(); return; }
    const v = store.saveView({
      name: nm, hideDone: state.hideDone, dueFilter: state.dueFilter,
      sort: state.sort, columns: activeColumns(state).slice(),
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
  return bar;
}
function applyView(state, v){
  state.hideDone = !!v.hideDone;
  state.dueFilter = v.dueFilter || 'all';
  state.sort = v.sort || 'due';
  state.columns = (v.columns && v.columns.length ? v.columns.slice() : DEFAULT_COLUMNS.slice());
  state._viewId = v.id;
}

// ── フィルタ/並べ替え/列 バー ──
function buildControls(requestRender, state, shown, total){
  const bar = document.createElement('div');
  bar.className = 'list-controls';
  const touch = () => { state._viewId = null; requestRender(); }; // 条件を触ったら保存ビュー選択を解除

  bar.appendChild(labelWrap('期限', selectEl([
    ['all','すべて'], ['next3','今後3日以内'], ['today','今日まで'],
    ['overdue','期限切れ'], ['has','期限あり'], ['none','期限なし'],
  ], state.dueFilter, v => { state.dueFilter = v; touch(); })));

  bar.appendChild(labelWrap('並べ替え', selectEl([
    ['due','期限'], ['priority','優先度'], ['created','作成日'], ['title','タイトル'],
  ], state.sort, v => { state.sort = v; touch(); })));

  const cbWrap = document.createElement('label');
  cbWrap.className = 'list-cb';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = !!state.hideDone;
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
    if (k === 'title'){ cb.checked = true; cb.disabled = true; } // タイトルは必須
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
  cb.onchange = () => { store.updateBody(t.id, { done: cb.checked }); requestRender(); };
  td.appendChild(cb); return td;
}
function cellTitle(store, requestRender, t){
  const td = document.createElement('td');
  const sp = document.createElement('span');
  sp.className = 'list-title'; sp.contentEditable = 'true'; sp.spellcheck = false;
  sp.textContent = t.content || '';
  sp.addEventListener('input', () => store.updateBody(t.id, { content: sp.textContent })); // 入力中は再描画しない
  td.appendChild(sp); return td;
}
function cellProject(store, requestRender, t){
  const td = document.createElement('td'); td.className = 'c-proj';
  const pj = t.proj ? store.getBody(t.proj) : null;
  if (pj){ td.textContent = pj.content || '(無題PJ)'; }
  else { td.textContent = '—'; td.classList.add('cell-muted'); }
  return td;
}
function cellPriority(store, requestRender, t){
  const td = document.createElement('td'); td.className = 'c-prio';
  td.appendChild(selectEl(PRIO_LABEL.map((l, i) => [String(i), l]), String(t.prio || 0),
    v => { store.updateBody(t.id, { prio: Number(v) }); requestRender(); }));
  return td;
}
function cellDue(store, requestRender, t){
  const td = document.createElement('td'); td.className = 'c-due';
  const d = document.createElement('input'); d.type = 'date'; d.value = t.due || '';
  d.onchange = () => { store.updateBody(t.id, { due: d.value || '' }); requestRender(); };
  td.appendChild(d); return td;
}
function cellCreated(store, requestRender, t){
  const td = document.createElement('td'); td.className = 'c-created cell-muted';
  td.textContent = (t.createdAt || '').slice(0, 10) || '—';
  return td;
}

// ── 小物 ──
function selectEl(options, value, onChange){
  const sel = document.createElement('select');
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
