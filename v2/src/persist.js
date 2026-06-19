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
    try {
      const s = store.toJSON();
      s.savedAt = new Date().toISOString();   // 競合判定用タイムスタンプ（GitHub同期と共有）
      localStorage.setItem(LS_KEY, JSON.stringify(s));
    }
    catch(e){ console.error('[persist] save failed', e); }
  };
  if (immediate){ doSave(); return; }
  clearTimeout(timer);
  timer = setTimeout(doSave, 400); // デバウンス（多重 emit を合流）
}
