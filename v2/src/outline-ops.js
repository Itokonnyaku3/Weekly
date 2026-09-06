// アウトラインの構造操作（インデント/アウトデント/分割/結合/並べ替え/削除）を集約する。
// DOM に触れない純ロジック。呼び出し側が requestRender() と focusCard() を行う。
//
// なぜ集約するか: 以前は同じ処理が daily.js の2箇所（テキストカード用とブロック用）に
// コピーされ、可視範囲から出さないためのガードが片方にしか無かった。その結果、
// ズーム中にアウトデントするとカードが画面から消える不具合が生じていた。
// 移動先の判定は必ず wouldEscape() を通す。各操作が個別に境界を判断してはならない。
//
// scope = { rootRef: string|null }
//   rootRef 非null … ズーム/プロジェクトページ。境界 = rootRef のサブツリー
//   rootRef null   … 全日表示。境界 = それぞれの day カードのサブツリー

// refId の祖先 ref.id を根まで列挙する（自分自身は含まない）
export function ancestorRefIds(store, refId){
  const out = [];
  let r = store.getRef(refId);
  while (r && r.parentRefId){ out.push(r.parentRefId); r = store.getRef(r.parentRefId); }
  return out;
}

// refId が属する day カードの ref.id（見つからなければ null）
export function dayRefIdOf(store, refId){
  let cur = refId;
  while (cur){
    const r = store.getRef(cur); if (!r) return null;
    const b = store.getBody(r.bodyId);
    if (b && b.kind === 'day') return r.id;
    cur = r.parentRefId;
  }
  return null;
}

// refId が scope の内側にあるか。strict=true は境界のルート自身を除く
// （ズームなら rootRef、全日表示なら day カード。どちらもページの器であって編集対象ではない）
export function inScope(store, refId, scope, { strict = false } = {}){
  const root = scope && scope.rootRef;
  if (root){
    if (refId === root) return !strict;
    return ancestorRefIds(store, refId).includes(root);
  }
  const d = dayRefIdOf(store, refId);
  if (d === null) return false;
  return !(strict && d === refId);
}

// refId を newParentRefId の下へ移したとき、scope の外へ出るか
export function wouldEscape(store, refId, newParentRefId, scope){
  if (newParentRefId == null) return true;
  const root = scope && scope.rootRef;
  if (root){
    if (newParentRefId === root) return false;
    return !ancestorRefIds(store, newParentRefId).includes(root);
  }
  const from = dayRefIdOf(store, refId);
  const to   = dayRefIdOf(store, newParentRefId);
  return !from || from !== to;
}

// refId と targetRefId が同じ境界の中にあるか（結合の可否判定に使う）
export function sameScopeUnit(store, refId, targetRefId, scope){
  const root = scope && scope.rootRef;
  if (root){
    return inScope(store, refId, scope, { strict:true })
        && inScope(store, targetRefId, scope, { strict:true });
  }
  const a = dayRefIdOf(store, refId), b = dayRefIdOf(store, targetRefId);
  return !!a && a === b;
}

const isRoot = (refId, scope) => !!(scope && scope.rootRef) && refId === scope.rootRef;

// Tab: 直前の兄弟の子にする
export function indent(store, refId, scope){
  if (!refId || isRoot(refId, scope)) return false;
  const prev = store.prevSiblingRef(refId);
  if (!prev) return false;
  if (wouldEscape(store, refId, prev.id, scope)) return false;
  store.updateRef(refId, { parentRefId: prev.id, order: store.endOrder(prev.id) });
  return true;
}

// Shift+Tab: 親の直後の兄弟にする
export function outdent(store, refId, scope){
  if (!refId || isRoot(refId, scope)) return false;
  const ref = store.getRef(refId);
  if (!ref || !ref.parentRefId) return false;
  const parentRef = store.getRef(ref.parentRefId);
  if (!parentRef) return false;
  const pb = store.getBody(parentRef.bodyId);
  if (pb && pb.kind === 'day') return false;              // day 直下からは出さない
  if (wouldEscape(store, refId, parentRef.parentRefId, scope)) return false;
  store.updateRef(refId, { parentRefId: parentRef.parentRefId, order: store.orderAfter(parentRef.id) });
  return true;
}

// Alt+Shift+↑↓: 兄弟内で並べ替える（dir: -1 上 / +1 下）
export function moveSibling(store, refId, dir, scope){
  if (!refId || isRoot(refId, scope)) return false;
  const sibs = store.siblings(refId);
  const i = sibs.findIndex(x => x.id === refId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return false;
  const oi = sibs[i].order, oj = sibs[j].order;   // 更新で参照が変わるため先に退避
  store.updateRef(sibs[i].id, { order: oj });
  store.updateRef(sibs[j].id, { order: oi });
  return true;
}

// Enter: カーソル位置で分割する。text/pos は呼び出し側（DOM）が渡す。
// 戻り値 { focusRefId, focusPos } … 呼び出し側はこれで focusCard する
export function splitCard(store, refId, pos, text, scope){
  if (!refId || isRoot(refId, scope)) return null;
  const ref = store.getRef(refId); if (!ref) return null;
  const body = store.getBody(ref.bodyId); if (!body) return null;
  if (wouldEscape(store, refId, ref.parentRefId, scope)) return null;
  const prefix = text.slice(0, pos), suffix = text.slice(pos);
  if (!suffix){                                  // 行末: 下に空カードを作りそこへ移る
    store.updateBody(body.id, { content: prefix });
    const created = store.createCard({
      kind: body.kind, content: '', proj: body.proj,
      parentRefId: ref.parentRefId, order: store.orderAfter(ref.id),
    });
    return { focusRefId: created.ref.id, focusPos: 0 };
  }
  // 行頭/行中: 前半を直前に切り出し、後半と子は元カードに残す（Workflowy 風）
  store.updateBody(body.id, { content: suffix });
  store.createCard({
    kind: body.kind, content: prefix, proj: body.proj, mid: body.mid,
    parentRefId: ref.parentRefId, order: store.orderBefore(ref.id),
  });
  return { focusRefId: ref.id, focusPos: 0 };
}

// 行頭 Backspace: targetRefId（直前の可視カード）へ結合する
export function mergeCard(store, refId, targetRefId, text, scope){
  if (!refId || !targetRefId || isRoot(refId, scope)) return null;
  if (!sameScopeUnit(store, refId, targetRefId, scope)) return null;
  const targetRef = store.getRef(targetRefId); if (!targetRef) return null;
  const targetBody = store.getBody(targetRef.bodyId); if (!targetBody) return null;
  if (targetBody.kind === 'table' || targetBody.kind === 'image') return null;   // 表/画像へは結合しない
  const mergePos = (targetBody.content || '').length;
  store.updateBody(targetBody.id, { content: (targetBody.content || '') + text });
  for (const child of store.childRefs(refId)){
    store.updateRef(child.id, { parentRefId: targetRefId, order: store.endOrder(targetRefId) });
  }
  store.deleteRef(refId);
  return { focusRefId: targetRefId, focusPos: mergePos };
}

// 選択されたカード群のうち、実際に削除すべきルートだけを返す。
// ・子孫が同時に選ばれていれば親だけ（deleteRef が子を連鎖削除するため）
// ・境界のルート（ズームの rootRef / 全日表示の day カード）は除外する
//   ズーム中は visibleFlat の先頭がルート自身なので Shift+↑ で選択できてしまう
export function deletableRoots(store, refIds, scope){
  // 先に境界外（ルート自身）を除いてから親子デデュープする。順序を逆にすると、
  // 「ルートとその子」が両方選ばれたとき、ルートは削除されないのに子まで
  // 「ルートの子だから」という理由で誤って除外されてしまう。
  const inside = refIds.filter(id => inScope(store, id, scope, { strict:true }));
  const set = new Set(inside);
  return inside.filter(id => {
    let p = store.getRef(id)?.parentRefId;
    while (p){ if (set.has(p)) return false; p = store.getRef(p)?.parentRefId; }
    return true;
  });
}

// Ctrl+Shift+Backspace: 子ごと削除する
export function deleteCard(store, refId, scope){
  if (!refId || isRoot(refId, scope)) return false;
  if (!inScope(store, refId, scope, { strict:true })) return false;
  store.deleteRef(refId);
  return true;
}
