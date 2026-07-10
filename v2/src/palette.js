// Ctrl+K = コマンドパレット（カテゴリ折りたたみ→ドリルダウン／ローマ字インクリ検索）
// Ctrl+E = カード検索（本文一致→ジャンプ）
// 共通モーダル枠を runPalette が提供。↑↓選択／Enter実行／Escape・外側クリックで閉じる。入力欄に即フォーカス（IME安全）。
//   コマンド版は空欄でカテゴリ一覧→Enterで各項目、文字入力でローマ字対応の全項目インクリ検索。IMEはこの画面ではオフ。

let _panel = null;
let _closer = null;

export function closePalette(){
  if (_closer){ document.removeEventListener('mousedown', _closer); _closer = null; }
  if (_panel){ _panel.remove(); _panel = null; }
}

// ── ローマ字マッチ（IMEをオフにしてローマ字で検索する用。かな入力もローマ字化して照合） ──
const _KANA2 = {
  きゃ:'kya',きゅ:'kyu',きょ:'kyo',しゃ:'sha',しゅ:'shu',しょ:'sho',ちゃ:'cha',ちゅ:'chu',ちょ:'cho',
  にゃ:'nya',にゅ:'nyu',にょ:'nyo',ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',みゃ:'mya',みゅ:'myu',みょ:'myo',
  りゃ:'rya',りゅ:'ryu',りょ:'ryo',ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',じゃ:'ja',じゅ:'ju',じょ:'jo',
  びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',
  じぇ:'je',しぇ:'she',ちぇ:'che',てぃ:'ti',でぃ:'di',とぅ:'tu',どぅ:'du',
  ふぁ:'fa',ふぃ:'fi',ふぇ:'fe',ふぉ:'fo',うぃ:'wi',うぇ:'we',うぉ:'wo',
};
const _KANA1 = {
  あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',
  さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',
  な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',
  ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',
  ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',を:'wo',ん:'n',
  が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',
  だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',
  ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',ぁ:'a',ぃ:'i',ぅ:'u',ぇ:'e',ぉ:'o',ゃ:'ya',ゅ:'yu',ょ:'yo',
};
export function kanaToRomaji(str){
  // カタカナ→ひらがなに寄せてから照合
  const s = (str || '').replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  let out = '';
  for (let i = 0; i < s.length;){
    const c2 = s.substr(i, 2);
    if (_KANA2[c2]){ out += _KANA2[c2]; i += 2; continue; }
    const c = s[i];
    if (c === 'っ'){                                  // 促音: 次の子音を重ねる
      const n = kanaToRomaji(s[i + 1] || '');
      if (n) out += n[0];
      i += 1; continue;
    }
    if (c === 'ー'){ i += 1; continue; }                 // 長音記号は無視
    if (_KANA1[c]){ out += _KANA1[c]; i += 1; continue; }
    out += c; i += 1;                                 // 英数などはそのまま
  }
  return out;
}

// ヘボン式/ワープロ式のゆらぎを吸収（照合の両辺に同じ変換をかけるので一致は緩くなるだけ・崩れない）
export function canonRomaji(s){
  return (s || '')
    .replace(/tsu/g, 'tu').replace(/sha/g, 'sya').replace(/shu/g, 'syu').replace(/sho/g, 'syo')
    .replace(/cha/g, 'tya').replace(/chu/g, 'tyu').replace(/cho/g, 'tyo')
    .replace(/ja/g, 'zya').replace(/ju/g, 'zyu').replace(/jo/g, 'zyo')
    .replace(/shi/g, 'si').replace(/chi/g, 'ti').replace(/ji/g, 'zi').replace(/fu/g, 'hu');
}

// コマンド1件が検索語に一致するか（raw=原文lower / romaQ=かな→ローマ字化した語）。label/cat/roma を横断照合。
export function matchCommand(c, raw, romaQ){
  if (!raw) return true;
  const label = (c.label || '').toLowerCase();
  const cat = (c.cat || '').toLowerCase();
  if (label.includes(raw) || cat.includes(raw)) return true;
  const roma = canonRomaji((c.roma || '').toLowerCase());
  if (roma.includes(canonRomaji(raw))) return true;
  if (romaQ && romaQ !== raw && roma.includes(canonRomaji(romaQ))) return true;
  return false;
}

function runPalette({ placeholder, grouped, compute, onPick, onArrowLeft, onEscapeKeepOpen, imeOff }){
  closePalette();
  const overlay = document.createElement('div'); overlay.className = 'cmdk-overlay';
  const box = document.createElement('div'); box.className = 'cmdk-box';
  const input = document.createElement('input');
  input.className = 'cmdk-input'; input.type = 'text'; input.placeholder = placeholder; input.spellcheck = false;
  if (imeOff){                                        // この画面はIMEオフ（ローマ字検索）。best-effort＋かな入力もローマ字化して照合。
    input.classList.add('cmdk-ime-off');
    input.setAttribute('lang', 'en');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocomplete', 'off');
    try { input.style.imeMode = 'disabled'; } catch {}
  }
  const list = document.createElement('div'); list.className = 'cmdk-list';
  box.appendChild(input); box.appendChild(list); overlay.appendChild(box);
  document.body.appendChild(overlay);
  _panel = overlay;

  let items = [], sel = 0;
  const exec = (it) => {
    const r = onPick(it);
    if (r && r.keepOpen){ input.value = ''; update(); input.focus(); return; }
    closePalette();
  };
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
      const el = document.createElement('div');
      el.className = 'cmdk-item' + (i === sel ? ' sel' : '') + (it.isBack ? ' cmdk-back' : '');
      const lab = document.createElement('span'); lab.className = 'cmdk-label'; lab.textContent = it.label;
      el.appendChild(lab);
      if (it.hint){ const k = document.createElement('span'); k.className = 'cmdk-key'; k.textContent = it.hint; el.appendChild(k); }
      if (it.isCat){ const ch = document.createElement('span'); ch.className = 'cmdk-chev'; ch.textContent = '›'; el.appendChild(ch); }
      el.onmousedown = (ev) => { ev.preventDefault(); exec(it); };
      list.appendChild(el);
    });
    const s = list.querySelector('.cmdk-item.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  };
  const update = () => {
    items = compute(input.value);
    const fi = items.findIndex(it => !it.isBack);     // 「戻る」は既定選択にしない
    sel = fi < 0 ? 0 : fi;
    render();
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown'){ e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter'){ e.preventDefault(); if (items[sel]) exec(items[sel]); }
    else if (e.key === 'ArrowLeft' && onArrowLeft && input.selectionStart === 0 && input.selectionEnd === 0){
      if (onArrowLeft()){ e.preventDefault(); input.value = ''; update(); }
    }
    else if (e.key === 'Escape'){
      e.preventDefault();
      if (onEscapeKeepOpen && onEscapeKeepOpen()){ input.value = ''; update(); input.focus(); return; }
      closePalette();
    }
  });
  update();
  input.focus();
  _closer = (e) => { if (!e.target.closest('.cmdk-box')) closePalette(); };
  setTimeout(() => { if (_closer) document.addEventListener('mousedown', _closer); }, 0);
}

export function openCommandPalette({ commands }){
  const cmds = commands || [];
  const cats = [];                                    // 出現順のカテゴリ一覧
  const catOf = (c) => c.cat || 'その他';
  for (const c of cmds){ const k = catOf(c); if (!cats.includes(k)) cats.push(k); }
  let path = null;                                    // null=カテゴリ一覧 / 文字列=そのカテゴリを開いている

  runPalette({
    placeholder: 'コマンド…（ローマ字で検索）',
    grouped: true,
    imeOff: true,
    compute: (q) => {
      const raw = q.trim().toLowerCase();
      if (raw){                                       // 文字入力中＝全項目のインクリ検索（ローマ字対応）
        const romaQ = kanaToRomaji(q.trim()).toLowerCase();
        return cmds.filter(c => matchCommand(c, raw, romaQ));
      }
      if (path === null){                             // 空欄＝カテゴリ折りたたみ一覧
        return cats.map(cat => ({
          label: cat, isCat: true, _cat: cat,
          hint: String(cmds.filter(c => catOf(c) === cat).length),
        }));
      }
      const items = cmds.filter(c => catOf(c) === path).map(c => ({ ...c, cat: path }));   // 開いたカテゴリの項目
      return [{ label: '← 戻る', isBack: true }, ...items];
    },
    onPick: (it) => {
      if (it.isCat){ path = it._cat; return { keepOpen: true }; }
      if (it.isBack){ path = null; return { keepOpen: true }; }
      if (it.run) it.run();
    },
    onArrowLeft: () => { if (path !== null){ path = null; return true; } return false; },
    onEscapeKeepOpen: () => { if (path !== null){ path = null; return true; } return false; },
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
