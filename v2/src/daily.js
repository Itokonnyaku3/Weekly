// デイリービュー（編集可能・最小アウトライナー）
// 本体＋付箋モデル上にクリーン実装。挙動は現行アプリに寄せる:
//   入力=その場編集 / Enter=分割して新カード / Tab・Shift+Tab=インデント・アウトデント /
//   Backspace(行頭)=前カードへ結合 / ↑↓=カード間移動 / IME変換中は無効化。
//
// 描画方針: テキスト入力では再描画しない（caret保持）。構造が変わる操作だけ
//   requestRender() で再描画し、focusRef() で caret を復元する。

export function renderDaily(store, mount, requestRender){
  const days = store.queryBodies(b => b.kind === 'day')
    .sort((a, b) => (a.content < b.content ? 1 : -1)); // 新しい日付を上に

  mount.innerHTML = '';
  if (!days.length){
    mount.innerHTML = '<p style="color:var(--tx3)">まだカードがありません。上の「＋テストカード」で追加してみてください。</p>';
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
    if (dayRef) renderChildren(store, dayRef.id, sec, 0, requestRender, mount);
    mount.appendChild(sec);
  }
}

function renderChildren(store, parentRefId, mountEl, depth, requestRender, root){
  for (const ref of store.childRefs(parentRefId)){
    const body = store.getBody(ref.bodyId);
    if (!body) continue;

    const row = document.createElement('div');
    row.className = 'card-row';
    row.style.paddingLeft = (depth * 18) + 'px';

    if (body.kind === 'task'){
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!body.done;
      cb.onchange = () => { store.updateBody(body.id, { done: cb.checked }); requestRender(); };
      row.appendChild(cb);
    } else {
      const dot = document.createElement('span');
      dot.className = 'card-dot';
      dot.textContent = '•';
      row.appendChild(dot);
    }

    const txt = document.createElement('span');
    txt.className = 'card-txt';
    txt.contentEditable = 'true';
    txt.spellcheck = false;
    txt.dataset.ref = ref.id;
    txt.textContent = body.content || '';
    if (body.kind === 'task' && body.done) txt.classList.add('done');

    txt.addEventListener('input', () => {
      store.updateBody(body.id, { content: txt.textContent }); // 保存のみ・再描画しない
    });
    txt.addEventListener('keydown', (e) => onKey(e, store, ref, body, requestRender, root));

    row.appendChild(txt);
    mountEl.appendChild(row);
    renderChildren(store, ref.id, mountEl, depth + 1, requestRender, root); // 子を再帰（フラットDOM＋字下げ）
  }
}

function onKey(e, store, ref, body, requestRender, root){
  if (e.isComposing || e.keyCode === 229) return; // IME変換中は素通り（誤分割防止）

  const el = e.target;
  const text = el.textContent;
  const pos = caretOffset(el);

  if (e.key === 'Enter'){
    e.preventDefault();
    const before = text.slice(0, pos);
    const after  = text.slice(pos);
    store.updateBody(body.id, { content: before });
    const created = store.createCard({
      kind: body.kind,                 // 種類を継承（タスク→タスク）
      content: after,
      proj: body.proj,                 // 帰属PJを継承
      parentRefId: ref.parentRefId,
      order: store.orderAfter(ref.id)
    });
    requestRender();
    focusRef(root, created.ref.id, 0);
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
      if (!prev) return;               // 前兄弟が無ければインデント不可
      store.updateRef(ref.id, { parentRefId: prev.id, order: store.endOrder(prev.id) });
    }
    requestRender();
    focusRef(root, ref.id, pos);
    return;
  }

  if (e.key === 'Backspace' && pos === 0 && window.getSelection().isCollapsed){
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (idx <= 0) return;              // 先頭カードは既定動作
    e.preventDefault();
    const prevRefId = flat[idx - 1];
    const prevBody  = store.getBody(store.getRef(prevRefId).bodyId);
    const mergePos  = (prevBody.content || '').length;
    store.updateBody(prevBody.id, { content: (prevBody.content || '') + text });
    for (const child of store.childRefs(ref.id)){ // 子は前カードへ引き継ぐ
      store.updateRef(child.id, { parentRefId: prevRefId, order: store.endOrder(prevRefId) });
    }
    store.deleteRef(ref.id);
    requestRender();
    focusRef(root, prevRefId, mergePos);
    return;
  }

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    const target = e.key === 'ArrowUp' ? flat[idx - 1] : flat[idx + 1];
    if (!target) return;              // 端なら既定
    e.preventDefault();
    focusRef(root, target, pos);
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
  else {
    const len = node.textContent.length;
    r.setStart(node, pos < 0 ? len : Math.min(pos, len));
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}
function focusRef(root, refId, pos){
  const el = root.querySelector(`.card-txt[data-ref="${refId}"]`);
  if (el) setCaret(el, pos);
}
function visibleFlat(store){
  const out = [];
  const days = store.queryBodies(b => b.kind === 'day').sort((a, b) => (a.content < b.content ? 1 : -1));
  const walk = (refId) => { for (const r of store.childRefs(refId)){ out.push(r.id); walk(r.id); } };
  for (const day of days){
    const dayRef = store.refsForBody(day.id).find(r => r.parentRefId === null);
    if (dayRef) walk(dayRef.id);
  }
  return out;
}
