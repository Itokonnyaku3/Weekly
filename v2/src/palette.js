// Ctrl+K コマンドパレット＋カード検索（1つの窓でコマンド実行とカード本文検索）。
// 日本語入力のまま検索可。↑↓選択／Enter実行／Escape閉じる／外側クリックで閉じる。

let _panel = null;
let _closer = null;

export function openPalette({ store, commands, onJump }){
  closePalette();
  const overlay = document.createElement('div'); overlay.className = 'cmdk-overlay';
  const box = document.createElement('div'); box.className = 'cmdk-box';
  const input = document.createElement('input');
  input.className = 'cmdk-input'; input.type = 'text'; input.placeholder = 'コマンド or カード検索…'; input.spellcheck = false;
  const list = document.createElement('div'); list.className = 'cmdk-list';
  box.appendChild(input); box.appendChild(list); overlay.appendChild(box);
  document.body.appendChild(overlay);
  _panel = overlay;

  let items = [], sel = 0;

  const compute = (q) => {
    const ql = q.trim().toLowerCase();
    const cmds = (commands || [])
      .filter(c => !ql || c.label.toLowerCase().includes(ql))
      .map(c => ({ label: c.label, hint: c.hint || 'コマンド', run: c.run }));
    let cards = [];
    if (ql){
      cards = store.queryBodies(b => (b.kind === 'task' || b.kind === 'memo') && (b.content || '').toLowerCase().includes(ql))
        .slice(0, 10)
        .map(b => ({ label: b.content || '(空)', hint: b.kind === 'task' ? (b.done ? '完了' : 'タスク') : 'メモ', run: () => onJump(b.id) }));
    }
    return [...cmds, ...cards];
  };
  const render = () => {
    list.innerHTML = '';
    if (!items.length){
      const e = document.createElement('div'); e.className = 'cmdk-empty'; e.textContent = '該当なし';
      list.appendChild(e); return;
    }
    items.forEach((it, i) => {
      const el = document.createElement('div'); el.className = 'cmdk-item' + (i === sel ? ' sel' : '');
      const lab = document.createElement('span'); lab.className = 'cmdk-label'; lab.textContent = it.label;
      const hint = document.createElement('span'); hint.className = 'cmdk-hint'; hint.textContent = it.hint;
      el.appendChild(lab); el.appendChild(hint);
      el.onmousedown = (ev) => { ev.preventDefault(); exec(it); };
      list.appendChild(el);
    });
    const s = list.querySelector('.cmdk-item.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  };
  const exec = (it) => { closePalette(); if (it && it.run) it.run(); };
  const update = () => { items = compute(input.value); sel = 0; render(); };

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown'){ e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter'){ e.preventDefault(); if (items[sel]) exec(items[sel]); }
    else if (e.key === 'Escape'){ e.preventDefault(); closePalette(); }
  });
  update();
  input.focus();
  _closer = (e) => { if (!e.target.closest('.cmdk-box')) closePalette(); };
  setTimeout(() => { if (_closer) document.addEventListener('mousedown', _closer); }, 0);
}

export function closePalette(){
  if (_closer){ document.removeEventListener('mousedown', _closer); _closer = null; }
  if (_panel){ _panel.remove(); _panel = null; }
}
