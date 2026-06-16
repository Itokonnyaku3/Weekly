const nowIso = () => new Date().toISOString();

export function createStore(initial){
  const S = initial || { v:1, seq:0, bodies:{}, refs:{}, views:[] };
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

  function subscribe(fn){ subs.add(fn); return () => subs.delete(fn); }
  const toJSON = () => S;

  return { createBody, createRef, createCard, getBody, getRef, updateBody, updateRef,
           childRefs, refsForBody, deleteRef, queryBodies, ensureDayCard,
           subscribe, toJSON, _state:S };
}
