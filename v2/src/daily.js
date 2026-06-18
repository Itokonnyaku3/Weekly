// デイリービュー（編集可能・最小アウトライナー）
// 入力=その場編集 / Enter=分割 / Tab・Shift+Tab=インデント / Backspace(行頭)=結合 / ↑↓=移動 /
// Ctrl+Enter=メモ⇄タスク切替 / 「•」クリックでタスク化 / 子持ちは ▾▸ で折りたたみ(ref.collapsed)。
// 描画方針: テキスト入力では再描画しない（caret保持）。構造変更だけ requestRender＋caret復元。

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
      renderChildren(store, dayRef.id, sec, 0, requestRender, mount);
      // 各日の末尾に「＋ 追加」
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
}

function renderChildren(store, parentRefId, mountEl, depth, requestRender, root){
  for (const ref of store.childRefs(parentRefId)){
    const body = store.getBody(ref.bodyId);
    if (!body) continue;
    const kids = store.childRefs(ref.id);

    const row = document.createElement('div');
    row.className = 'card-row';
    row.style.paddingLeft = (depth * 18) + 'px';

    // 折りたたみトグル（子がある時のみ）
    const tog = document.createElement('span');
    tog.className = 'card-toggle';
    if (kids.length){
      tog.textContent = ref.collapsed ? '▸' : '▾';
      tog.title = ref.collapsed ? '展開' : '折りたたみ';
      tog.onclick = () => { store.updateRef(ref.id, { collapsed: !ref.collapsed }); requestRender(); };
    } else {
      tog.classList.add('leaf');
    }
    row.appendChild(tog);

    // マーカー（タスク=チェックボックス / メモ=•）
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

    // テキスト（contenteditable）
    const txt = document.createElement('span');
    txt.className = 'card-txt';
    txt.contentEditable = 'true';
    txt.spellcheck = false;
    txt.dataset.ref = ref.id;
    txt.textContent = body.content || '';
    if (body.kind === 'task' && body.done) txt.classList.add('done');
    txt.addEventListener('input', () => store.updateBody(body.id, { content: txt.textContent }));
    txt.addEventListener('keydown', (e) => onKey(e, store, ref, body, requestRender, root));
    row.appendChild(txt);

    mountEl.appendChild(row);
    if (kids.length && !ref.collapsed) renderChildren(store, ref.id, mountEl, depth + 1, requestRender, root);
  }
}

function onKey(e, store, ref, body, requestRender, root){
  if (e.isComposing || e.keyCode === 229) return; // IME変換中は素通り

  const el = e.target;
  const text = el.textContent;
  const pos = caretOffset(el);

  // Ctrl/Cmd+Enter: メモ⇄タスク切替
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
      if (store.getBody(parentRef.bodyId)?.kind === 'day') return; // 日直下より上には出さない
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

// ── caret / 走査ヘルパ ──
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
  const walk = (refId) => {
    for (const r of store.childRefs(refId)){
      out.push(r.id);
      if (!r.collapsed) walk(r.id);          // 折りたたみ中は中へ入らない
    }
  };
  for (const day of days){
    const dayRef = store.refsForBody(day.id).find(r => r.parentRefId === null);
    if (dayRef) walk(dayRef.id);
  }
  return out;
}
