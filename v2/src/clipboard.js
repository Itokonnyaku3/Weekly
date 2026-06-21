// コピペ（Windows標準に寄せる）。
// - 文字選択中の Ctrl+C/X/V はブラウザ標準（テキスト）に任せる。
// - 無選択（カーソルのみ）の Ctrl+C/X はカード＋配下をシステムクリップボードへ
//   （text/plain=タブ字下げ ＋ text/html に目印 data-pwt2-clip=base64(JSON)）。
// - Ctrl+V: ①目印あり→構造復元 ②複数行テキスト→字下げで階層化しカード化 ③1行→標準貼り付け。

const b64enc = (s) => btoa(Array.from(new TextEncoder().encode(s), b => String.fromCharCode(b)).join(''));
const b64dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b), c => c.charCodeAt(0)));
const escHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ── 直列化（カード＋配下 → ノード配列＋プレーンテキスト）──
export function serializeSubtree(store, rootRefId){
  const nodes = [];
  const collect = (refId, depth) => {
    const ref = store.getRef(refId); if (!ref) return;
    const b = store.getBody(ref.bodyId); if (!b) return;
    nodes.push({ content:b.content||'', kind:b.kind||'memo', done:!!b.done, prio:b.prio||0, due:b.due||'', proj:b.proj||'', depth });
    for (const c of store.childRefs(refId)) collect(c.id, depth + 1);
  };
  collect(rootRefId, 0);
  const plain = nodes.map(n => '\t'.repeat(n.depth) + n.content).join('\n');
  return { nodes, plain };
}

export function encodeClipHtml(nodes, plain){
  const b64 = b64enc(JSON.stringify(nodes));
  return `<div data-pwt2-clip="${b64}">${escHtml(plain).replace(/\n/g,'<br>')}</div>`;
}

// ── 解析（クリップボード → ノード配列）──
export function decodeClipHtml(html){
  if (!html) return null;
  const m = html.match(/data-pwt2-clip="([^"]*)"/);
  if (!m) return null;
  try { return JSON.parse(b64dec(m[1])); } catch(e){ return null; }
}
export function parsePlainText(text){
  const out = [];
  for (const raw of String(text).split(/\r?\n/)){
    if (!raw.trim()) continue;                       // 空行は無視
    const indent = (raw.match(/^[\t ]*/) || [''])[0];
    const tabs = (indent.match(/\t/g) || []).length;
    const spaces = indent.replace(/\t/g, '').length;
    const depth = tabs + Math.floor(spaces / 2);     // タブ=1段 / 半角2スペース=1段
    out.push({ content: raw.trim(), kind:'memo', done:false, prio:0, due:'', proj:'', depth });
  }
  return out;
}

// ── 挿入（ノード配列を currentRef の後ろへ・相対深さでツリー化）──
export function insertNodes(store, currentRefId, nodes){
  const cur = store.getRef(currentRefId); if (!cur || !nodes || !nodes.length) return null;
  const topParent = cur.parentRefId;
  let firstRef = null, prevTop = currentRefId;
  const lastAtDepth = [];   // lastAtDepth[d] = 直近に作った深さ d の ref.id（親解決用）
  for (const n of nodes){
    const d = Math.max(0, n.depth | 0);
    let parentRefId, order;
    if (d === 0 || !lastAtDepth[d - 1]){
      parentRefId = topParent; order = store.orderAfter(prevTop);
    } else {
      parentRefId = lastAtDepth[d - 1]; order = store.endOrder(parentRefId);
    }
    const attrs = { kind: n.kind || 'memo', content: n.content || '', parentRefId, order };
    if (n.done) attrs.done = true;
    if (n.prio) attrs.prio = n.prio;
    if (n.due)  attrs.due  = n.due;
    if (n.proj) attrs.proj = n.proj;
    const { ref } = store.createCard(attrs);
    if (!firstRef) firstRef = ref.id;
    lastAtDepth[d] = ref.id; lastAtDepth.length = d + 1;    // より深い層は捨てる
    if (d === 0 || parentRefId === topParent) prevTop = ref.id;
  }
  return firstRef;
}

// ── DOM 配線（copy / cut / paste をシステムクリップボード経由で）──
export function installClipboard(store, requestRender, focusCard){
  const activeCard = () => {
    const el = document.activeElement;
    return (el && el.classList && el.classList.contains('card-txt') && el.dataset.ref) ? el : null;
  };

  document.addEventListener('copy', (e) => {
    const card = activeCard(); if (!card) return;
    if (!window.getSelection().isCollapsed) return;        // 文字選択中は標準コピー
    const { nodes, plain } = serializeSubtree(store, card.dataset.ref);
    e.preventDefault();
    e.clipboardData.setData('text/plain', plain);
    e.clipboardData.setData('text/html', encodeClipHtml(nodes, plain));
  });

  document.addEventListener('cut', (e) => {
    const card = activeCard(); if (!card) return;
    if (!window.getSelection().isCollapsed) return;        // 文字選択中は標準カット
    const refId = card.dataset.ref;
    const { nodes, plain } = serializeSubtree(store, refId);
    e.preventDefault();
    e.clipboardData.setData('text/plain', plain);
    e.clipboardData.setData('text/html', encodeClipHtml(nodes, plain));
    // カット＝コピー後に削除（フォーカスは前カード/親へ）
    const prev = store.prevSiblingRef(refId);
    const parentRef = store.getRef(store.getRef(refId).parentRefId);
    store.deleteRef(refId);
    requestRender();
    const target = prev ? prev.id : (parentRef && store.getBody(parentRef.bodyId)?.kind !== 'day' ? parentRef.id : null);
    if (target) focusCard(target, -1);
  });

  document.addEventListener('paste', (e) => {
    const card = activeCard(); if (!card) return;
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');
    let nodes = decodeClipHtml(html);                      // ①アプリ内の構造
    if (!nodes && plain && /\r?\n/.test(plain.trim())) nodes = parsePlainText(plain); // ②複数行テキスト
    if (!nodes || !nodes.length) return;                   // ③1行など→標準貼り付け
    e.preventDefault();
    const refId = card.dataset.ref;
    const curBody = store.getBody(store.getRef(refId).bodyId);
    const first = insertNodes(store, refId, nodes);
    // 空のカードに貼ったら、その空カードは消して貼り付け結果に置き換える
    if (curBody && !curBody.content && !store.childRefs(refId).length) store.deleteRef(refId);
    requestRender();
    if (first) focusCard(first, -1);
  });
}
