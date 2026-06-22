// 月カレンダー（日付へ移動）。日付クリック→onPick(YYYY-MM-DD)。カードのある日は印。
let _panel = null, _closer = null;

export function closeCalendar(){
  if (_closer){ document.removeEventListener('mousedown', _closer); _closer = null; }
  if (_panel){ _panel.remove(); _panel = null; }
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

export function openCalendar({ store, onPick }){
  closeCalendar();
  const today = new Date();
  const todayStr = ymd(today);
  let viewY = today.getFullYear(), viewM = today.getMonth();   // 0-11

  const overlay = document.createElement('div'); overlay.className = 'cal-overlay';
  const box = document.createElement('div'); box.className = 'cal-box';
  overlay.appendChild(box); document.body.appendChild(overlay); _panel = overlay;

  const dayHasCard = (s) => {
    const b = store.queryBodies(x => x.kind === 'day' && x.content === s)[0];
    if (!b) return false;
    const ref = store.refsForBody(b.id).find(r => r.parentRefId === null);
    return !!(ref && store.childRefs(ref.id).length);
  };
  const pick = (s) => { closeCalendar(); onPick(s); };

  const render = () => {
    box.innerHTML = '';
    const head = document.createElement('div'); head.className = 'cal-head';
    const prev = document.createElement('button'); prev.className = 'btn'; prev.textContent = '‹';
    prev.onclick = () => { if (--viewM < 0){ viewM = 11; viewY--; } render(); };
    const title = document.createElement('span'); title.className = 'cal-title'; title.textContent = viewY + '年 ' + (viewM + 1) + '月';
    const next = document.createElement('button'); next.className = 'btn'; next.textContent = '›';
    next.onclick = () => { if (++viewM > 11){ viewM = 0; viewY++; } render(); };
    const todayBtn = document.createElement('button'); todayBtn.className = 'btn'; todayBtn.textContent = '今日';
    todayBtn.onclick = () => pick(todayStr);
    head.append(prev, title, next, todayBtn);
    box.appendChild(head);

    const grid = document.createElement('div'); grid.className = 'cal-grid';
    for (const w of ['日','月','火','水','木','金','土']){ const c = document.createElement('div'); c.className = 'cal-dow'; c.textContent = w; grid.appendChild(c); }
    const startDow = new Date(viewY, viewM, 1).getDay();
    const daysIn = new Date(viewY, viewM + 1, 0).getDate();
    for (let i = 0; i < startDow; i++) grid.appendChild(document.createElement('div'));
    for (let d = 1; d <= daysIn; d++){
      const s = viewY + '-' + pad(viewM + 1) + '-' + pad(d);
      const cell = document.createElement('button'); cell.className = 'cal-day'; cell.textContent = d;
      if (s === todayStr) cell.classList.add('today');
      if (dayHasCard(s)) cell.classList.add('has');
      cell.onclick = () => pick(s);
      grid.appendChild(cell);
    }
    box.appendChild(grid);
  };
  render();
  _closer = (e) => { if (!e.target.closest('.cal-box')) closeCalendar(); };
  setTimeout(() => { if (_closer) document.addEventListener('mousedown', _closer); }, 0);
}
