const nowIso = () => new Date().toISOString();

export function createStore(initial){
  const S = initial || { v:1, seq:0, bodies:{}, refs:{}, views:[] };
  if (!S.views) S.views = [];          // 後方互換（古い保存に views が無い場合）
  const subs = new Set();
  const emit = () => subs.forEach(fn => { try{ fn(); }catch(e){ console.error(e); } });
  const genId = (p) => p + (++S.seq);

  function createBody(attrs={}){
    const id = genId('b');
    const body = { kind:'memo', content:'', createdAt: nowIso(), ...attrs, id };
    S.bodies[id] = body; emit(); return body;
  }
  function nextOrder(parentRefId){
    const sibs = childRefs(parentRefId);
    return sibs.length ? Math.max(...sibs.map(r=>r.order)) + 1 : 0;
  }
  function createRef({ bodyId, parentRefId=null, order=null, ...rest }){
    const id = genId('r');
    const ref = { id, bodyId, parentRefId, order: order==null ? nextOrder(parentRefId) : order, ...rest };
    S.refs[id] = ref; emit(); return ref;
  }
  function createCard({ parentRefId=null, order=null, collapsed, gridWk, ...bodyAttrs }){
    const body = createBody(bodyAttrs);
    const refAttrs = { bodyId: body.id, parentRefId, order };
    if (collapsed !== undefined) refAttrs.collapsed = collapsed;
    if (gridWk !== undefined) refAttrs.gridWk = gridWk;
    const ref = createRef(refAttrs);
    return { body, ref };
  }
  const getBody = id => S.bodies[id];
  const getRef  = id => S.refs[id];
  function updateBody(id, patch){ const b=S.bodies[id]; if(b){ Object.assign(b, patch, {id}); emit(); } return b; }
  function updateRef(id, patch){ const r=S.refs[id]; if(r){ Object.assign(r, patch, {id}); emit(); } return r; }

  function childRefs(parentRefId){
    return Object.values(S.refs).filter(r => r.parentRefId === parentRefId).sort((a,b)=>a.order-b.order);
  }
  function refsForBody(bodyId){
    return Object.values(S.refs).filter(r => r.bodyId === bodyId);
  }
  function deleteRef(refId){
    const ref = S.refs[refId];
    if (!ref) return;
    for (const child of childRefs(refId)) deleteRef(child.id); // 子付箋を連鎖削除
    delete S.refs[refId];
    if (refsForBody(ref.bodyId).length === 0) delete S.bodies[ref.bodyId]; // 参照ゼロ→GC
    emit();
  }
  function queryBodies(pred){ return Object.values(S.bodies).filter(pred); }
  function ensureDayCard(date){
    let body = Object.values(S.bodies).find(b => b.kind==='day' && b.content===date);
    if (body){
      const ref = refsForBody(body.id).find(r => r.parentRefId===null)
               || createRef({ bodyId: body.id, parentRefId: null });
      return { body, ref };
    }
    return createCard({ kind:'day', content:date, parentRefId:null });
  }

  // ── 構造編集ヘルパ（インデント/アウトデント/分割の順序計算）──
  function siblings(refId){
    const r = S.refs[refId]; if (!r) return [];
    return childRefs(r.parentRefId);
  }
  function prevSiblingRef(refId){
    const sibs = siblings(refId);
    const i = sibs.findIndex(r => r.id === refId);
    return i > 0 ? sibs[i-1] : null;
  }
  function orderAfter(refId){            // refId の直後に差し込む order（兄弟間・分数）
    const r = S.refs[refId]; if (!r) return 0;
    const sibs = childRefs(r.parentRefId);
    const i = sibs.findIndex(x => x.id === refId);
    const next = sibs[i+1];
    return next ? (r.order + next.order) / 2 : r.order + 1;
  }
  function endOrder(parentRefId){        // parent の末尾に追加する order
    const sibs = childRefs(parentRefId);
    return sibs.length ? sibs[sibs.length-1].order + 1 : 0;
  }

  // ── カスタムビュー（保存した絞り込み/並べ替え/列の組）。中身の形は呼び出し側が決める ──
  function saveView(viewObj){
    const id = genId('v');
    const view = { id, ...viewObj };
    S.views.push(view); emit(); return view;
  }
  function updateView(id, patch){
    const v = S.views.find(x => x.id === id);
    if (v){ Object.assign(v, patch, { id }); emit(); }
    return v;
  }
  function deleteView(id){
    const i = S.views.findIndex(x => x.id === id);
    if (i >= 0){ S.views.splice(i, 1); emit(); }
  }
  function listViews(){ return S.views.slice(); }

  // ── プロジェクト（kind:'project' の本体。付箋は持たず明示管理。rename は updateBody）──
  function createProject(name){ return createBody({ kind:'project', content: name || '新規プロジェクト' }); }
  function listProjects(){
    return Object.values(S.bodies).filter(b => b.kind === 'project')
      .sort((a,b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }
  function deleteProject(id){
    for (const b of Object.values(S.bodies)) if (b.proj === id) delete b.proj; // タスクの帰属を外す
    delete S.bodies[id]; emit();
  }

  function replaceState(newState){          // GitHub取得などで状態を丸ごと差し替え（S参照は維持）
    for (const k of Object.keys(S)) delete S[k];
    Object.assign(S, newState);
    if (!S.views) S.views = [];
    emit();
  }

  function subscribe(fn){ subs.add(fn); return () => subs.delete(fn); }
  const toJSON = () => S;

  return { createBody, createRef, createCard, getBody, getRef, updateBody, updateRef,
           childRefs, refsForBody, deleteRef, queryBodies, ensureDayCard,
           siblings, prevSiblingRef, orderAfter, endOrder,
           saveView, updateView, deleteView, listViews,
           createProject, listProjects, deleteProject,
           replaceState, subscribe, toJSON, _state:S };
}
