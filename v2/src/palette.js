// Ctrl+K = コマンドパレット（カテゴリ・ショートカット表示・インクリ検索）
// Ctrl+E = カード検索（本文一致→ジャンプ）
// 共通モーダル枠を runPalette が提供。↑↓選択／Enter実行／Escape・外側クリックで閉じる。入力欄に即フォーカス（IME安全）。

let _panel = null;
let _closer = null;

export function closePalette(){
  if (_closer){ document.removeEventListener('mousedown', _closer); _closer = null; }
  if (_panel){ _panel.remove(); _panel = null; }
}

function runPalette({ placeholder, grouped, compute, onPick }){
  closePalette();
  const overlay = document.createElement('div'); overlay.className = 'cmdk-overlay';
  const box = document.createElement('div'); box.className = 'cmdk-box';
  const input = document.createElement('input');
  input.className = 'cmdk-input'; input.type = 'text'; input.placeholder = placeholder; input.spellcheck = false;
  const list = document.createElement('div'); list.className = 'cmdk-list';
  box.appendChild(input); box.appendChild(list); overlay.appendChild(box);
  document.body.appendChild(overlay);
  _panel = overlay;

  let items = [], sel = 0;
  const exec = (it) => { closePalette(); if (it) onPick(it); };
  const render = () => {
    list.innerHTML = '';
    if (!items.length){
      const e = document.createElement('div'); e.className = 'cmdk-empty';
      e.textContent = input.value.trim() ? '該当なし' : (grouped ? '' : '検索語を入力');
      if (e.textContent) list.appendChild(e);
      return;
    }
    let lastCat = null;
    items.forEach((it, i) => {
      if (grouped && it.cat && it.cat !== lastCat){
        lastCat = it.cat;
        const h = document.createElement('div'); h.className = 'cmdk-cat'; h.textContent = it.cat;
        list.appendChild(h);
      }
      const el = document.createElement('div'); el.className = 'cmdk-item' + (i === sel ? ' sel' : '');
      const lab = document.createElement('span'); lab.className = 'cmdk-label'; lab.textContent = it.label;
      el.appendChild(lab);
      if (it.hint){ const k = document.createElement('span'); k.className = 'cmdk-key'; k.textContent = it.hint; el.appendChild(k); }
      el.onmousedown = (ev) => { ev.preventDefault(); exec(it); };
      list.appendChild(el);
    });
    const s = list.querySelector('.cmdk-item.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  };
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

export function openCommandPalette({ commands }){
  runPalette({
    placeholder: 'コマンド…',
    grouped: true,
    compute: (q) => {
      const ql = q.trim().toLowerCase();
      return (commands || []).filter(c => !ql || c.label.toLowerCase().includes(ql) || (c.cat || '').toLowerCase().includes(ql));
    },
    onPick: (c) => { if (c.run) c.run(); },
  });
}

export function openSearchPalette({ store, onJump }){
  runPalette({
    placeholder: 'カードを検索…',
    grouped: false,
    compute: (q) => {
      const ql = q.trim().toLowerCase();
      if (!ql) return [];
      return store.queryBodies(b => (b.kind === 'task' || b.kind === 'memo') && (b.content || '').toLowerCase().includes(ql))
        .slice(0, 20)
        .map(b => ({ label: b.content || '(空)', hint: b.kind === 'task' ? (b.done ? '完了' : 'タスク') : 'メモ', _id: b.id }));
    },
    onPick: (it) => { if (onJump) onJump(it._id); },
  });
}
