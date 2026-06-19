// デイリービュー（編集可能・最小アウトライナー）
// 入力=その場編集 / Enter=分割 / Tab・Shift+Tab=インデント / Backspace(行頭)=結合 / ↑↓=移動 /
// Ctrl+Enter=メモ⇄タスク / 「•」クリックでタスク化 / 子持ちは ▾▸ で折りたたみ(ref.collapsed) /
// 「⋯」で行メニュー（メモ⇄タスク・優先度・期限・プロジェクト割当・削除）。
// 描画方針: テキスト入力では再描画しない（caret保持）。構造変更だけ requestRender＋caret復元。

let _openMenu = null;       // 行メニューを開いている ref.id（再描画をまたいで保持）
let _menuCloser = null;     // 外側クリックで閉じる document リスナ
let _dragRef = null;        // ドラッグ中のカード ref.id
let _slashPanel = null;     // スラッシュメニューの DOM（document.body 直下に浮かせる）
let _slashCloser = null;    // スラッシュメニュー外側クリック close

export function renderDaily(store, mount, requestRender){
  const days = store.queryBodies(b => b.kind === 'day')
    .sort((a, b) => (a.content < b.content ? 1 : -1)); // 新しい日付を上に

  mount.innerHTML = '';
  if (!days.length){
    mount.innerHTML = '<p style="color:var(--tx3)">まだカードがありません。右上の「＋ 今日に追加」で始めてください。</p>';
    return;
  }
  for (const day of days){
    const dayRef = store.refsForBody(day.id).find(r => r.parentRefId === null);
    const sec = document.createElement('div');
    sec.className = 'day-sec';
    const head = document.createElement('div');
    head.className = 'day-head';
    head.textContent = day.content;
    sec.appendChild(head);
    if (dayRef){
      renderChildren(store, dayRef.id, sec, 0, requestRender);
      const add = document.createElement('div');
      add.className = 'card-add'; add.textContent = '＋ 追加';
      add.onclick = () => {
        const { ref } = store.createCard({ kind:'task', content:'', parentRefId: dayRef.id });
        requestRender();
        focusCard(ref.id, 0);
      };
      sec.appendChild(add);
    }
    mount.appendChild(sec);
  }
  manageOutsideClose(requestRender);   // メニューが開いていれば外側クリックで閉じる
}

function renderChildren(store, parentRefId, mountEl, depth, requestRender){
  for (const ref of store.childRefs(parentRefId)){
    const body = store.getBody(ref.bodyId);
    if (!body) continue;
    const kids = store.childRefs(ref.id);

    const row = document.createElement('div');
    row.className = 'card-row';
    row.style.paddingLeft = (depth * 18) + 'px';
    setupRowDrop(row, ref.id, store, requestRender);

    // ドラッグハンドル
    const handle = document.createElement('span');
    handle.className = 'card-drag'; handle.textContent = '⠿'; handle.title = 'ドラッグで移動';
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => { _dragRef = ref.id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', ref.id); } catch(_){} });
    handle.addEventListener('dragend', () => { _dragRef = null; clearDropIndicators(); });
    row.appendChild(handle);

    // 折りたたみトグル
    const tog = document.createElement('span');
    tog.className = 'card-toggle';
    if (kids.length){
      tog.textContent = ref.collapsed ? '▸' : '▾';
      tog.title = ref.collapsed ? '展開' : '折りたたみ';
      tog.onclick = () => { store.updateRef(ref.id, { collapsed: !ref.collapsed }); requestRender(); };
    } else { tog.classList.add('leaf'); }
    row.appendChild(tog);

    // マーカー
    if (body.kind === 'task'){
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !!body.done;
      cb.onchange = () => { store.updateBody(body.id, { done: cb.checked }); requestRender(); };
      row.appendChild(cb);
    } else {
      const dot = document.createElement('span');
      dot.className = 'card-dot'; dot.textContent = '•';
      dot.title = 'クリックでタスク化';
      dot.onclick = () => { store.updateBody(body.id, { kind:'task' }); requestRender(); focusCard(ref.id, -1); };
      row.appendChild(dot);
    }

    // テキスト
    const txt = document.createElement('span');
    txt.className = 'card-txt';
    txt.contentEditable = 'true';
    txt.spellcheck = false;
    txt.dataset.ref = ref.id;
    txt.textContent = body.content || '';
    if (body.kind === 'task' && body.done) txt.classList.add('done');
    txt.addEventListener('input', () => store.updateBody(body.id, { content: txt.textContent }));
    txt.addEventListener('keydown', (e) => onKey(e, store, ref, body, requestRender));
    row.appendChild(txt);

    // 属性の小バッジ（設定済みのみ・控えめ表示）
    appendBadges(row, store, body);

    // ⋯ メニュー
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button'; menuBtn.className = 'card-menu-btn'; menuBtn.textContent = '⋯'; menuBtn.title = '設定';
    menuBtn.onclick = (e) => { e.stopPropagation(); _openMenu = (_openMenu === ref.id ? null : ref.id); requestRender(); };
    row.appendChild(menuBtn);

    mountEl.appendChild(row);
    if (_openMenu === ref.id){
      const m = buildCardMenu(store, ref, body, requestRender);
      m.style.marginLeft = (depth * 18 + 30) + 'px';
      mountEl.appendChild(m);
    }
    if (kids.length && !ref.collapsed) renderChildren(store, ref.id, mountEl, depth + 1, requestRender);
  }
}

const PRIO_LABEL = ['なし', '低', '中', '高'];

function appendBadges(row, store, body){
  if (body.kind !== 'task') return;
  if (body.prio){ const b = document.createElement('span'); b.className = 'cd-badge prio-' + body.prio; b.textContent = PRIO_LABEL[body.prio]; row.appendChild(b); }
  if (body.due){ const b = document.createElement('span'); b.className = 'cd-badge'; b.textContent = '📅' + body.due.slice(5); row.appendChild(b); }
  if (body.proj){ const p = store.getBody(body.proj); if (p){ const b = document.createElement('span'); b.className = 'cd-badge'; b.textContent = '#' + (p.content || 'PJ'); row.appendChild(b); } }
}

function buildCardMenu(store, ref, body, requestRender){
  const menu = document.createElement('div');
  menu.className = 'card-menu';
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape'){ _openMenu = null; requestRender(); } });

  const kindBtn = document.createElement('button');
  kindBtn.type = 'button'; kindBtn.className = 'cm-btn';
  kindBtn.textContent = body.kind === 'task' ? '• メモにする' : '☐ タスクにする';
  kindBtn.onclick = () => { store.updateBody(body.id, { kind: body.kind === 'task' ? 'memo' : 'task' }); requestRender(); };
  menu.appendChild(kindBtn);

  menu.appendChild(cmField('優先度', selectEl(PRIO_LABEL.map((l, i) => [String(i), l]), String(body.prio || 0),
    v => { store.updateBody(body.id, { prio: Number(v) }); requestRender(); })));

  const due = document.createElement('input'); due.type = 'date'; due.value = body.due || '';
  due.onchange = () => { store.updateBody(body.id, { due: due.value || '' }); requestRender(); };
  menu.appendChild(cmField('期限', due));

  const projOpts = [['', '—'], ...store.listProjects().map(p => [p.id, p.content || '(無題)'])];
  menu.appendChild(cmField('PJ', selectEl(projOpts, body.proj || '',
    v => { store.updateBody(body.id, { proj: v || undefined }); requestRender(); })));

  const del = document.createElement('button');
  del.type = 'button'; del.className = 'cm-btn cm-del'; del.textContent = '削除';
  del.onclick = () => {
    const kids = store.childRefs(ref.id).length;
    if (kids && !confirm(`このカードには子が ${kids} 件あります。まとめて削除しますか？`)) return;
    store.deleteRef(ref.id); _openMenu = null; requestRender();
  };
  menu.appendChild(del);
  return menu;
}
function cmField(label, control){
  const f = document.createElement('label'); f.className = 'cm-field';
  f.appendChild(document.createTextNode(label)); f.appendChild(control);
  return f;
}

function setupRowDrop(row, refId, store, requestRender){
  row.addEventListener('dragover', (e) => {
    if (!_dragRef || _dragRef === refId) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    clearDropIndicators();
    row.classList.add(after ? 'drop-after' : 'drop-before');
    row._dropAfter = after;
  });
  row.addEventListener('dragleave', () => { row.classList.remove('drop-before', 'drop-after'); });
  row.addEventListener('drop', (e) => {
    if (!_dragRef) return;
    e.preventDefault();
    doDrop(store, _dragRef, refId, !!row._dropAfter, requestRender);
  });
}
function doDrop(store, dragId, targetId, after, requestRender){
  clearDropIndicators();
  _dragRef = null;
  if (dragId === targetId) return;
  // 循環防止: target が drag の子孫なら不可（drag が target の祖先チェーンに居たら中止）
  let p = store.getRef(targetId);
  while (p){ if (p.id === dragId) return; p = p.parentRefId ? store.getRef(p.parentRefId) : null; }
  const target = store.getRef(targetId);
  if (!target) return;
  store.updateRef(dragId, { parentRefId: target.parentRefId, order: after ? store.orderAfter(targetId) : store.orderBefore(targetId) });
  requestRender();
}
function clearDropIndicators(){
  document.querySelectorAll('.card-row.drop-before, .card-row.drop-after')
    .forEach(r => r.classList.remove('drop-before', 'drop-after'));
}

// ── スラッシュコマンドメニュー（/ で開く・絞り込み・↑↓・Enter・Escape）──
function todayISO(){ return new Date().toISOString().slice(0, 10); }
function addDaysISO(n){ const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

function buildSlashCommands(store, ref, body){
  const cmds = [
    { label: body.kind === 'task' ? '• メモにする' : '☐ タスクにする', run: () => store.updateBody(body.id, { kind: body.kind === 'task' ? 'memo' : 'task' }) },
    { label: '🔴 優先度: 高', run: () => store.updateBody(body.id, { prio: 3 }) },
    { label: '🟠 優先度: 中', run: () => store.updateBody(body.id, { prio: 2 }) },
    { label: '🔵 優先度: 低', run: () => store.updateBody(body.id, { prio: 1 }) },
    { label: '優先度: なし', run: () => store.updateBody(body.id, { prio: 0 }) },
    { label: '📅 期限: 今日', run: () => store.updateBody(body.id, { due: todayISO() }) },
    { label: '📅 期限: 明日', run: () => store.updateBody(body.id, { due: addDaysISO(1) }) },
    { label: '📅 期限: 来週', run: () => store.updateBody(body.id, { due: addDaysISO(7) }) },
    { label: '📅 期限: なし', run: () => store.updateBody(body.id, { due: '' }) },
  ];
  for (const p of store.listProjects()) cmds.push({ label: '# ' + (p.content || 'PJ'), run: () => store.updateBody(body.id, { proj: p.id }) });
  cmds.push({ label: '# プロジェクトなし', run: () => store.updateBody(body.id, { proj: undefined }) });
  cmds.push({ label: '🗑 削除', isDelete: true, run: () => store.deleteRef(ref.id) });
  return cmds;
}

function openSlashMenu(store, ref, body, requestRender, anchorEl){
  closeSlashMenu();
  const cmds = buildSlashCommands(store, ref, body);
  let filtered = cmds, sel = 0;

  const panel = document.createElement('div'); panel.className = 'slash-menu';
  const input = document.createElement('input'); input.className = 'slash-input'; input.type = 'text'; input.placeholder = 'コマンド…'; input.spellcheck = false;
  const list = document.createElement('div'); list.className = 'slash-list';
  panel.appendChild(input); panel.appendChild(list);
  document.body.appendChild(panel);
  _slashPanel = panel;

  const rect = anchorEl.getBoundingClientRect();
  panel.style.left = Math.round(rect.left) + 'px';
  panel.style.top = Math.round(rect.bottom + 4) + 'px';

  const exec = (c) => { closeSlashMenu(); c.run(); requestRender(); if (!c.isDelete) focusCard(ref.id, -1); };
  const renderList = () => {
    list.innerHTML = '';
    filtered.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'slash-item' + (i === sel ? ' sel' : '') + (c.isDelete ? ' del' : '');
      item.textContent = c.label;
      item.onmousedown = (ev) => { ev.preventDefault(); exec(c); };
      list.appendChild(item);
    });
    const selEl = list.querySelector('.slash-item.sel');
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });   // ↑↓で選択が見える位置へ追従
  };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    filtered = q ? cmds.filter(c => c.label.toLowerCase().includes(q)) : cmds;
    sel = 0; renderList();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown'){ e.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1); renderList(); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); sel = Math.max(sel - 1, 0); renderList(); }
    else if (e.key === 'Enter'){ e.preventDefault(); if (filtered[sel]) exec(filtered[sel]); }
    else if (e.key === 'Escape'){ e.preventDefault(); closeSlashMenu(); focusCard(ref.id, -1); }
  });
  renderList();
  input.focus();                                               // メニュー入力欄へ即フォーカス→IMEがカードに漏れない
  _slashCloser = (e) => { if (!e.target.closest('.slash-menu')) closeSlashMenu(); };
  setTimeout(() => { if (_slashCloser) document.addEventListener('mousedown', _slashCloser); }, 0);
}
function closeSlashMenu(){
  if (_slashCloser){ document.removeEventListener('mousedown', _slashCloser); _slashCloser = null; }
  if (_slashPanel){ _slashPanel.remove(); _slashPanel = null; }
}

function manageOutsideClose(requestRender){
  if (_menuCloser){ document.removeEventListener('mousedown', _menuCloser); _menuCloser = null; }
  if (!_openMenu) return;
  _menuCloser = (e) => {
    if (!e.target.closest('.card-menu') && !e.target.closest('.card-menu-btn')){
      _openMenu = null;
      document.removeEventListener('mousedown', _menuCloser); _menuCloser = null;
      requestRender();
    }
  };
  setTimeout(() => { if (_menuCloser) document.addEventListener('mousedown', _menuCloser); }, 0);
}

function onKey(e, store, ref, body, requestRender){
  if (e.isComposing || e.keyCode === 229) return; // IME変換中は素通り

  const el = e.target;
  const text = el.textContent;
  const pos = caretOffset(el);

  // 「/」（行頭 or 空白の直後）でスラッシュコマンドメニュー
  if (e.key === '/' && !e.ctrlKey && !e.metaKey){
    const before = text.slice(0, pos);
    if (before === '' || before.endsWith(' ')){
      e.preventDefault();
      openSlashMenu(store, ref, body, requestRender, el);
      return;
    }
  }

  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){
    e.preventDefault();
    store.updateBody(body.id, { kind: body.kind === 'task' ? 'memo' : 'task' });
    requestRender();
    focusCard(ref.id, pos);
    return;
  }
  if (e.key === 'Enter'){
    e.preventDefault();
    store.updateBody(body.id, { content: text.slice(0, pos) });
    const created = store.createCard({
      kind: body.kind, content: text.slice(pos), proj: body.proj,
      parentRefId: ref.parentRefId, order: store.orderAfter(ref.id),
    });
    requestRender();
    focusCard(created.ref.id, 0);
    return;
  }
  if (e.key === 'Tab'){
    e.preventDefault();
    if (e.shiftKey){
      const parentRef = store.getRef(ref.parentRefId);
      if (!parentRef) return;
      if (store.getBody(parentRef.bodyId)?.kind === 'day') return;
      store.updateRef(ref.id, { parentRefId: parentRef.parentRefId, order: store.orderAfter(parentRef.id) });
    } else {
      const prev = store.prevSiblingRef(ref.id);
      if (!prev) return;
      store.updateRef(ref.id, { parentRefId: prev.id, order: store.endOrder(prev.id) });
    }
    requestRender();
    focusCard(ref.id, pos);
    return;
  }
  if (e.key === 'Backspace' && pos === 0 && window.getSelection().isCollapsed){
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (idx <= 0) return;
    e.preventDefault();
    const prevRefId = flat[idx - 1];
    const prevBody = store.getBody(store.getRef(prevRefId).bodyId);
    const mergePos = (prevBody.content || '').length;
    store.updateBody(prevBody.id, { content: (prevBody.content || '') + text });
    for (const child of store.childRefs(ref.id)){
      store.updateRef(child.id, { parentRefId: prevRefId, order: store.endOrder(prevRefId) });
    }
    store.deleteRef(ref.id);
    requestRender();
    focusCard(prevRefId, mergePos);
    return;
  }
  if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
    e.preventDefault();                              // 兄弟内で上下に並べ替え
    const sibs = store.siblings(ref.id);
    const i = sibs.findIndex(x => x.id === ref.id);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (j < 0 || j >= sibs.length) return;
    const oi = sibs[i].order, oj = sibs[j].order;   // 入れ替え前に値を退避（更新で参照が変わるため）
    store.updateRef(sibs[i].id, { order: oj });
    store.updateRef(sibs[j].id, { order: oi });
    requestRender();
    focusCard(ref.id, pos);
    return;
  }
  if (e.key === 'ArrowLeft' && pos === 0 && window.getSelection().isCollapsed){
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (idx > 0){ e.preventDefault(); focusCard(flat[idx - 1], -1); return; }   // 行頭← → 前カードの文末へ
  }
  if (e.key === 'ArrowRight' && pos === text.length && window.getSelection().isCollapsed){
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (idx < flat.length - 1){ e.preventDefault(); focusCard(flat[idx + 1], 0); return; }   // 行末→ → 次カードの先頭へ
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    const target = e.key === 'ArrowUp' ? flat[idx - 1] : flat[idx + 1];
    if (!target) return;
    e.preventDefault();
    focusCard(target, pos);
    return;
  }
}

// ── caret / 走査 / 小物 ──
function caretOffset(el){
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return 0;
  return r.startOffset;
}
function setCaret(el, pos){
  el.focus();
  const node = el.firstChild;
  const sel = window.getSelection();
  const r = document.createRange();
  if (!node){ r.setStart(el, 0); }
  else { r.setStart(node, pos < 0 ? node.textContent.length : Math.min(pos, node.textContent.length)); }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}
export function focusCard(refId, pos = 0){
  const el = document.querySelector(`.card-txt[data-ref="${refId}"]`);
  if (el) setCaret(el, pos);
}
function visibleFlat(store){
  const out = [];
  const days = store.queryBodies(b => b.kind === 'day').sort((a, b) => (a.content < b.content ? 1 : -1));
  const walk = (refId) => { for (const r of store.childRefs(refId)){ out.push(r.id); if (!r.collapsed) walk(r.id); } };
  for (const day of days){
    const dayRef = store.refsForBody(day.id).find(r => r.parentRefId === null);
    if (dayRef) walk(dayRef.id);
  }
  return out;
}
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
