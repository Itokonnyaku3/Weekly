// 最小デイリービュー（フェーズ2の最初のスライス・読み取り中心）
// 付箋ツリーをそのまま描画する。編集/キーボード/IME は後続で載せる。

export function renderDaily(store, mount){
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

    if (dayRef) renderChildren(store, dayRef.id, sec, 0);
    mount.appendChild(sec);
  }
}

function renderChildren(store, parentRefId, mount, depth){
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
      cb.onchange = () => store.updateBody(body.id, { done: cb.checked });
      row.appendChild(cb);
    } else {
      const dot = document.createElement('span');
      dot.className = 'card-dot';
      dot.textContent = '•';
      row.appendChild(dot);
    }

    const txt = document.createElement('span');
    txt.className = 'card-txt';
    txt.textContent = body.content || '(空)';
    if (body.kind === 'task' && body.done) txt.classList.add('done');
    row.appendChild(txt);

    mount.appendChild(row);
    renderChildren(store, ref.id, mount, depth + 1); // 子（付箋ツリー）を再帰描画
  }
}
