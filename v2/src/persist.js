const LS_KEY = 'pwt2_data';

export function loadState(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e){ console.error('[persist] load failed', e); }
  return null;
}

let timer = null;
export function saveState(store, { immediate=false } = {}){
  const doSave = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store.toJSON())); }
    catch(e){ console.error('[persist] save failed', e); }
  };
  if (immediate){ doSave(); return; }
  clearTimeout(timer);
  timer = setTimeout(doSave, 400); // デバウンス（多重 emit を合流）
}
