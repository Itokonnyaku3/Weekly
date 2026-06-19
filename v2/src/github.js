// GitHub 同期（v1の実績ある実装を本体＋付箋モデルへ移植）。
// Contents API でデータJSONを PUT/GET、savedAt で新旧比較、SHA再取得で競合解決、日次バックアップ keep3。
// v2 専用パス（既定 v2-data/tracker.json・backups は v2-data/backups/）で v1 の data.json には触れない。
// 設定/SHA/バックアップ日付は localStorage の pwt2_gh_* に保管（v1 の pwt_gh_* と別）。

const K = {
  token:'pwt2_gh_token', repo:'pwt2_gh_repo', file:'pwt2_gh_file',
  enabled:'pwt2_gh_enabled', sha:'pwt2_gh_sha', lastBackup:'pwt2_gh_last_backup',
};
const DEFAULT_FILE = 'v2-data/tracker.json';
let _busy = false;

export function ghGetSettings(){
  return {
    token: localStorage.getItem(K.token) || '',
    repo:  localStorage.getItem(K.repo)  || '',
    file:  localStorage.getItem(K.file)  || DEFAULT_FILE,
    enabled: localStorage.getItem(K.enabled) === '1',
  };
}
export function ghSaveSettings({ token, repo, file, enabled }){
  if (token !== undefined && token !== null) localStorage.setItem(K.token, token);
  localStorage.setItem(K.repo, (repo || '').trim());
  localStorage.setItem(K.file, (file || '').trim() || DEFAULT_FILE);
  localStorage.setItem(K.enabled, enabled ? '1' : '0');
}
export function ghIsConfigured(){ const g = ghGetSettings(); return !!(g.token && g.repo); }

const authHeaders = (token) => ({ Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json' });
const encodeB64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
};
const decodeB64 = (b64) => {
  const binary = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
};

// Contents API: ファイル取得（SHA 記録・1MB超は Blobs API フォールバック）
export async function ghFetchRaw(){
  const { token, repo, file } = ghGetSettings();
  if (!token || !repo) throw new Error('トークンとリポジトリを設定してください');
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(file)}`,
    { headers: authHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok){ const e = await res.json().catch(()=>({message:'HTTP '+res.status})); throw new Error(e.message); }
  const data = await res.json();
  localStorage.setItem(K.sha, data.sha);
  let base64;
  if (data.content && data.encoding === 'base64') base64 = data.content;
  else {
    const br = await fetch(`https://api.github.com/repos/${repo}/git/blobs/${data.sha}`, { headers: authHeaders(token) });
    if (!br.ok){ const e = await br.json().catch(()=>({message:'HTTP '+br.status})); throw new Error(e.message); }
    base64 = (await br.json()).content;
  }
  return JSON.parse(decodeB64(base64));
}

// Contents API: 作成 or 更新
export async function ghPushRaw(stateObj){
  const { token, repo, file } = ghGetSettings();
  if (!token || !repo) throw new Error('トークンとリポジトリを設定してください');
  const sha = localStorage.getItem(K.sha);
  const content = encodeB64(JSON.stringify(stateObj, null, 2));
  const body = { message: 'sync: ' + new Date().toISOString(), content, ...(sha ? { sha } : {}) };
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(file)}`,
    { method:'PUT', headers:{ ...authHeaders(token), 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  if (!res.ok){ const e = await res.json().catch(()=>({message:'HTTP '+res.status})); throw new Error(e.message); }
  localStorage.setItem(K.sha, (await res.json()).content.sha);
}

// 起動時 or 手動「↓取得」: リモートが新しければ（または手動なら）ローカルへ反映
export async function ghSyncLoad(store, { manual=false, onStatus=()=>{}, confirmOverwrite=null } = {}){
  const g = ghGetSettings();
  if (!g.enabled && !manual) return false;
  if (!g.token || !g.repo){ if (manual) onStatus('トークンとリポジトリを設定してください', true); return false; }
  if (_busy) return false;
  _busy = true; onStatus('⏳ 取得中…');
  try {
    const remote = await ghFetchRaw();
    if (!remote){ onStatus('ℹ️ リモートにファイルなし（初回は「↑送信」を）'); return false; }
    const localAt  = new Date(store.toJSON().savedAt || 0);
    const remoteAt = new Date(remote.savedAt || 0);
    if (manual || remoteAt > localAt){
      if (manual && confirmOverwrite && !confirmOverwrite(remote.savedAt, store.toJSON().savedAt)){
        onStatus('取得をキャンセルしました'); return false;
      }
      store.replaceState(remote);
      onStatus('✓ ' + new Date().toLocaleTimeString() + ' 取得（リモート最新）');
      return true;
    }
    onStatus('✓ ' + new Date().toLocaleTimeString() + ' 確認済み（ローカル最新）');
    return false;
  } catch(e){ onStatus('❌ ' + e.message, true); return false; }
  finally { _busy = false; }
}

// 保存時 or 手動「↑送信」: 最新SHAを取り直してから push、SHA競合は1回リトライ
export async function ghSyncSave(store, { manual=false, onStatus=()=>{} } = {}){
  const g = ghGetSettings();
  if (!g.enabled && !manual) return;
  if (!g.token || !g.repo) return;
  if (_busy) return;
  _busy = true; onStatus('⏳ 送信中…');
  const push = async () => { await ghFetchRaw().catch(()=>{}); await ghPushRaw(store.toJSON()); };
  try {
    await push();
    onStatus('✓ ' + new Date().toLocaleTimeString() + ' 同期しました');
  } catch(e){
    const msg = String(e.message);
    if (msg.includes('does not match') || msg.includes('409') || msg.includes('sha')){
      localStorage.removeItem(K.sha);
      try { await push(); onStatus('✓ ' + new Date().toLocaleTimeString() + ' 同期（競合解決）'); }
      catch(e2){ onStatus('❌ ' + e2.message, true); }
    } else onStatus('❌ ' + msg, true);
  } finally { _busy = false; }
}

// ── 日次バックアップ（v2-data/backups/data_YYYY-MM-DD.json・新しい順 keep 件）──
const stamp = () => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };

async function pruneBackups(g, keep){
  try {
    const res = await fetch(`https://api.github.com/repos/${g.repo}/contents/v2-data/backups`, { headers: authHeaders(g.token) });
    if (!res.ok) return;
    const list = await res.json();
    if (!Array.isArray(list)) return;
    const baks = list.filter(f => /^data_\d{4}-\d{2}-\d{2}\.json$/.test(f.name)).sort((a,b)=> a.name < b.name ? 1 : -1);
    for (const f of baks.slice(keep)){
      await fetch(`https://api.github.com/repos/${g.repo}/contents/v2-data/backups/${f.name}`,
        { method:'DELETE', headers:{ ...authHeaders(g.token), 'Content-Type':'application/json' },
          body: JSON.stringify({ message:'prune backup: '+f.name, sha:f.sha }) }).catch(()=>{});
    }
  } catch(e){ console.warn('[backup prune]', e.message); }
}

export async function ghBackupNow(store, { onStatus=()=>{}, keep=3 } = {}){
  const g = ghGetSettings();
  if (!g.token || !g.repo){ onStatus('❌ トークンとリポジトリが必要です', true); return false; }
  const path = 'v2-data/backups/data_' + stamp() + '.json';
  try {
    onStatus('⏳ バックアップ中…');
    const content = encodeB64(JSON.stringify(store.toJSON(), null, 2));
    let sha = null;
    try { const r = await fetch(`https://api.github.com/repos/${g.repo}/contents/${path}`, { headers: authHeaders(g.token) }); if (r.ok) sha = (await r.json()).sha; } catch(e){}
    const body = { message:'backup: '+stamp(), content, ...(sha ? { sha } : {}) };
    const res = await fetch(`https://api.github.com/repos/${g.repo}/contents/${path}`,
      { method:'PUT', headers:{ ...authHeaders(g.token), 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if (!res.ok){ const e = await res.json().catch(()=>({message:'HTTP '+res.status})); throw new Error(e.message); }
    await pruneBackups(g, keep);
    localStorage.setItem(K.lastBackup, stamp());
    onStatus('✓ バックアップ完了 (' + stamp() + ')');
    return true;
  } catch(e){ onStatus('❌ ' + e.message, true); return false; }
}

// 起動時に1日1回だけ（GitHub設定時・ノンブロッキング）
export async function ghDailyBackupOnLoad(store, { onStatus=()=>{} } = {}){
  const g = ghGetSettings();
  if (!g.token || !g.repo) return;
  if (localStorage.getItem(K.lastBackup) === stamp()) return; // 当日済み
  await ghBackupNow(store, { onStatus });
}
