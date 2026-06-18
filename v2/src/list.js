// リストビュー（タスク本体のレンズ）: 絞り込み→並べ替え→表で表示。
// 行で直接編集（完了・タイトル・優先度・期限）。編集は本体を更新するので全ビューに反映。

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
  if (!due) return false;                 // 以降は期限が必要
  const d = dayDiff(due, today);
  if (filter === 'overdue') return d < 0;
  if (filter === 'today')   return d <= 0; // 今日まで（期限切れ含む）
  if (filter === 'next3')   return d >= 0 && d <= 3;
  return true;
}
function dayDiff(due, today){              // due - today を日数で
  const a = Date.parse(due + 'T00:00:00');
  const b = Date.parse(today + 'T00:00:00');
  return Math.round((a - b) / 86400000);
}
function cmpStr(x, y){ x = x||''; y = y||''; return x < y ? -1 : x > y ? 1 : 0; }
function sortCmp(sort){
  if (sort === 'priority') return (a,b) => (b.prio||0) - (a.prio||0) || cmpStr(a.content, b.content);
  if (sort === 'created')  return (a,b) => cmpStr(a.createdAt, b.createdAt);
  if (sort === 'title')    return (a,b) => cmpStr(a.content, b.content);
  return (a,b) => {                        // due: 期限なしは末尾
    if (!a.due && !b.due) return cmpStr(a.content, b.content);
    if (!a.due) return 1;
    if (!b.due) return -1;
    return cmpStr(a.due, b.due) || (b.prio||0) - (a.prio||0);
  };
}

const PRIO_LABEL = ['なし', '低', '中', '高'];

// ── 描画 ──
export function renderList(store, mount, requestRender, state){
  const today = new Date().toISOString().slice(0, 10);
  const all = store.queryBodies(b => b.kind === 'task');
  const rows = selectTasks(all, state, today);

  mount.innerHTML = '';
  mount.appendChild(buildControls(requestRender, state, rows.length, all.length));

  const table = document.createElement('table');
  table.className = 'list-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th class="c-st"></th><th class="c-title">タイトル</th><th class="c-prio">優先度</th><th class="c-due">期限</th></tr>';
  table.appendChild(thead);

  const tb = document.createElement('tbody');
  if (!rows.length){
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4; td.className = 'list-empty';
    td.textContent = '該当するタスクがありません。';
    tr.appendChild(td); tb.appendChild(tr);
  } else {
    for (const t of rows) tb.appendChild(buildRow(store, requestRender, t));
  }
  table.appendChild(tb);
  mount.appendChild(table);
}

function buildControls(requestRender, state, shown, total){
  const bar = document.createElement('div');
  bar.className = 'list-controls';

  // 期限フィルタ
  bar.appendChild(labelWrap('期限', selectEl([
    ['all','すべて'], ['next3','今後3日以内'], ['today','今日まで'],
    ['overdue','期限切れ'], ['has','期限あり'], ['none','期限なし'],
  ], state.dueFilter, v => { state.dueFilter = v; requestRender(); })));

  // 並べ替え
  bar.appendChild(labelWrap('並べ替え', selectEl([
    ['due','期限'], ['priority','優先度'], ['created','作成日'], ['title','タイトル'],
  ], state.sort, v => { state.sort = v; requestRender(); })));

  // 完了を隠す
  const cbWrap = document.createElement('label');
  cbWrap.className = 'list-cb';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = !!state.hideDone;
  cb.onchange = () => { state.hideDone = cb.checked; requestRender(); };
  cbWrap.appendChild(cb);
  cbWrap.appendChild(document.createTextNode('完了を隠す'));
  bar.appendChild(cbWrap);

  const count = document.createElement('span');
  count.className = 'list-count';
  count.textContent = `${shown} / ${total} 件`;
  bar.appendChild(count);
  return bar;
}

function buildRow(store, requestRender, t){
  const tr = document.createElement('tr');
  if (t.done) tr.classList.add('row-done');

  // 完了
  const tdSt = document.createElement('td');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = !!t.done;
  cb.onchange = () => { store.updateBody(t.id, { done: cb.checked }); requestRender(); };
  tdSt.appendChild(cb); tr.appendChild(tdSt);

  // タイトル（インライン編集・入力中は再描画しない）
  const tdTitle = document.createElement('td');
  const title = document.createElement('span');
  title.className = 'list-title'; title.contentEditable = 'true'; title.spellcheck = false;
  title.textContent = t.content || '';
  title.addEventListener('input', () => store.updateBody(t.id, { content: title.textContent }));
  tdTitle.appendChild(title); tr.appendChild(tdTitle);

  // 優先度
  const tdPrio = document.createElement('td');
  tdPrio.appendChild(selectEl(
    PRIO_LABEL.map((lab, i) => [String(i), lab]),
    String(t.prio || 0),
    v => { store.updateBody(t.id, { prio: Number(v) }); requestRender(); }
  ));
  tr.appendChild(tdPrio);

  // 期限
  const tdDue = document.createElement('td');
  const due = document.createElement('input');
  due.type = 'date'; due.value = t.due || '';
  due.onchange = () => { store.updateBody(t.id, { due: due.value || '' }); requestRender(); };
  tdDue.appendChild(due); tr.appendChild(tdDue);

  return tr;
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
