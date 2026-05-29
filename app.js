
    /* ── 起動エラーキャッチャー（デバッグ用） ── */
    window.onerror = function(msg, src, line, col, err) {
      const d = document.createElement('div');
      d.style = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fee2e2;color:#7f1d1d;padding:8px 12px;font-size:11px;font-family:monospace;border-bottom:2px solid #b91c1c';
      d.textContent = '🚨 JS Error: ' + msg + ' (line ' + line + ')';
      document.body && document.body.prepend(d);
      console.error('[STARTUP ERROR]', msg, 'at', src, line, err);
    };
    window.addEventListener('unhandledrejection', e => {
      console.error('[UNHANDLED PROMISE]', e.reason);
    });

    /* ================================================================
       週次プロジェクト管理ツール — 仕様・実装メモ
       (別チャットの Claude がこのファイルを読んで判断できるよう記載)
       ================================================================
    
       【概要】
       縦軸=プロジェクト、横軸=週のグリッド型タスク/ログ管理ツール。
       データはブラウザの localStorage に自動保存 (キー: pwt_v5)。
       画像追加時は JSON ファイルを自動ダウンロード (project-tracker-autosave.json)。
    
       【レイアウト】
       - 左: 未完 ToDo サイドパネル (#todo-panel) — toggleTodoPanel() で開閉
       - 中: グリッド (#grid-wrap) — プロジェクト行 × 週列のテーブル
       - 右: 詳細サイドパネル (#panel) — openPanel()/openProjPanel() で開閉
       - 左右パネル幅はドラッグでリサイズ可能。幅は localStorage に保存
         (PK_R='pwt_rp', PK_L='pwt_lp')
       - プロジェクト列・週ヘッダーは CSS sticky で固定スクロール
    
       【データ構造】
       S = {
         projects: [{
           name: string,
           collapsed: bool,
           entries: { "YYYY-M-D": [Entry, ...] },   // 週ごとのエントリ
           projEntries: [Entry, ...],                // プロジェクト全体メモ
           projEntriesOpen: bool,
           links: [{ label, url }]                   // プロジェクトリンク (リンクタイプ Entry でも代替可)
         }],
         wOff: number   // 週オフセット (0=今週基準)
       }
       Entry = { type:'todo'|'log'|'link', text, note, url, images:[], done? }
    
       【エントリ種類】
       - todo : チェックボックス付き。Space キーでトグル
       - log  : 📝 タグ付きログ/議事録
       - link : 🔗 リンク。workflowy.com を含む URL は target="workflowy-pane"
                 で開き、Edge の画面分割右ペインに表示させる想定
    
       【キーボードナビゲーション】 — navigate(ev, pi, wk, ei) に集約
       - Tab / Shift+Tab : focusable な eitem 間を移動 (tabindex="0")
       - ↑ / ↓          : 同セル内のエントリを上下移動
       - Enter           : ノートを開いてノードにフォーカス（Shift+Enter: 詳細パネル）
       - Space           : ToDo チェック切替
       - Alt+Shift+← / → : 前週/次週 (表示端ならビューを週送り)
       - Alt+Shift+↑ / ↓ : 前/次プロジェクトの同じ週
       - Esc             : パネルを閉じる (未保存なら確認)
       - パネル内 Enter  : テキスト欄で保存
       - パネル内 Ctrl+Enter : 備考欄で保存
    
       【フォーカス管理】 — applyFocus(pi, wk, ei)
       - _programmaticFocus フラグ (50ms) でプログラム的な focus() が
         focusin イベントによる focusKey 上書きを防ぐ
       - エントリあり → eitem にフォーカス + .kfocus クラス付与
       - エントリなし → そのセルの .qainp (クイック追加入力) にフォーカス
       - qainpKeyDown() : 入力ボックスからも Alt+Shift ナビが継続できる
       - パネルを閉じた後 / ＋ボタン押下後 → refocusGrid() でグリッドに戻る
       - パネルを開くと常に pf-text (テキスト欄) にフォーカスが移る
    
       【詳細サイドパネル (右)】 — openPanel(pi, wk, ei) / openProjPanel(pi, ei)
       - 新規 (ei===null) と既存編集を兼用
       - 種類・テキスト・URL・備考・画像を編集
       - panelDirty フラグ: 変更があると上部に黄色バーを表示
       - 未保存で別アイテムに移動/Esc すると confirm() で確認
       - 「次の週に延期」: 元週を未完のまま残し、翌週にもコピー
       - 画像: ファイル選択 / 備考欄ドロップ / パネル内 Ctrl+V でペースト
         → Base64 で entry.images[] に保存
         → 追加のたびに JSON を自動ダウンロード (triggerAutoSave)
         → 画像はパネル幅に合わせて 2 列グリッド表示
    
       【プロジェクト列の折りたたみエントリ】
       - projEntries[] にログ/ToDo/リンクを保存
       - ▶/▼ クリックで展開/折りたたみ (projEntriesOpen)
       - ＋ボタンで openProjPanel() を呼び出し
    
       【未完 ToDo 左パネル】 — renderTodo()
       - 全プロジェクト × 全週を横断して type==='todo' && !done を収集
       - 週キーでソートし、過去週は赤でハイライト
       - クリックで jumpTo() → 対象週にビューを移動してパネルを開く
       - パネル内でチェックするとその場で done=true に反映
    
       【ドラッグ&ドロップ】
       - プロジェクト行: pDragStart/pDragOver/pDrop で並び替え
       - エントリ: eDragStart/eDragOver/eDrop で同セル内・セル間移動
    
       【Workflowy 連携】
       - url に "workflowy.com" を含む場合 target="workflowy-pane" で開く
       - Edge の画面分割で右ペインに固定すると毎回同じペインで開く
       - セッションはブラウザタブとして維持される
    
       【データ保存】
       - localStorage: 全データ (画像含む) を pwt_v5 キーに JSON 保存
       - 画像追加時: project-tracker-autosave.json を自動ダウンロード
       - 手動エクスポート: manualExport() → 日付付きファイル名で保存
       - インポート: importData() → JSON ファイルを読み込んで状態を復元
       - 注意: localStorage は 5MB 制限があるため、大量画像は JSON ファイル
         運用を推奨
    

       【Gemini専用：開発ガイドライン】
       - Single Source of Truthの遵守: UIの変更は必ず S オブジェクト（ステート）を更新してから render() を呼ぶフローを徹底すること。DOMを直接書き換えてデータと乖離させないこと。
       - 既存機能の全量スキャン: コードを修正する前に、修正対象の変数が Maps 関数や render 関数内でどう使われているか必ず全スキャンし、依存関係を壊さないこと。
       - 共通定数の保護: SK (localStorageキー) や fkey の形式（pi:wk:ei）を勝手に変更しないこと。
       - 差分ではなく関数単位の提示: 修正案は「〜行目を書き換える」ではなく、修正後の「関数全体」を提示すること。
       - 更新履歴の自動更新: 修正完了後、コード内の「仕様・実装メモ」コメントを必ず最新状態に更新すること。

       【デイリーノート機能・フォーカス管理 (最新仕様)】
       - 右端: ノートパネル (#note-panel) ⇒ olRender() でアウトライン形式のノートを管理
       - スタイル反映: ノート内の装飾（太字・色）はステート変更時に即時再描画 (olRender の最適化廃止により実現)
       - フォーカス保護: render() 実行時のフォーカス解決において、ノート各メニュー操作中や _programmaticFocus フラグ有効時はグリッド側へのフォーカス奪還を阻止
       - ナビゲーション: 完了要素（display:none）をスキップするようにキー移動ロジックを強化。デイリータスク(daily:DATE:ID)のフォーカス復元にも対応済。

              ================================================================ */

    /* ── constants / state ── */
    const SK = 'pwt_v5', PK_R = 'pwt_rp', PK_L = 'pwt_lp', WEEKS = 6;
    const APP_VERSION = 'v1.4.4-05282250-aggr-descendants';
    let S = { projects: [], wOff: 0 };
    let pCtx = null;
    let dragProjIdx = null, dragECtx = null;
    let todoOpen = false;
    let focusKey = null;
    let panelDirty = false;
    let autoTimer = null;
    let _tagFilter = null; // タグフィルタ中のタグ名（null=フィルタなし）

    /* ================================================================
       TAG META — グローバルタグ管理 (S.tagMeta)
       { tagName: { color: "#hex" | null, lastUsed: timestamp } }
    ================================================================ */
    function tagMetaInit() {
      if (!S.tagMeta) S.tagMeta = {};
    }
    function getAllTags() {
      tagMetaInit();
      return Object.entries(S.tagMeta)
        .sort((a, b) => (b[1].lastUsed || 0) - (a[1].lastUsed || 0))
        .map(([name]) => name);
    }
    function tagRecordUse(tag) {
      tagMetaInit();
      if (!S.tagMeta[tag]) S.tagMeta[tag] = { color: null, lastUsed: 0 };
      S.tagMeta[tag].lastUsed = Date.now();
    }
    function getTagColor(tag) {
      return S.tagMeta?.[tag]?.color || null;
    }
    // 全ノードを走査してどこにも使われていないタグをtagMetaから削除
    function cleanupUnusedTags() {
      if (!S.tagMeta) return;
      const usedTags = new Set();
      if (S.dailyOutline) {
        for (const date in S.dailyOutline) {
          for (const node of S.dailyOutline[date]) {
            if (node.tags && node.tags.length) {
              node.tags.forEach(t => usedTags.add(t));
            }
          }
        }
      }
      for (const tag in S.tagMeta) {
        if (!usedTags.has(tag)) {
          delete S.tagMeta[tag];
        }
      }
    }
    function hexToRgba(hex, alpha) {
      if (!hex || !hex.startsWith('#')) return null;
      const r = parseInt(hex.slice(1,3), 16);
      const g = parseInt(hex.slice(3,5), 16);
      const b = parseInt(hex.slice(5,7), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    function tagChipStyle(tag) {
      const color = getTagColor(tag);
      if (!color) return '';
      return `background:${hexToRgba(color, 0.18)};color:${color}`;
    }

    /* ── #タグドロップダウン状態 ── */
    let _olTagDropDate = null, _olTagDropId = null, _olTagDropQuery = '';
    let _olTagDropIdx = 0;
    let _olComposing = false;
    let _olSlashShortcutFired = false; // スラッシュメニューショートカット発火フラグ（IMEによる文字挿入を抑制）
    let _tcpTag = null; // 色設定中のタグ名

    function olShowTagDrop(date, id, el, query) {
      _olTagDropDate = date; _olTagDropId = id; _olTagDropQuery = query; _olTagDropIdx = -1;
      const allTags = getAllTags();
      const q = query.toLowerCase();
      const filtered = allTags.filter(t => t.toLowerCase().startsWith(q));
      // startsWith で絞れなければ includes でもマッチ
      const filtered2 = filtered.length ? filtered : allTags.filter(t => t.toLowerCase().includes(q));
      const dd = $('ol-tag-dropdown');
      if (!dd) return;
      let html = '';
      // 既存タグ候補（初期ハイライトなし — ↑↓キーで選択）
      filtered2.forEach((t) => {
        const color = getTagColor(t);
        const dot = `<span class="ol-tag-dd-color" style="background:${color || 'var(--bd2)'}"></span>`;
        html += `<div class="ol-tag-dd-item" data-tag="${escA(t)}" onmousedown="event.preventDefault()" onclick="olTagDDSelect('${escA(t)}')">${dot}<span>${esc(t)}</span></div>`;
      });
      // 新規タグオプション（query が空でなく、完全一致する既存タグがない場合）
      if (query && !allTags.includes(query)) {
        html += `<div class="ol-tag-dd-item ol-tag-dd-new" onmousedown="event.preventDefault()" onclick="olTagDDSelect('${escA(query)}')">＋ 新規: <strong>${esc(query)}</strong></div>`;
      }
      if (!html) { olHideTagDrop(); return; }
      dd.innerHTML = html;
      dd.style.display = 'block';
      // カーソル位置に近いところに表示
      const rect = el.getBoundingClientRect();
      dd.style.left = rect.left + 'px';
      dd.style.top = (rect.bottom + 4) + 'px';
      requestAnimationFrame(() => {
        const r2 = dd.getBoundingClientRect();
        if (r2.bottom > window.innerHeight - 8) dd.style.top = (rect.top - r2.height - 4) + 'px';
        if (r2.right > window.innerWidth - 8)  dd.style.left = (window.innerWidth - r2.width - 8) + 'px';
      });
    }
    function olHideTagDrop() {
      const dd = $('ol-tag-dropdown');
      if (dd) dd.style.display = 'none';
      _olTagDropDate = null; _olTagDropId = null; _olTagDropQuery = ''; _olTagDropIdx = 0;
    }
    function olTagDDNavActive(delta) {
      const dd = $('ol-tag-dropdown');
      if (!dd || dd.style.display === 'none') return false;
      const items = dd.querySelectorAll('.ol-tag-dd-item');
      if (!items.length) return false;
      let cur = Array.from(items).findIndex(el => el.classList.contains('dd-active'));
      if (cur >= 0) items[cur].classList.remove('dd-active');
      // -1（選択なし）からのナビ: ↓→先頭、↑→末尾
      if (cur === -1) {
        cur = delta > 0 ? 0 : items.length - 1;
      } else {
        cur = (cur + delta + items.length) % items.length;
      }
      items[cur].classList.add('dd-active');
      items[cur].scrollIntoView({ block: 'nearest' });
      return true;
    }
    function olTagDDConfirm() {
      const dd = $('ol-tag-dropdown');
      if (!dd || dd.style.display === 'none') return false;
      const active = dd.querySelector('.ol-tag-dd-item.dd-active');
      if (active) { active.click(); return true; }
      return false;
    }
    function olTagDDSelect(tag) {
      const date = _olTagDropDate, nodeId = _olTagDropId;
      if (!date || !nodeId) return;
      olHideTagDrop();
      const nodes = olGetNodes(date);
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;
      if (!node.tags) node.tags = [];
      if (!node.tags.includes(tag)) {
        node.tags.push(tag);
        tagRecordUse(tag);
      }
      // contenteditable から @query テキストを削除
      const el = document.getElementById('olt-' + nodeId);
      if (el) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          if (range.startContainer.nodeType === Node.TEXT_NODE) {
            const tc = range.startContainer.textContent;
            const off = range.startOffset;
            const before = tc.slice(0, off);
            const m = before.match(/[#＃][\w\u3040-\u9FFF\u30A0-\u30FF]*$/);
            if (m) {
              const newRange = document.createRange();
              newRange.setStart(range.startContainer, off - m[0].length);
              newRange.setEnd(range.startContainer, off);
              sel.removeAllRanges(); sel.addRange(newRange);
              document.execCommand('delete', false, null);
            }
          }
        }
        node.text = el.textContent;
        node.html = el.innerHTML;
      }
      saveState(); triggerAutoSave();
      olRender('ol-container', date);
      render();
    }

    /* ── タグ色設定 ── */
    function showTagColorPicker(tag, ev) {
      ev.stopPropagation();
      _tcpTag = tag;
      const pop = $('tag-color-picker-pop');
      const inp = $('tcp-color-inp');
      if (!pop || !inp) return;
      const cur = getTagColor(tag);
      inp.value = cur || '#4a9eff';
      pop.style.display = 'block';
      const x = Math.min(ev.clientX, window.innerWidth - 210);
      const y = Math.min(ev.clientY + 8, window.innerHeight - 80);
      pop.style.left = x + 'px';
      pop.style.top  = y + 'px';
    }
    function applyTagColor(color) {
      if (!_tcpTag) return;
      tagMetaInit();
      if (!S.tagMeta[_tcpTag]) S.tagMeta[_tcpTag] = { color: null, lastUsed: 0 };
      S.tagMeta[_tcpTag].color = (color === null) ? null : ($('tcp-color-inp')?.value || null);
      _tcpTag = null;
      $('tag-color-picker-pop').style.display = 'none';
      saveState(); render();
      if (_olCurrentDate) olRender('ol-container', _olCurrentDate);
    }
    // ノートのタグチップ削除
    function olRemoveTag(date, nodeId, tag) {
      const nodes = olGetNodes(date);
      const node = nodes.find(n => n.id === nodeId);
      if (!node || !node.tags) return;
      node.tags = node.tags.filter(t => t !== tag);
      cleanupUnusedTags(); // 他で使われていなければtagMetaから除去
      saveState(); triggerAutoSave();
      olRender('ol-container', date); render();
    }

    // 色ピッカー外クリックで閉じる
    document.addEventListener('click', (ev) => {
      const pop = $('tag-color-picker-pop');
      if (pop && pop.style.display !== 'none' && !pop.contains(ev.target)) {
        pop.style.display = 'none'; _tcpTag = null;
      }
    });

    function setTagFilter(tag) {
      if (_tagFilter === tag) {
        _tagFilter = null; // 同じタグクリックで解除
      } else {
        _tagFilter = tag;
      }
      render();
      if (todoOpen) renderTodo();
      // フィルタ状態のインジケータ更新
      updateTagFilterIndicator();
    }
    function updateTagFilterIndicator() {
      let ind = $('tag-filter-ind');
      if (!ind) {
        // ツールバーにインジケータを動的に追加
        const toolbar = document.querySelector('.toolbar');
        if (toolbar) {
          ind = document.createElement('span');
          ind.id = 'tag-filter-ind';
          ind.style.cssText = 'display:none;font-size:11px;background:var(--accent-light);color:var(--accent);padding:2px 8px;border-radius:12px;cursor:pointer;margin-left:4px;align-items:center;gap:4px';
          ind.title = 'クリックでフィルタ解除';
          ind.onclick = () => { _tagFilter = null; render(); if (todoOpen) renderTodo(); updateTagFilterIndicator(); };
          toolbar.appendChild(ind);
        }
      }
      if (ind) {
        if (_tagFilter) {
          ind.textContent = '🏷 #' + _tagFilter + ' ✕';
          ind.style.display = 'inline-flex';
        } else {
          ind.style.display = 'none';
        }
      }
      // tag-filter-active クラスをグリッドに適用
      const grid = $('grid');
      if (grid) {
        if (_tagFilter) grid.classList.add('tag-filter-active');
        else grid.classList.remove('tag-filter-active');
      }
    }
    let _compactMode = false;       // 圧縮モード
    let _compactExpanded = new Set(); // 圧縮モード中に展開中のプロジェクトindex
    let _hideDone = false;           // 完了済みToDoを非表示
    let _viewMode = 'work';          // 表示モード: 'work' (お仕事) or 'all' (すべて)

    const $ = id => document.getElementById(id);
    function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
    function escA(s) { return String(s || '').replace(/"/g, '&quot;') }
    function getMonday(d) { const dt = new Date(d); const dy = dt.getDay(); dt.setDate(dt.getDate() - dy + (dy === 0 ? -6 : 1)); dt.setHours(0, 0, 0, 0); return dt }
    function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
    function fmt(d) { return (d.getMonth() + 1) + '/' + (d.getDate()) }
    function wkey(d) { const m = getMonday(d); return m.getFullYear() + '-' + (m.getMonth() + 1) + '-' + m.getDate() }
    function wkeyNext(k) { const [y, mo, d] = k.split('-').map(Number); return wkey(addDays(new Date(y, mo - 1, d), 7)) }
    function wkeyToDate(k) { const [y, mo, d] = k.split('-').map(Number); return new Date(y, mo - 1, d) }
    function wkeyLabel(k) { const d = wkeyToDate(k); return fmt(d) + '〜' + fmt(addDays(d, 6)) }
    function getWeeks() { const base = getMonday(addDays(new Date(), S.wOff * 7)); return Array.from({ length: WEEKS }, (_, i) => addDays(base, i * 7)) }
    function genEId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }
    function ensureEntryIds() {
      S.projects.forEach(p => {
        if (p.isPrivate === undefined) p.isPrivate = false;
        (p.projEntries || []).forEach(e => { if (!e.id) e.id = genEId(); });
      });
    }
    function fkey(pi, wk, ei) { return pi + ':' + wk + ':' + ei }

    /* ================================================================
       グリッド列幅 & 期限バッジ — 復元関数
    ================================================================ */

    function getDueBadge(e) {
      if (!e) return '';
      const todayVal = todayDateStr();
      const pad = s => s.split('-').map(x => x.padStart(2, '0')).join('-');
      const today = pad(todayVal);
      const due = e.due ? pad(e.due) : '';
      let cls = 'e-due-badge';
      let disp = '__/__';
      if (due && !e.checked) {
        if (due < today) cls += ' e-due-over';
        else if (due === today) cls += ' e-due-today';
        const m = due.match(/-(\d+)-(\d+)$/);
        disp = m ? `${m[1]}/${m[2]}` : due;
      } else if (due && e.checked) {
        const m = due.match(/-(\d+)-(\d+)$/);
        disp = m ? `${m[1]}/${m[2]}` : due;
        cls += ' e-due-none';
      } else {
        cls += ' e-due-none';
      }
      return `<span class="${cls}">${disp}</span>`;
    }

    function doRollover() {
      showToast('繰り越しは各アイテムの「延期」ボタンをお使いください');
    }

    let _projColWidth = parseInt(localStorage.getItem('pwt_proj_col_w')) || 240;
    let _phaseColWidth = parseInt(localStorage.getItem('pwt_phase_col_w')) || 140;
    let _linkColWidth  = parseInt(localStorage.getItem('pwt_link_col_w'))  || 160;
    let _weekColWidth = parseInt(localStorage.getItem('pwt_week_col_w')) || 336;
    let _weekColWidthMap = {};
    try {
      const savedMap = localStorage.getItem('pwt_week_col_w_map');
      if (savedMap) _weekColWidthMap = JSON.parse(savedMap);
    } catch (e) { }

    function applyWeekColWidths() {
      let total = _projColWidth + _phaseColWidth + _linkColWidth;
      const colP = $('gc-proj');
      if (colP) colP.style.width = _projColWidth + 'px';
      const colPh = $('gc-phase'); if (colPh) colPh.style.width = _phaseColWidth + 'px';
      const colLk = $('gc-link');  if (colLk) colLk.style.width = _linkColWidth + 'px';
      document.querySelectorAll('col[id^="gc-wk-"]').forEach(col => {
        const k = col.id.replace('gc-wk-', '');
        const w = (_weekColWidthMap[k] || _weekColWidth);
        col.style.width = w + 'px';
        total += w;
      });
      const grid = $('grid');
      if (grid) grid.style.width = total + 'px';
    }

    function initColumnWidths() {
      document.documentElement.style.setProperty('--proj-col-w',  _projColWidth  + 'px');
      document.documentElement.style.setProperty('--phase-col-w', _phaseColWidth + 'px');
      document.documentElement.style.setProperty('--link-col-w',  _linkColWidth  + 'px');
      applyWeekColWidths();
    }

    function startColResize(e, type, colKey) {
      e.preventDefault();
      const startX = e.clientX;
      // 開始幅を type 別に決定
      let startW;
      if      (type === 'proj')  startW = _projColWidth;
      else if (type === 'phase') startW = _phaseColWidth;
      else if (type === 'link')  startW = _linkColWidth;
      else                       startW = (_weekColWidthMap[colKey] || _weekColWidth);
      // 最小幅
      const minW = (type === 'proj') ? 80 : (type === 'phase' || type === 'link') ? 60 : 100;

      const onMouseMove = ev => {
        const delta = ev.clientX - startX;
        const newW = Math.max(minW, startW + delta);
        if (type === 'proj') {
          _projColWidth = newW;
          document.documentElement.style.setProperty('--proj-col-w', _projColWidth + 'px');
          const cp = $('gc-proj'); if (cp) cp.style.width = _projColWidth + 'px';
        } else if (type === 'phase') {
          _phaseColWidth = newW;
          document.documentElement.style.setProperty('--phase-col-w', _phaseColWidth + 'px');
          const cp = $('gc-phase'); if (cp) cp.style.width = _phaseColWidth + 'px';
        } else if (type === 'link') {
          _linkColWidth = newW;
          document.documentElement.style.setProperty('--link-col-w', _linkColWidth + 'px');
          const cp = $('gc-link'); if (cp) cp.style.width = _linkColWidth + 'px';
        } else {
          _weekColWidthMap[colKey] = newW;
          const cwk = $('gc-wk-' + colKey); if (cwk) cwk.style.width = newW + 'px';
        }
        applyWeekColWidths();
      };
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        localStorage.setItem('pwt_proj_col_w', _projColWidth);
        localStorage.setItem('pwt_phase_col_w', _phaseColWidth);
        localStorage.setItem('pwt_link_col_w',  _linkColWidth);
        localStorage.setItem('pwt_week_col_w_map', JSON.stringify(_weekColWidthMap));
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }




    /* ================================================================
       FILE SYSTEM ACCESS API — ローカルファイルへの直接保存
       Chrome/Edge 86+ 対応。非対応時は localStorage のみ使用。
    ================================================================ */

    const _fsaEnabled = ('showOpenFilePicker' in window);
    let _fsaHandle = null;   // FileSystemFileHandle | null
    let _fsaActive = false;  // 許可済みでファイルへの読み書きが可能

    /* ── IndexedDB helper（FileSystemFileHandle の永続化） ── */
    function _idbOpen() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('pwt_fsa_v1', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('h');
        req.onsuccess  = e => resolve(e.target.result);
        req.onerror    = () => reject(req.error);
      });
    }
    async function _idbGet(key) {
      try {
        const db = await _idbOpen();
        return new Promise(resolve => {
          const req = db.transaction('h', 'readonly').objectStore('h').get(key);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror   = () => resolve(null);
        });
      } catch(e) { return null; }
    }
    async function _idbSet(key, val) {
      try {
        const db = await _idbOpen();
        return new Promise(resolve => {
          const tx = db.transaction('h', 'readwrite');
          tx.objectStore('h').put(val, key);
          tx.oncomplete = resolve;
          tx.onerror    = resolve;
        });
      } catch(e) {}
    }

    /* ── FSA ステータス UI 更新 ── */
    function updateFsaStatusUI() {
      const el     = $('fsa-status');
      const permBtn= $('fsa-perm-btn');
      if (!el) return;
      if (!_fsaEnabled) {
        el.textContent = '⚠ 非対応（Chrome/Edge をご利用ください）';
        el.style.color = 'var(--tx3)';
      } else if (_fsaActive) {
        el.textContent = '✅ ファイル同期中';
        el.style.color = 'var(--tx-ok)';
        if (permBtn) permBtn.style.display = 'none';
      } else if (_fsaHandle) {
        el.textContent = '⏳ 許可が必要です';
        el.style.color = 'var(--tx-warn)';
        if (permBtn) permBtn.style.display = '';
      } else {
        el.textContent = '📁 未設定（ファイルを選んで保存先を設定）';
        el.style.color = 'var(--tx3)';
      }
    }

    /* ── FSA 初期化（IndexedDB からハンドル復元） ── */
    async function fsaInit() {
      if (!_fsaEnabled) { updateFsaStatusUI(); return; }
      try {
        const handle = await _idbGet('datafile');
        if (!handle) { updateFsaStatusUI(); return; }
        _fsaHandle = handle;
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          _fsaActive = true;
          await fsaLoadFromFile(); // ファイルが新しければ上書き
        }
      } catch(e) {
        console.warn('fsaInit:', e);
      }
      updateFsaStatusUI();
    }

    /* ── FSA: ユーザージェスチャーで許可を要求 ── */
    async function fsaRequestPermission() {
      if (!_fsaHandle) return;
      try {
        const perm = await _fsaHandle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          _fsaActive = true;
          await fsaLoadFromFile();
          showToast('✅ ファイルへのアクセスが許可されました');
        }
      } catch(e) { console.warn('fsaRequestPermission:', e); }
      updateFsaStatusUI();
    }

    /* ── FSA: ファイル選択ダイアログ ── */
    async function fsaSelectFile() {
      if (!_fsaEnabled) {
        alert('このブラウザは File System Access API に対応していません。Chrome または Edge をご利用ください。');
        return;
      }
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'JSON Data', accept: { 'application/json': ['.json'] } }],
          multiple: false
        });
        _fsaHandle = handle;
        await _idbSet('datafile', handle);
        const perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          _fsaActive = true;
          await fsaLoadFromFile();
          showToast('📂 ファイルを開きました。以降は自動保存されます。');
        }
      } catch(e) {
        if (e.name !== 'AbortError') console.error('fsaSelectFile:', e);
      }
      updateFsaStatusUI();
    }

    /* ── FSA: ファイルからデータ読み込み（タイムスタンプ比較） ── */
    async function fsaLoadFromFile() {
      if (!_fsaHandle || !_fsaActive) return false;
      try {
        const file   = await _fsaHandle.getFile();
        const text   = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || !Array.isArray(parsed.projects)) return false;

        const fileTime = new Date(parsed.savedAt  || 0).getTime();
        const lsTime   = new Date(S.savedAt       || 0).getTime();

        if (fileTime > lsTime) {
          S = parsed;
          if (!S.tagMeta) S.tagMeta = {};
          localStorage.setItem(SK, JSON.stringify(S));
          render();
          if (typeof renderTodo === 'function' && todoOpen) renderTodo();
          showToast('📂 ファイルから最新データを読み込みました');
        }
        return true;
      } catch(e) {
        console.warn('fsaLoadFromFile:', e);
        return false;
      }
    }

    /* ── FSA: ファイルへ書き込み ── */
    async function fsaWriteToFile() {
      if (!_fsaHandle || !_fsaActive) return false;
      try {
        const writable = await _fsaHandle.createWritable();
        await writable.write(JSON.stringify(S, null, 2));
        await writable.close();
        return true;
      } catch(e) {
        console.warn('fsaWriteToFile:', e);
        // 権限が失われた可能性
        _fsaActive = false;
        updateFsaStatusUI();
        return false;
      }
    }

    let _loadStateError = '';
    function loadState() {
      try {
        const s = localStorage.getItem(SK);
        if (s) {
          const parsed = JSON.parse(s);
          if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.projects)) {
            throw new Error('データ構造が不正です (projects配列が見つかりません)');
          }
          S = parsed;
          if (!S.tagMeta) S.tagMeta = {};
        }
      } catch (e) {
        console.error('loadState error:', e);
        _loadStateError = '⚠️ 保存データの読み込みに失敗しました。\n\nエラー: ' + e.message + '\n\n初期状態で起動します。データが失われていない場合はブラウザの開発者ツールで localStorage を確認してください。';
      }
    }
    let _ghSyncTimer = null;
    let _ghDirty = false;

    function saveState(immediateSync = false) {
      S.savedAt = new Date().toISOString();

      // ── localStorage（キャッシュ） ──
      try {
        localStorage.setItem(SK, JSON.stringify(S));
      } catch (e) {
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
          showToast('❌ ストレージ容量不足。画像を削除してから再試行してください。');
        } else {
          showToast('❌ 保存失敗: ' + e.message);
        }
        return;
      }

      // ── FSA: ローカルファイルに書き込み（fire-and-forget） ──
      if (_fsaActive) {
        fsaWriteToFile(); // async, エラーは内部でハンドリング
      }

      updateSaveTimeDisplay();
      _ghDirty = true;
      const { enabled } = ghGetSettings();
      if (!enabled) return;
      clearTimeout(_ghSyncTimer);
      if (immediateSync) {
        ghSyncSave(false).catch(() => { });
      } else {
        _ghSyncTimer = setTimeout(() => {
          if (_ghDirty) ghSyncSave(false).catch(() => { });
        }, 15000);
      }
    }

    /* ── auto save ── */
    function triggerAutoSave() {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => { saveState(); }, 600);
    }
    function showToast(msg) {
      const t = $('save-toast');
      t.textContent = msg || '💾 自動保存しました';
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2500);
    }
    function manualExport() {
      saveState();
      const b = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'project-tracker-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
    }
    function importData(ev) {
      const f = ev.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = e2 => {
        try {
          S = JSON.parse(e2.target.result);
          S.projects.forEach(p => {
            if (p.projEntriesOpen === undefined) p.projEntriesOpen = false;
          });
          // Run migration if imported data uses old format
          saveState(); render(); if (todoOpen) renderTodo();
          showToast('📂 JSONを読み込みました');
        } catch (err) { alert('読み込み失敗: 正しいJSONファイルか確認してください') }
      };
      r.readAsText(f); ev.target.value = '';
    }

    /* ── RENDER ── */

    /* ================================================================
       Step 2: プロジェクトの Phase / リンク 集約ノード取得ヘルパー
       proj:{pi} ノートから type='phase' / type='link' ノードを抽出する。
       indent や子ノードはそのまま保ったままで返す。
       ================================================================ */
    function getProjPhaseNodes(pi) {
      const key = 'proj:' + pi;
      const nodes = (S.dailyOutline && S.dailyOutline[key]) || [];
      // v1.3.1: Phase 列は「Phase 見出しの直下（indent=1）」のみ表示。
      // indent>=2 のサブフェーズはグリッドに出さない（ノート内では表示）。
      return nodes.filter(n => n && n.type === 'phase' && n.indent === 1);
    }
    function getProjLinkNodes(pi) {
      const key = 'proj:' + pi;
      const nodes = (S.dailyOutline && S.dailyOutline[key]) || [];
      return nodes.filter(n => n && n.type === 'link');
    }

    /* ================================================================
       週マタギ スパンバー機能 (Phase 3)
       startDate / endDate を持つノードをグリッド上に
       position:absolute のバーとして描画する。
       ================================================================ */

    /**
     * スパンノードを全プロジェクト・全週から収集する
     * @returns {{ node, date, pi, projTag }[]}
     */
    function getSpanNodes() {
      const result = [];
      S.projects.forEach((proj, pi) => {
        const projTag = proj.name.replace(/\s+/g, '_');
        getAllNodes().forEach(({ node, date }) => {
          if (node.projTag !== projTag) return;
          if (!node.startDate || !node.endDate) return;
          result.push({ node, date, pi, projTag });
        });
      });
      return result;
    }

    /**
     * 案A: プロジェクト pi 内のスパンを「テキスト単位」でレーンに束ねる。
     * 同名スパンは同じレーンに配置される → 週ごとに登場順が変わってもズレない。
     * 戻り値: { laneMap: Map<key, laneIdx>, maxLane }
     *   key = node.text を trim したもの（空なら id ベースのフォールバック）
     */
    function spanKeyOf(node) {
      const t = (node && node.text || '').trim();
      return t || ('__id_' + (node && node.id));
    }
    function computeSpanLanesForProject(pi) {
      const proj = S.projects[pi];
      if (!proj) return { laneMap: new Map(), maxLane: -1 };
      const projTag = proj.name.replace(/\s+/g, '_');

      // このプロジェクトの全スパンを集める
      const spans = [];
      getAllNodes().forEach(({ node }) => {
        if (node.projTag !== projTag) return;
        if (!node.startDate || !node.endDate) return;
        spans.push(node);
      });
      // startDate 昇順 → text 昇順 で安定ソート（レーン番号の決定論性確保）
      spans.sort((a, b) => {
        if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
        return (a.text || '').localeCompare(b.text || '');
      });
      const laneMap = new Map();
      let nextLane = 0;
      spans.forEach(n => {
        const k = spanKeyOf(n);
        if (!laneMap.has(k)) laneMap.set(k, nextLane++);
      });
      return { laneMap, maxLane: nextLane - 1 };
    }

    /**
     * スパンバーを描画する（render() の末尾から呼ぶ）
     * v1.0.2: オーバーレイは廃止。インライン描画(_renderImpl)に一本化。
     * 過去描画されていた .span-overlay-layer が残っていれば除去のみ実施し、即 return。
     */
    function renderSpanBars() {
      // 既存オーバーレイの掃除のみ（再生成しない）
      document.querySelectorAll('.span-overlay-layer').forEach(el => el.remove());
      return;
      // ── 以下、旧オーバーレイ描画コード（無効化）──
      // eslint-disable-next-line no-unreachable
      const spanNodes = getSpanNodes();
      if (!spanNodes.length) return;

      const gridWrap = $('grid-wrap');
      if (!gridWrap) return;
      gridWrap.style.position = 'relative';

      const weeks = getWeeks();
      const firstWk = wkey(weeks[0]);
      const lastWk  = wkey(weeks[weeks.length - 1]);
      const BAR_H   = 20;
      const BAR_GAP = 3;

      const layer = document.createElement('div');
      layer.className = 'span-overlay-layer';
      layer.id = 'span-layer';
      gridWrap.appendChild(layer);

      const wrapRect = gridWrap.getBoundingClientRect();
      const scrollTop  = gridWrap.scrollTop  || 0;
      const scrollLeft = gridWrap.scrollLeft || 0;

      // 案A: pi ごとにレーン割当をキャッシュ（同名スパンは同レーン）
      const piLaneCache = {};

      spanNodes.forEach(({ node, pi }) => {
        const startWk = wkey(new Date(node.startDate.replace(/-/g, '/')));
        const endWk   = wkey(new Date(node.endDate.replace(/-/g, '/')));

        if (endWk < firstWk || startWk > lastWk) return;

        const visStartWk = startWk < firstWk ? firstWk : startWk;
        const visEndWk   = endWk   > lastWk  ? lastWk  : endWk;

        // tbody の detail セルを参照（proj-hdr-row ではなく detail row）
        // selector: td.col-week[data-pi][data-wk] で detail row のセルを取得
        const startCell = document.querySelector(
          `td.col-week[data-pi="${pi}"][data-wk="${visStartWk}"]`
        );
        const endCell = document.querySelector(
          `td.col-week[data-pi="${pi}"][data-wk="${visEndWk}"]`
        );
        if (!startCell || !endCell) return;

        const sr = startCell.getBoundingClientRect();
        const er = endCell.getBoundingClientRect();

        const left  = sr.left  - wrapRect.left  + scrollLeft + 2;
        const width = er.right - sr.left  - 4;

        // 行の top（detail row のセルを基準）
        const rowTop = sr.top - wrapRect.top + scrollTop;

        // 案A: テキスト単位でレーン割当
        if (!piLaneCache[pi]) piLaneCache[pi] = computeSpanLanesForProject(pi);
        const laneIdx = piLaneCache[pi].laneMap.get(spanKeyOf(node)) ?? 0;
        const barTop  = rowTop + 3 + laneIdx * (BAR_H + BAR_GAP);

        // バー色（laneIdx ベースで安定）
        const colors = ['#3b82f6','#8b5cf6','#059669','#f59e0b','#ef4444','#06b6d4','#ec4899','#10b981'];
        const color = colors[laneIdx % colors.length];

        const bar = document.createElement('div');
        bar.className = 'span-bar';
        if (startWk < firstWk) bar.classList.add('clip-left');
        if (endWk > lastWk)    bar.classList.add('clip-right');

        bar.style.cssText = `left:${Math.max(0,left)}px;top:${barTop}px;` +
          `width:${Math.max(20,width)}px;height:${BAR_H}px;background:${color}`;
        bar.title = `${node.text}\n${node.startDate} 〜 ${node.endDate}`;
        bar.textContent = node.text || '（無題）';

        bar.addEventListener('click', () => {
          const found = findNodeById(node.id);
          if (found) openNotePanelToDate(found.date, node.id);
        });

        layer.appendChild(bar);
      });
    }

    // ResizeObserver でグリッドサイズ変更時に再描画
    let _spanRo = null;
    function initSpanObserver() {
      const gridWrap = $('grid-wrap');
      if (!gridWrap) return;
      if (_spanRo) _spanRo.disconnect();
      _spanRo = new ResizeObserver(() => {
        requestAnimationFrame(renderSpanBars);
      });
      _spanRo.observe(gridWrap);
    }

    function render() {
      try { _renderImpl(); } catch(e) {
        console.error('render() ERROR:', e);
        // 画面上に赤いエラー表示
        document.body.insertAdjacentHTML('afterbegin',
          `<div style="position:fixed;top:0;left:0;right:0;z-index:99999;background:#fee2e2;color:#b91c1c;padding:8px 12px;font-size:12px;font-family:monospace;border-bottom:2px solid #b91c1c">
            🚨 render()エラー: ${e.message}<br><small>${(e.stack||'').split('\n').slice(0,3).join(' | ')}</small>
          </div>`);
      }
    }
    function _renderImpl() {
      // Step 3: 描画前に全 projTag 持ちノードの phase をタグから自動正規化
      if (typeof normalizeNodePhase === 'function' && S.dailyOutline) {
        for (const dk in S.dailyOutline) {
          const ns = S.dailyOutline[dk]; if (!Array.isArray(ns)) continue;
          for (const n of ns) { if (n && n.projTag) normalizeNodePhase(n); }
        }
      }
      const weeks = getWeeks();
      const cw = wkey(new Date());

      // ツールバーのモードボタン表示更新
      const mb = $('mode-btn');
      if (mb) {
        if (_viewMode === 'work') {
          mb.textContent = '💼 お仕事';
          mb.title = '現在：お仕事モード（クリックでプライベートモードへ）';
          mb.className = 'btn btn-active';
        } else if (_viewMode === 'private') {
          mb.textContent = '🏠 プライベート';
          mb.title = '現在：プライベートモード（クリックで全表示へ）';
          mb.className = 'btn btn-warn';
        } else {
          mb.textContent = '🌐 全表示';
          mb.title = '現在：全表示モード（クリックでお仕事モードへ）';
          mb.className = 'btn';
        }
      }

      const verTxtL = 'Version ' + APP_VERSION;
      if ($('app-ver-disp')) $('app-ver-disp').textContent = verTxtL;
      if ($('header-ver-disp')) $('header-ver-disp').textContent = APP_VERSION;
      if ($('gh-token-s')) $('gh-token-s').value = localStorage.getItem(GH_TOKEN_SK) || '';
      if ($('gh-repo-s')) $('gh-repo-s').value = localStorage.getItem(GH_REPO_SK) || '';
      if ($('gh-file-s')) $('gh-file-s').value = localStorage.getItem(GH_FILE_SK) || 'data.json';
      if ($('gh-enabled-s')) $('gh-enabled-s').checked = localStorage.getItem(GH_ENABLED_SK) === '1';

      $('wlabel').textContent = fmt(weeks[0]) + '〜' + fmt(addDays(weeks[WEEKS - 1], 6));

      // リサイズハンドルの追加
      // Step 2: PJ列の右に Phase列・リンク列を追加（colgroup と thead 両方）
      let ghtml = '<col id="gc-proj" class="col-proj">';
      ghtml += '<col id="gc-phase" class="col-phase">';
      ghtml += '<col id="gc-link" class="col-link">';
      let hr = `<tr><th class="col-proj" style="text-align:left">プロジェクト<div class="col-resizer" onmousedown="startColResize(event, 'proj')"></div></th>`;
      hr += `<th class="col-phase" style="text-align:left">Phase<div class="col-resizer" onmousedown="startColResize(event, 'phase')"></div></th>`;
      hr += `<th class="col-link"  style="text-align:left">リンク<div class="col-resizer" onmousedown="startColResize(event, 'link')"></div></th>`;
      weeks.forEach(w => {
        const k = wkey(w);
        ghtml += `<col id="gc-wk-${k}" class="col-week">`;
        hr += `<th id="thk-${k}" class="col-week${k === cw ? ' cur-week' : ''}">W ${fmt(w)}〜${fmt(addDays(w, 6))}<div class="col-resizer" onmousedown="startColResize(event, 'week', '${k}')"></div></th>`;
      });
      $('gc').innerHTML = ghtml;
      $('gh').innerHTML = hr + '</tr>';
      if (typeof applyWeekColWidths === 'function') applyWeekColWidths();

      let rows = '';
      const firstWk = wkey(weeks[0]);
      const lastWk  = wkey(weeks[weeks.length - 1]);
      const SPAN_COLORS = ['#3b82f6','#8b5cf6','#059669','#f59e0b','#ef4444','#06b6d4','#ec4899','#10b981'];

      S.projects.forEach((proj, pi) => {
        // 表示モードによるフィルタリング
        if (_viewMode === 'work' && proj.isPrivate) return;  // お仕事モード→プライベート非表示
        if (_viewMode === 'private' && !proj.isPrivate) return; // プライベートモード→お仕事非表示

        const isCompactRow = _compactMode && !_compactExpanded.has(pi);

        // ── 常にサマリーヘッダ行を出力（圧縮モードON/OFFを問わず） ──
        rows += `<tr class="proj-hdr-row${proj.isPrivate ? ' is-private' : ''}">`;
        rows += `<td class="col-proj" data-pi="${pi}" data-wk="proj"${_compactMode ? ` tabindex="0" onkeydown="projHdrKeyDown(event,${pi})"` : ''}>`;
        rows += `<div class="pcell pcell-hdr">`;
        if (_compactMode) {
          const arrow = isCompactRow ? '▶' : '▼';
          const ttl   = isCompactRow ? 'クリックで展開' : 'クリックで折りたたむ';
          rows += `<div class="proj-hdr-name" onclick="compactToggleRow(${pi})" title="${ttl}" style="cursor:pointer">`;
          rows += `<span class="proj-hdr-arrow">${arrow}</span>`;
          rows += `<span>${esc(proj.name)}</span>`;
          rows += `</div>`;
        } else {
          rows += `<div class="proj-hdr-name">`;
          rows += `<span>${esc(proj.name)}</span>`;
          rows += `</div>`;
        }
        rows += `</div></td>`;
        // Step 2: proj-hdr-row でも Phase列・リンク列を出す（簡易：件数のみ）
        {
          const phaseN = getProjPhaseNodes(pi).length;
          const linkN  = getProjLinkNodes(pi).length;
          rows += `<td class="col-phase">${phaseN ? `<span class="proj-hdr-cnt">${phaseN}件</span>` : ''}</td>`;
          rows += `<td class="col-link">${linkN ? `<span class="proj-hdr-cnt">${linkN}件</span>` : ''}</td>`;
        }
        weeks.forEach(w => {
          const k = wkey(w);
          const items = getGridItems(pi, k);
          const isCur = k === cw;
          const undone = items.filter(item => getNodeType(item.node) === 'todo' && !item.node.checked).length;
          const total  = items.length;
          const clickAttr = _compactMode ? `onclick="compactToggleRow(${pi})" style="cursor:pointer"` : '';
          rows += `<td class="col-week${isCur ? ' cur-week' : ''}" ${clickAttr}>`;
          rows += `<div class="proj-hdr-badge">`;
          if (total) {
            rows += `<span class="proj-hdr-cnt">${total}件</span>`;
            if (undone) rows += `<span class="proj-hdr-todo">☐${undone}</span>`;
          }
          rows += `</div></td>`;
        });
        rows += `</tr>`;

        // 圧縮モードで折りたたみ中ならヘッダ行のみで終了
        if (isCompactRow) return;

        rows += `<tr class="${proj.isPrivate ? 'is-private' : ''}">`;
        // ── project column ──
        rows += `<td class="col-proj" data-pi="${pi}" data-wk="proj" ondragover="pDragOver(event,${pi})" ondrop="pDrop(event,${pi})">`;
        rows += `<div class="pcell">`;

        rows += `<div class="pname">`;
        rows += `<span class="drag-handle" draggable="true" ondragstart="pDragStart(event,${pi})">⠿</span>`;
        const modeIcon = proj.isPrivate ? '🏠' : '💼';
        rows += `<span class="proj-mode-toggle" onclick="toggleProjPrivate(${pi})" title="${proj.isPrivate ? 'プライベート（クリックでお仕事用に変更）' : 'お仕事用（クリックでプライベートに変更）'}">${modeIcon}</span>`;
        rows += `<span class="nm" onclick="projNameClick(${pi})" ondblclick="projNameDblClick(${pi},this)" style="cursor:pointer" title="クリック: ノートを開く / ダブルクリック: 名前変更">${esc(proj.name)}</span>`;
        rows += `<span class="note-btn" onclick="toggleNotePanel('proj:${pi}')" title="プロジェクトノートを開く">📄</span>`;
        if (_compactMode) {
          // 展開中の場合、閉じるボタンを表示
          rows += `<span style="font-size:10px;cursor:pointer;color:var(--tx-info);padding:0 4px" onclick="compactToggleRow(${pi})" title="折りたたむ">▲</span>`;
        }
        rows += `<span style="font-size:10px;cursor:pointer;color:var(--tx3);padding:0 2px" onclick="deleteProj(${pi})" title="削除">✕</span>`;
        rows += `</div>`;

        // v1.2.2: PJ列直下の旧表示エリアを削除（リンク列に統合済み）。
        // - 旧 proj-entries-toggle / proj-entries-body / ＋追加ボタンは削除
        // - 旧 proj.links (.plinks/.plink) ハードコード版も削除
        // 関連関数 toggleProjEntries() / getProjItems() / CSSルールはデッドコードとして残置（次の掃除で除去予定）。
        rows += `</div></td>`;

        // ── Step 2: Phase列・リンク列（詳細行）──
        // proj:{pi} ノートの type='phase' / 'link' ノードを集約して縦に列挙する。
        // クリックでノートパネルを開いて該当ノードへフォーカス。
        {
          const phaseNodes = getProjPhaseNodes(pi);
          rows += `<td class="col-phase" data-pi="${pi}" data-wk="phase">`;
          if (phaseNodes.length) {
            phaseNodes.forEach(pn => {
              const txt = (pn.text || '').trim();
              const done = !!pn.checked;
              const ind = pn.indent || 0;
              const padL = ind * 8;
              const bullet = done ? '✔' : (pn.isTodo ? '□' : '・');
              rows += `<span class="phase-cell-item${done ? ' is-done' : ''}" `
                    + `style="padding-left:${padL}px" `
                    + `onclick="openNotePanelToDate('proj:${pi}','${pn.id}')" `
                    + `title="${escA(txt)}">`
                    + `<span class="phase-bullet">${bullet}</span>${esc(txt)}</span>`;
            });
          } else {
            rows += `<span class="phase-cell-empty" onclick="toggleNotePanel('proj:${pi}')" title="プロジェクトノートでPhaseを追加">＋Phaseを追加</span>`;
          }
          rows += `</td>`;

          const linkNodes = getProjLinkNodes(pi);
          rows += `<td class="col-link" data-pi="${pi}" data-wk="link">`;
          if (linkNodes.length) {
            linkNodes.forEach(ln => {
              const txt = (ln.text || '').trim();
              const url = (ln.url || '').trim();
              if (url) {
                const isWF = url.includes('workflowy.com');
                const tgt = isWF ? 'workflowy-pane' : '_blank';
                rows += `<a class="link-cell-item" href="${escA(url)}" target="${tgt}" title="${escA(url)}">`
                      + `<span class="link-bullet">・</span>${esc(txt || url)}</a>`;
              } else {
                rows += `<span class="link-cell-item" onclick="openNotePanelToDate('proj:${pi}','${ln.id}')" title="${escA(txt)}">`
                      + `<span class="link-bullet">・</span>${esc(txt)}</span>`;
              }
            });
          } else {
            rows += `<span class="link-cell-empty" onclick="toggleNotePanel('proj:${pi}')" title="プロジェクトノートでリンクを追加">＋リンクを追加</span>`;
          }
          rows += `</td>`;
        }

        // ── 案A: プロジェクト全体のスパンレーン割当を事前計算（同名スパン = 同レーン）──
        const spanLanes = computeSpanLanesForProject(pi);

        // ── week columns ──
        weeks.forEach(w => {
          const k = wkey(w);
          const items = getGridItems(pi, k);
          const isCur = k === cw;
          rows += `<td class="col-week${isCur ? ' cur-week' : ''}" data-pi="${pi}" data-wk="${k}">`;
          rows += `<div class="wcell${isCur ? ' cur' : ''}" onclick="wcellClick(event,${pi},'${k}')">`;
          if (!proj.collapsed) {
            rows += `<div class="elist" id="el-${pi}-${k}" ondragover="eDragOver(event)" ondrop="eDrop(event,${pi},'${k}')">`;
            // ── スパンバー + 配下タスク（startDate/endDate を持つノードと子タスクをグループ表示）──
            const projTag4span = proj.name.replace(/\s+/g, '_');
            // この週をカバーするスパンノードを収集
            const weekSpans = [];
            getAllNodes().forEach(({ node: sn }) => {
              if (sn.projTag !== projTag4span || !sn.startDate || !sn.endDate) return;
              try {
                const sWk = wkey(new Date(sn.startDate.replace(/-/g, '/')));
                const eWk = wkey(new Date(sn.endDate.replace(/-/g, '/')));
                if (k >= sWk && k <= eWk) weekSpans.push({ node: sn, sWk, eWk });
              } catch(e) {}
            });

            // この週の全タスクアイテムを取得
            const allTreeItems = getTreeOrderedItems(pi, k);
            // スパンの子として登録済みのIDセット
            const claimedIds = new Set();

            // 案A: 週内のスパンを laneIdx でindex化（同レーン重複時は startDate が早い方を優先）
            const lanedSpans = new Map(); // laneIdx -> { node, sWk, eWk }
            weekSpans.forEach(ws => {
              const li = spanLanes.laneMap.get(spanKeyOf(ws.node));
              if (li === undefined) return;
              const cur = lanedSpans.get(li);
              if (!cur || ws.node.startDate < cur.node.startDate) lanedSpans.set(li, ws);
            });

            // レーン順に出力（欠けレーンは透明プレースホルダで詰めて、バーの縦位置を全列で揃える）
            for (let li = 0; li <= spanLanes.maxLane; li++) {
              const cur = lanedSpans.get(li);
              if (!cur) {
                rows += `<div class="span-inline-bar" style="visibility:hidden;pointer-events:none" aria-hidden="true"></div>`;
                continue;
              }
              const sn = cur.node, sWk = cur.sWk, eWk = cur.eWk;
              const spanColor = SPAN_COLORS[li % SPAN_COLORS.length]; // レーン番号で安定した色
              const clL = sWk < firstWk;
              const clR = eWk > lastWk;

              // 案②拡張: バー本体クリックで元ノード（ノートパネル）へジャンプ、✏で詳細パネル
              // origin週は sn.date（無ければ sn.startDate）を wkey() した値。
              let originWk = '';
              const originDate = (sn.date || sn.startDate || '');
              try {
                const dStr = originDate.replace(/-/g, '/');
                if (dStr) originWk = wkey(new Date(dStr));
              } catch(e) {}
              const safeId = String(sn.id).replace(/'/g, "\\'");
              const safeDate = originDate.replace(/'/g, "\\'");
              rows += `<div class="span-inline-bar${clL?' clip-left':''}${clR?' clip-right':''}"
                style="background:${spanColor}"
                onclick="event.stopPropagation();openNotePanelToDate('${safeDate}','${safeId}')"
                title="${esc(sn.text)}\nクリック: 元ノードへ移動 ／ ✏: 詳細パネル\n${sn.startDate} 〜 ${sn.endDate}">`;
              if (!clL || k === firstWk) rows += `<span class="span-bar-text">${esc(sn.text)}</span>`;
              else rows += `<span class="span-bar-text"></span>`;
              // 編集アイコン（バー右端）
              rows += `<span class="span-bar-edit" title="このスパンの詳細パネルを開く"
                onclick="event.stopPropagation();openPanel(${pi},'${originWk || k}','${safeId}')">✏</span>`;
              rows += `</div>`;
            }

            // 子タスク（parentId が一致するもの）はレーン順にまとめて出力
            // ※ バーの直後ではなく、全バーが揃ってから出すことでレーン位置のズレを防ぐ
            for (let li = 0; li <= spanLanes.maxLane; li++) {
              const cur = lanedSpans.get(li);
              if (!cur) continue;
              const sn = cur.node;
              allTreeItems.forEach(item => {
                if (item.node.parentId === sn.id) {
                  claimedIds.add(item.node.id);
                  rows += renderEntry(item.node, pi, k, item.node.id, {
                    date: item.date, idx: item.idx,
                    isParent: item.isParent, isChild: true,
                    childCount: item.children.length
                  });
                }
              });
            }

            // スパンに属さない残りのタスク
            const treeItems = allTreeItems.filter(item => !claimedIds.has(item.node.id));
            treeItems.forEach(item => {
              rows += renderEntry(item.node, pi, k, item.node.id, {
                date: item.date, idx: item.idx,
                isParent: item.isParent, isChild: item.isChild,
                childCount: item.children.length
              });
            });
            // ── 今週のみ: 前週以前の未完了アイテムをミラー表示 ──
            if (isCur) {
              const mirrorItems = getMirrorItems(pi, k);
              if (mirrorItems.length > 0) {
                rows += `<div class="mirror-divider" title="前週以前から継続中のアイテム。直接編集できます（元の週に保存されます）">↩ 継続中（前週より）</div>`;
                mirrorItems.forEach(item => {
                  // isMirror: item.isMirror（現在週の子はfalse）
                  // originWk: ミラーは元週、現在週の子は設定しない（通常アイテムとして扱う）
                  rows += renderEntry(item.node, pi, k, item.node.id, {
                    date: item.date, idx: item.idx,
                    isParent: item.isParent, isChild: item.isChild,
                    childCount: (item.children || []).length,
                    isMirror: item.isMirror !== false, // デフォルトtrue（後方互換）
                    originWk: item.isMirror !== false ? item.originWk : undefined
                  });
                });
              }
            }
            rows += `</div>`;
            rows += `<div class="qarow">`;
            rows += `<input class="qainp" type="text" tabindex="-1" placeholder="追加…(Enter)" data-pi="${pi}" data-wk="${k}" onkeydown="qainpKeyDown(event,this)" autocomplete="off">`;
            rows += `<button class="qabtn" tabindex="-1" onclick="openPanel(${pi},'${k}',null);refocusAfterBtn()">＋</button>`;
            rows += `</div>`;
          } else {
            const undone = items.filter(item => getNodeType(item.node) === 'todo' && !item.node.checked).length;
            if (items.length) {
              rows += `<span style="font-size:11px;color:var(--tx2)">${items.length}件`;
              if (undone) rows += ` <span style="color:var(--tx-warn);font-weight:600">☐${undone}</span>`;
              rows += `</span>`;
            }
          }
          rows += `</div></td>`;
        });
        rows += '</tr>';
      });
      // Step 2: 列数 = プロジェクト + Phase + リンク + 週(WEEKS) = WEEKS + 3
      rows += `<tr><td colspan="${WEEKS + 3}"><div class="parow"><input id="painp" class="painp" type="text" placeholder="新しいプロジェクト名を入力してEnter" onkeydown="if(event.key==='Enter')addProjFromInput(this)" autocomplete="off"><button class="qabtn" onclick="addProjFromInput($('painp'))">追加</button></div></td></tr>`;
      $('gb').innerHTML = rows;

      // ノートエディタがフォーカス中の場合はグリッド側にフォーカスを移さない
      // _notePanelOpen が true の場合はノートパネルが開いており、confirm ダイアログ等で
      // activeElement が一時的に body になっても note 側を優先する
      const ae = document.activeElement;
      const noteHasFocus = _notePanelOpen || (ae && (ae.closest('#ol-container') || ae.closest('#note-panel') || ae.closest('#ol-slash-menu') || ae.closest('#ol-proj-menu')));
      if (focusKey && !noteHasFocus) requestAnimationFrame(() => requestAnimationFrame(() => applyFocusKey(focusKey)));
      if (todoOpen) renderTodo();
      // スパンバー描画（startDate/endDateを持つノード）
      requestAnimationFrame(renderSpanBars);
    }


    /* ================================================================
       CATEGORY & RECURRING — ヘルパー関数
    ================================================================ */


    // 繰り返しエントリHTML
    function renderEntry(n, pi, k, nodeId, ctx) {
      if (!n) return '';
      ctx = ctx || {};
      const isParentNode = !!ctx.isParent;
      const isChildNode  = !!ctx.isChild;
      const isMirror     = !!ctx.isMirror;
      const originWk     = ctx.originWk || k; // ミラーの場合は元の週、通常は同じ
      const originDate   = isMirror ? (ctx.date || '') : ''; // ミラーの元の具体的な日付
      const nodeType = getNodeType(n);
      const isProj = k === 'proj';
      const badges = (n.note && n.note.trim() ? '📄' : '') + ((n.images && n.images.length ? '🖼' : ''));
      const isFocused = focusKey === fkey(pi, k, nodeId);
      const prio = n.priority || '';
      const tags = n.tags || [];
      // タグフィルタ一致チェック
      const tagMatch = !_tagFilter || tags.includes(_tagFilter);
      // リンクタイプはクリックでパネルを開かず <a> のリンク遷移を優先
      const clickHandler = nodeType === 'link' ? '' : `onclick="eitemClick(event,this)" ondblclick="eitemDblClick(event,this)"`;
      // 親子クラス
      const parentChildClass = (isParentNode ? ' eitem-parent' : '') + (isChildNode ? ' eitem-child' : '');
      // ミラークラス
      const mirrorClass = isMirror ? ' eitem-mirror' : '';
      // ミラー属性: data-wk=今週(ナビ用)、data-origin-wk=元週(データ操作用)、data-origin-date=元の日付(子追加など)
      const mirrorAttr = isMirror ? ` data-origin-wk="${originWk}" data-origin-date="${originDate}"` : '';
      // ミラーはドラッグ不可
      const draggable = isMirror ? 'false' : 'true';
      const dragHandler = isMirror ? '' : `ondragstart="eDragStart(event,${pi},'${originWk}','${nodeId}')"`;
      // 子ノードはラッパーでインデント
      const wrapOpen  = isChildNode ? `<div class="eitem-child-wrap">` : '';
      const wrapClose = isChildNode ? `</div>` : '';
      let o = `${wrapOpen}<div class="eitem${isFocused ? ' kfocus' : ''}${(n.checked && nodeType === 'todo') ? ' e-done' : ''}${tagMatch ? ' tag-match' : ''}${parentChildClass}${mirrorClass}" tabindex="0" data-pi="${pi}" data-wk="${k}"${mirrorAttr} data-ei="${nodeId}" data-tags="${escA(tags.join(','))}" draggable="${draggable}" ${dragHandler} ondragover="event.preventDefault();event.stopPropagation()" ondrop="${isMirror ? '' : `eDropOnItem(event,${pi},'${k}','${nodeId}')`}" ${clickHandler} onkeydown="eitemKeyDown(event,this)"${isProj ? ' style="font-size:12px"' : ''}>`;
      // 優先度バー
      o += `<span class="e-prio-bar e-prio-${prio || 'none'}" title="${prio === 'high' ? '高優先度' : prio === 'mid' ? '中優先度' : prio === 'low' ? '低優先度' : ''}"></span>`;
      // ミラーバッジ（↩ アイコン）
      if (isMirror) o += `<span class="mirror-badge" title="継続中 — ${originWk.replace(/-/g, '/')} 週のデータ。編集・子追加は元週に保存されます">↩</span>`;
      if (nodeType === 'todo' || (isProj && nodeType === 'todo')) {
        // ミラーの場合: originWkでデータ更新、kでフォーカス維持(displayWk)
        const toggleCall = isMirror
          ? `toggleTodo(${pi},'${originWk}','${nodeId}','${k}')`
          : `toggleTodo(${pi},'${k}','${nodeId}')`;
        o += `<input type="checkbox" class="cb"${n.checked ? ' checked' : ''} onclick="event.stopPropagation();${toggleCall}">`;
        o += `<span class="etxt${n.checked ? ' done' : ''}">`;
        o += getDueBadge(n);
        o += esc(n.text);
        if (badges) o += `<span class="e-badge">${badges}</span>`;
        o += `</span>`;
      } else if (nodeType === 'link') {
        const isWF = (n.url || '').includes('workflowy.com');
        const tgt = isWF ? 'workflowy-pane' : '_blank';
        o += `<span class="tag tag-lnk">🔗</span>`;
        o += getDueBadge(n);
        o += `<span class="etxt"><a href="${escA(n.url || '#')}" target="${tgt}">${esc(n.text)}</a>${badges ? '<span class="e-badge">' + badges + '</span>' : ''}`;
        o += `</span>`;
      } else {
        o += `<span class="tag tag-log">📝</span>`;
        o += getDueBadge(n);
        o += `<span class="etxt">${esc(n.text)}${badges ? `<span class="e-badge">${badges}</span>` : ''}</span>`;
      }
      // タグ表示（テキスト右のインライン表示）
      if (tags.length) {
        o += `<span class="e-tags-inline">`;
        tags.forEach(t => {
          const ts = tagChipStyle(t);
          o += `<span class="e-tag-chip" style="${ts}" onclick="event.stopPropagation();setTagFilter('${escA(t)}')" oncontextmenu="event.preventDefault();event.stopPropagation();showTagColorPicker('${escA(t)}',event)" title="クリック: フィルタ / 右クリック: 色設定">#${esc(t)}</span>`;
        });
        o += `</span>`;
      }
      o += `<span class="edel" onclick="event.stopPropagation();deleteE(${pi},'${originWk}','${nodeId}')">✕</span>`;
      o += `</div>${wrapClose}`;
      return o;
    }

    /* ── focus management ── */

    /* ================================================================
       NAVIGATION — unified, clean rewrite
       focusKey = "pi:wk:ei"  (wk="__empty__" when in qainp)
    ================================================================ */
    let _programmaticFocus = false;

    // ── apply focus to an eitem or qainp ─────────────────────────────
    // ── apply focus to an eitem or qainp ─────────────────────────────
    function applyFocus(pi, wk, ei) {
      document.querySelectorAll('.eitem.kfocus').forEach(el => el.classList.remove('kfocus'));
      
      let el = null;
      if (typeof pi === 'string' && pi === 'daily') {
        // デイリーアイテムの場合 (ei = nid)
        el = document.querySelector(`.eitem[data-daily="1"][data-date="${wk}"][data-nid="${ei}"]`);
      } else {
        // 通常アイテムの場合
        pi = +pi;
        el = document.querySelector(`.eitem[data-pi="${pi}"][data-wk="${wk}"][data-ei="${ei}"]`);
        // 見つかったアイテムが非表示（display:none）の場合は、el をクリアして代替を探す
        if (el && !(el.offsetWidth > 0 || el.offsetHeight > 0)) el = null;
        
        if (!el) {
          const all = Array.from(document.querySelectorAll(`.eitem[data-pi="${pi}"][data-wk="${wk}"]`))
                           .filter(x => x.offsetWidth > 0 || x.offsetHeight > 0);
          if (all.length) el = all[all.length - 1]; // Focus last visible item
        }
      }

      if (el) { applyFocusToElement(el); }
      else {
        const td = document.querySelector(`td[data-pi="${pi}"][data-wk="${wk}"]`);
        const inp = td && td.querySelector('.qainp');
        if (inp) {
          focusKey = fkey(pi, wk, -1);   // -1 = "in qainp"
          _programmaticFocus = true;
          inp.focus();
          setTimeout(() => { _programmaticFocus = false; }, 50);
          inp.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          requestAnimationFrame(() => _scrollClearSticky(inp));
        } else { focusKey = null; }
      }
    }

    function applyFocusToElement(el) {
      if (!el) return;
      document.querySelectorAll('.eitem.kfocus').forEach(e => e.classList.remove('kfocus'));
      if (el.dataset.daily) {
        focusKey = 'daily:' + el.dataset.date + ':' + el.dataset.nid;
      } else {
        focusKey = fkey(el.dataset.pi, el.dataset.wk, el.dataset.ei);
      }
      el.classList.add('kfocus');
      _programmaticFocus = true;
      el.focus();
      setTimeout(() => { _programmaticFocus = false; }, 50);
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      // sticky列に隠れている場合は scrollLeft を補正する
      requestAnimationFrame(() => _scrollClearSticky(el));
    }

    function _scrollClearSticky(el) {
      const wrap = document.getElementById('grid-wrap');
      if (!wrap) return;
      // sticky列（プロジェクト名列）の右端を取得
      const stickyCol = wrap.querySelector('td.col-proj, th.col-proj');
      if (!stickyCol) return;
      const stickyRight = stickyCol.getBoundingClientRect().right;
      const elRect = el.getBoundingClientRect();
      const PADDING = 12;
      if (elRect.left < stickyRight) {
        // 要素がsticky列の後ろに隠れている → 左にスクロール
        wrap.scrollLeft -= (stickyRight - elRect.left) + PADDING;
      } else if (elRect.right > wrap.getBoundingClientRect().right) {
        // 要素が右端にはみ出している → 右にスクロール
        wrap.scrollLeft += (elRect.right - wrap.getBoundingClientRect().right) + PADDING;
      }
    }

    // 同一列内でのrowIdx（表示アイテム中の位置）を取得する
    function getRowIdx(pi, wk, el) {
      if (!el) return -1;
      const td = document.querySelector(`td[data-pi="${pi}"][data-wk="${wk}"]`);
      if (!td) return -1;
      const all = Array.from(td.querySelectorAll('.eitem')).filter(x => x.offsetWidth > 0 || x.offsetHeight > 0);
      return all.indexOf(el);
    }

    // rowIdxを指定してフォーカスを当てる（位置保持ナビゲーション用）
    function applyFocusAtRowIdx(pi, wk, rowIdx) {
      const td = document.querySelector(`td[data-pi="${pi}"][data-wk="${wk}"]`);
      if (!td) { applyFocus(pi, wk, null); return; }
      const all = Array.from(td.querySelectorAll('.eitem')).filter(x => x.offsetWidth > 0 || x.offsetHeight > 0);
      if (!all.length) { applyFocus(pi, wk, null); return; }
      const idx = rowIdx < 0 ? 0 : Math.min(rowIdx, all.length - 1);
      applyFocusToElement(all[idx]);
    }

    // ── core navigation: given current pi/wk/ei, move by direction ───
    function navigate(ev, pi, wk, ei, currentEl) {
      pi = +pi; // ei は文字列（"r0"など）の可能性があるため一律数値化しない
      const isAltShift = ev.altKey && ev.shiftKey;
      const key = ev.key;
      // 現在の列内での位置インデックス（←/→ナビ用）
      const rowIdx = getRowIdx(pi, wk, currentEl);
      // ミラー判定: data-origin-wk があれば元週でデータ操作、フォーカスは表示週(wk)で維持
      const dataWkNav = (currentEl && currentEl.dataset.originWk) || wk;
      const isMirrorNav = !!(currentEl && currentEl.dataset.originWk);

      if (isAltShift && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        ev.preventDefault();
        const dir = key === 'ArrowLeft' ? -1 : 1;
        const weeks = getWeeks().map(w => wkey(w));
        let nwk = '';
        if (wk === 'proj') {
          if (dir === 1) nwk = weeks[0];
          else { S.wOff--; saveState(); render(); nwk = getWeeks().map(w => wkey(w))[WEEKS - 1]; }
        } else {
          const wkIdx = weeks.indexOf(wk);
          const nwkIdx = wkIdx + dir;
          if (nwkIdx < 0) {
            S.wOff--; saveState(); render(); nwk = getWeeks().map(w => wkey(w))[WEEKS - 1];
          } else if (nwkIdx >= WEEKS) {
            S.wOff++; saveState(); render(); nwk = getWeeks().map(w => wkey(w))[0];
          } else {
            nwk = weeks[nwkIdx];
          }
        }
        showHint(dir < 0 ? '◀ 前週' : '▶ 次週');
        requestAnimationFrame(() => requestAnimationFrame(() => applyFocusAtRowIdx(pi, nwk, rowIdx)));
        return;
      }

      if (isAltShift && (key === 'ArrowUp' || key === 'ArrowDown')) {
        ev.preventDefault();
        const dir = key === 'ArrowUp' ? -1 : 1;

        // アイテムが有効かつプロジェクト列でない場合: セル内でアイテムを上下に移動
        // ミラーアイテムの場合は元週(dataWkNav)のツリーで順序操作、フォーカスは表示週(wk)で維持
        if (ei !== undefined && ei !== -1 && ei !== -2 && wk !== 'proj') {
          const treeItems = getTreeOrderedItems(pi, dataWkNav);
          const myItem = treeItems.find(i => i.node.id === ei);
          if (myItem && !myItem.isChild) {
            // 親アイテムのみで上下位置を決定（子アイテムはスキップ）
            const topLevel = treeItems.filter(i => !i.isChild);
            const myTopIdx = topLevel.findIndex(i => i.node.id === ei);
            const tgtTopIdx = myTopIdx + dir;

            if (tgtTopIdx >= 0 && tgtTopIdx < topLevel.length) {
              const targetItem = topLevel[tgtTopIdx];
              const myNodes = S.dailyOutline[myItem.date];
              const myIdxInNodes = myNodes ? myNodes.findIndex(n => n.id === myItem.node.id) : -1;

              if (myIdxInNodes >= 0) {
                if (myItem.date === targetItem.date) {
                  // 同日付内: targetの前（↑）or 後（↓）に挿入
                  const tgtIdxInNodes = myNodes.findIndex(n => n.id === targetItem.node.id);
                  if (tgtIdxInNodes >= 0) {
                    const [removed] = myNodes.splice(myIdxInNodes, 1);
                    // splice後のtarget位置を補正（myより前にあればindexがずれない）
                    const newTgtIdx = tgtIdxInNodes > myIdxInNodes ? tgtIdxInNodes - 1 : tgtIdxInNodes;
                    // ↑ → targetの前に挿入、↓ → targetの後ろに挿入
                    const insertIdx = dir < 0 ? newTgtIdx : newTgtIdx + 1;
                    myNodes.splice(insertIdx, 0, removed);
                    saveState(); triggerAutoSave(); render();
                    showHint(dir < 0 ? '↑ 上に移動' : '↓ 下に移動');
                    requestAnimationFrame(() => applyFocus(pi, wk, ei));
                    return;
                  }
                } else {
                  // 別の日付: targetの前（↑）or 後（↓）に移動
                  myNodes.splice(myIdxInNodes, 1);
                  const tgtNodes = S.dailyOutline[targetItem.date];
                  const tgtIdxInNodes = tgtNodes ? tgtNodes.findIndex(n => n.id === targetItem.node.id) : -1;
                  if (tgtNodes && tgtIdxInNodes >= 0) {
                    const insertIdx = dir < 0 ? tgtIdxInNodes : tgtIdxInNodes + 1;
                    tgtNodes.splice(insertIdx, 0, myItem.node);
                  } else if (tgtNodes) {
                    tgtNodes.push(myItem.node);
                  }
                  saveState(); triggerAutoSave(); render();
                  showHint(dir < 0 ? '↑ 上に移動' : '↓ 下に移動');
                  // ミラーの場合は表示週(wk)でフォーカス維持、通常は移動先の週へ追従
                  if (isMirrorNav) {
                    requestAnimationFrame(() => applyFocus(pi, wk, ei));
                  } else {
                    const [ty, tm, td] = targetItem.date.split('-').map(Number);
                    const targetWk = wkey(new Date(ty, tm - 1, td));
                    requestAnimationFrame(() => applyFocus(pi, targetWk, ei));
                  }
                  return;
                }
              }
            }

            // セル境界を超える場合: 別プロジェクトへフォーカス移動
            const npi = pi + dir;
            if (npi >= 0 && npi < S.projects.length) {
              showHint(dir < 0 ? '▲ 前プロジェクト' : '▼ 次プロジェクト');
              applyFocusAtRowIdx(npi, wk, rowIdx);
            }
            return;
          }
        }

        // フォールバック: 別プロジェクトへフォーカス移動
        const npi = pi + dir;
        if (npi < 0 || npi >= S.projects.length) return;
        showHint(dir < 0 ? '▲ 前プロジェクト' : '▼ 次プロジェクト');
        applyFocusAtRowIdx(npi, wk, rowIdx);
        return;
      }

      // ↑/↓ 矢印キー単独 — セル内移動 + qainp経由でPJをまたぐ
      if (!ev.altKey && !ev.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
        ev.preventDefault();
        const dir = key === 'ArrowUp' ? -1 : 1;

        // DOMベースでの移動（通常アイテムとデイリーアイテムを混在して扱う）
        if (currentEl) {
          const list = currentEl.closest('.elist');
          if (list) {
            // 表示されている（display:none でない）アイテムのみを対象にする
            const allItems = Array.from(list.querySelectorAll('.eitem')).filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);
            const curIdx = allItems.indexOf(currentEl);
            const nextIdx = curIdx + dir;
            if (nextIdx >= 0 && nextIdx < allItems.length) {
              applyFocusToElement(allItems[nextIdx]);
              return;
            }
          }
        }

        if (dir === 1) {
          // アイテム末尾 → まずqainpへ（次PJへは qainp からさらに↓）
          const td = document.querySelector(`td[data-pi="${pi}"][data-wk="${wk}"]`);
          const inp = td && td.querySelector('.qainp');
          if (inp) {
            // kfocus を外してからqainpにフォーカス（残留しないよう）
            document.querySelectorAll('.eitem.kfocus').forEach(el => el.classList.remove('kfocus'));
            focusKey = fkey(pi, wk, -1);
            _programmaticFocus = true;
            inp.focus();
            setTimeout(() => { _programmaticFocus = false; }, 50);
            inp.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
          return;
        }

        if (dir === -1) {
          // アイテム先頭 → 前プロジェクトのqainpへ
          const npi = pi - 1;
          if (npi >= 0) {
            showHint('▲ 前プロジェクト');
            const targetTd = document.querySelector(`td[data-pi="${npi}"][data-wk="${wk}"]`);
            if (targetTd) {
              const prevItems = Array.from(targetTd.querySelectorAll('.eitem')).filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);
              if (prevItems.length) {
                applyFocusToElement(prevItems[prevItems.length - 1]);
              } else {
                applyFocus(npi, wk, 0); // qainpへ
              }
            }
          }
          return;
        }
        return;
      }

      // ←/→ 矢印キー単独 — 常に週移動（どのアイテムにいても）
      if (!ev.altKey && !ev.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        ev.preventDefault();
        const dir = key === 'ArrowLeft' ? -1 : 1;
        const weeks = getWeeks().map(w => wkey(w));
        let nwk = '';
        if (wk === 'proj') {
          if (dir === 1) nwk = weeks[0];
          else {
            S.wOff--; saveState(); render();
            nwk = getWeeks().map(w => wkey(w))[WEEKS - 1];
          }
        } else {
          const wkIdx = weeks.indexOf(wk);
          const nwkIdx = wkIdx + dir;
          if (nwkIdx < 0) {
            nwk = 'proj';
          } else if (nwkIdx >= WEEKS) {
            S.wOff++; saveState(); render();
            nwk = getWeeks().map(w => wkey(w))[0];
          } else {
            nwk = weeks[nwkIdx];
          }
        }
        showHint(dir < 0 ? '◀ 前へ' : '▶ 次へ');
        applyFocusAtRowIdx(pi, nwk, rowIdx);
        return;
      }
    }

    // セルの空白部分クリック → 末尾アイテム or qainp にフォーカス
    function wcellClick(ev, pi, wk) {
      // eitem・qainp・qabtn・a タグへのクリックは各自のハンドラに任せる
      if (ev.target.closest('.eitem,.qainp,.qabtn,a')) return;
      const items = getGridItems(pi, wk);
      if (items.length) {
        applyFocus(pi, wk, items[items.length - 1].node.id);
      } else {
        applyFocus(pi, wk, 0); // 空セル → qainp
      }
    }

    // ── eitem handlers ────────────────────────────────────────────────
    // シングルクリック: フォーカスのみ（パネルは開かない）
    function eitemClick(ev, el) {
      // リンク(<a>)をクリックした場合はパネルを開かずリンク遷移を優先
      if (ev.target.closest('a')) return;
      // ナビ用にはdisplayWk(data-wk)、データ操作用にはdataWk(data-origin-wk || data-wk)を使う
      const pi = +el.dataset.pi, displayWk = el.dataset.wk, dataWk = el.dataset.originWk || el.dataset.wk, ei = el.dataset.ei;
      const newKey = fkey(pi, displayWk, ei); // focusKeyはdisplayWkで管理（ナビ一貫性）
      // 未保存で別アイテムをクリックした場合は警告して今のパネルを閉じる
      if (pCtx && panelDirty && fkey(pCtx.pi, pCtx.wk, pCtx.ei) !== fkey(pi, dataWk, ei)) {
        if (!confirm('未保存の変更があります。破棄しますか？')) return;
        clearDirty(); closePanel();
      }
      focusKey = newKey;
      document.querySelectorAll('.eitem.kfocus').forEach(x => x.classList.remove('kfocus'));
      el.classList.add('kfocus');
      // シングルクリックではパネルを開かない（ダブルクリックで開く）
    }

    function eitemKeyDown(ev, el) {
      if (el.dataset.daily) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          openNotePanelToDate(el.dataset.date, el.dataset.nid);
          return;
        }
        if (ev.key === ' ') {
          ev.preventDefault();
          tvCheckDaily(el.dataset.date, el.dataset.nid);
          return;
        }
        navigate(ev, +el.dataset.pi, el.dataset.wk, -2, el);
        return;
      }

      const pi = +el.dataset.pi, wk = el.dataset.wk, ei = el.dataset.ei; // ei is nodeId (string)
      const dataWk = el.dataset.originWk || wk; // ミラーはoriginWkでデータ操作、wkはナビ用
      const isMirrorItem = !!el.dataset.originWk;
      const found = findNodeById(ei);
      const n = found ? found.node : null;

      // Escape (圧縮モード中): 現プロジェクトを折りたたんでヘッダへ戻る
      if (ev.key === 'Escape' && _compactMode && _compactExpanded.has(pi)) {
        ev.preventDefault();
        ev.stopPropagation(); // グローバルEscapeハンドラに渡さない
        _compactExpanded.delete(pi);
        render();
        requestAnimationFrame(() => focusCompactHeader(pi));
        return;
      }

      // Ctrl+Enter: リンクタイプはリンク先を新しいタブで開く
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        if (n && n.url) {
          const isWF = n.url.includes('workflowy.com');
          window.open(n.url, isWF ? 'workflowy-pane' : '_blank');
        }
        return;
      }

      // Enter: ノートパネルをズームモードで開く（そのノードにフォーカスインして子ノードを表示）
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault();
        if (found) {
          // ズームモードを設定してからパネルを開く
          _olFocusMode = { date: found.date, nodeId: ei };
          const fNodes = olGetNodes(found.date);
          const fIdx = fNodes.findIndex(n => n.id === ei);
          // 子ノードがあれば最初の子にフォーカス、なければ自身（パンくず編集）
          const firstChild = fIdx >= 0 ? fNodes.slice(fIdx + 1).find(n => n.indent > fNodes[fIdx].indent) : null;
          openNotePanelToDate(found.date, firstChild ? firstChild.id : ei);
        }
        return;
      }

      // Shift+Enter: 詳細パネルを開く
      if (ev.key === 'Enter' && ev.shiftKey) {
        ev.preventDefault();
        if (pCtx && panelDirty && fkey(pCtx.pi, pCtx.wk, pCtx.ei) !== fkey(pi, dataWk, ei)) {
          if (!confirm('未保存の変更があります。破棄しますか？')) return;
          panelDirty = false;
        }
        openPanel(pi, dataWk, ei); // ミラーは元の週でパネルを開く
        return;
      }
      if (ev.key === ' ') {
        if (n && getNodeType(n) === 'todo') {
          ev.preventDefault();
          // ミラーの場合: データはoriginWk、フォーカスはdisplayWk(wk)で維持
          toggleTodo(pi, dataWk, ei, isMirrorItem ? wk : undefined);
        }
        return;
      }

      // Tab: サブタスク化（1階層のみ、プロジェクト列を除く）
      // ミラーアイテムの場合も元週のツリーで処理（透過的書き込み）
      if (ev.key === 'Tab' && !ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey && wk !== 'proj' && n && !n.parentId) {
        // ミラーの場合は元週のツリーで直上のアイテムを探す
        const treeItems = getTreeOrderedItems(pi, isMirrorItem ? dataWk : wk);
        const myIdx = treeItems.findIndex(i => i.node.id === ei);
        if (myIdx > 0) {
          const above = treeItems[myIdx - 1];
          const newParentId = above.isChild ? above.node.parentId : above.node.id;
          if (newParentId) {
            ev.preventDefault();
            n.parentId = newParentId;
            saveState(); triggerAutoSave(); render();
            requestAnimationFrame(() => applyFocus(pi, wk, ei));
            return;
          }
        }
        if (isMirrorItem) { ev.preventDefault(); return; } // ミラーは他処理へフォールスルーしない
      }

      // Shift+Tab: サブタスク解除（ミラー子アイテムも元週で処理）
      if (ev.key === 'Tab' && ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey && wk !== 'proj' && n && n.parentId) {
        ev.preventDefault();
        delete n.parentId;
        saveState(); triggerAutoSave(); render();
        requestAnimationFrame(() => applyFocus(pi, wk, ei));
        return;
      }

      // Ctrl+↓: 親ノードを展開する
      if (ev.key === 'ArrowDown' && ev.ctrlKey && !ev.shiftKey && !ev.altKey && wk !== 'proj') {
        // ミラーの場合はoriginWk(dataWk)でツリーを取得し、フォーカスはdisplayWk(wk)で維持
        const treeItems = getTreeOrderedItems(pi, dataWk);
        const myItem = treeItems.find(i => i.node.id === ei);
        if (myItem) {
          let targetNode = myItem.isParent ? myItem.node
            : myItem.isChild ? (findNodeById(myItem.node.parentId) || {}).node : null;
          if (targetNode && targetNode.gridCollapsed) {
            ev.preventDefault();
            targetNode.gridCollapsed = false;
            saveState(); triggerAutoSave(); render();
            requestAnimationFrame(() => applyFocus(pi, wk, targetNode.id));
            return;
          }
        }
      }

      // Ctrl+↑: 親ノードを折りたたむ
      if (ev.key === 'ArrowUp' && ev.ctrlKey && !ev.shiftKey && !ev.altKey && wk !== 'proj') {
        // ミラーの場合はoriginWk(dataWk)でツリーを取得し、フォーカスはdisplayWk(wk)で維持
        const treeItems = getTreeOrderedItems(pi, dataWk);
        const myItem = treeItems.find(i => i.node.id === ei);
        if (myItem) {
          let targetNode = myItem.isParent ? myItem.node
            : myItem.isChild ? (findNodeById(myItem.node.parentId) || {}).node : null;
          if (targetNode && !targetNode.gridCollapsed) {
            ev.preventDefault();
            targetNode.gridCollapsed = true;
            saveState(); triggerAutoSave(); render();
            requestAnimationFrame(() => applyFocus(pi, wk, targetNode.id));
            return;
          }
        }
      }

      navigate(ev, pi, wk, ei, el);
    }

    // ── qainp handler ─────────────────────────────────────────────────
    function qainpKeyDown(ev, inp) {
      const pi = +inp.dataset.pi, wk = inp.dataset.wk;
      if (ev.key === 'Enter') {
        quickAdd(pi, wk, inp);
        return;
      }
      // Alt+Shift: navigate from empty cell
      if (ev.altKey && ev.shiftKey &&
        (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
        navigate(ev, pi, wk, -1);
        return;
      }
      // 矢印キー単独: 入力ボックスからも週・PJ 移動
      if (!ev.altKey && !ev.shiftKey) {
        if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          const items = getGridItems(pi, wk);
          if (items.length) {
            // 同セルにアイテムあり → 末尾アイテムへ
            applyFocus(pi, wk, items[items.length - 1].node.id);
          } else if (pi > 0) {
            // 同セルが空 → 前プロジェクトへ
            showHint('▲ 前プロジェクト');
            const prevItems = getGridItems(pi - 1, wk);
            applyFocus(pi - 1, wk, prevItems.length ? prevItems[prevItems.length - 1].node.id : 0);
          }
          return;
        }
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          if (pi + 1 < S.projects.length) {
            showHint('▼ 次プロジェクト');
            applyFocus(pi + 1, wk, 0);
          }
          return;
        }
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
          ev.preventDefault();
          navigate(ev, pi, wk, -1);
          return;
        }
      }
    }

    // ── Tab: track focus changes from Tab key ─────────────────────────
    document.addEventListener('focusin', ev => {
      if (_programmaticFocus) return;
      const el = ev.target.closest('.eitem[data-wk]');
      if (el) {
        const key = fkey(el.dataset.pi, el.dataset.wk, el.dataset.ei);
        if (focusKey !== key) {
          focusKey = key;
          document.querySelectorAll('.eitem.kfocus').forEach(x => x.classList.remove('kfocus'));
          el.classList.add('kfocus');
        }
      }
    }, true);

    // フォーカスが eitem 以外に移ったとき kfocus を除去（見た目の残留を防ぐ）
    document.addEventListener('focusout', ev => {
      if (_programmaticFocus) return;
      // relatedTarget が別の eitem なら focusin 側で処理するので何もしない
      const next = ev.relatedTarget;
      if (next && next.closest && next.closest('.eitem[data-wk]')) return;
      // パネル内・qainp など eitem 以外に移動した場合は kfocus を外す
      if (!next || !next.closest('.eitem[data-wk]')) {
        document.querySelectorAll('.eitem.kfocus').forEach(x => x.classList.remove('kfocus'));
        // focusKey は保持（Alt+Shift ナビの起点として使うため）
      }
      // ヘッダのフォーカス表示はネイティブ :focus に委ねるためクリーンアップ不要
    }, true);


    function applyFocusKey(key) {
      if (!key) return;
      const parts = key.split(':');
      if (parts[0] === 'daily') {
        applyFocus('daily', parts[1], parts[2]); // daily:DATE:NID
      } else {
        // ei (parts[2]) は文字列nodeIdのため + で数値変換しない（NaN になりフォーカスがずれる）
        applyFocus(+parts[0], parts[1], parts[2]); // pi:wk:ei
      }
    }


    /* Called after ＋ button or panel close — keep focus in grid */
    function refocusGrid() {
      if (focusKey) {
        const parts = focusKey.split(":"); 
        if (parts[0] === 'daily') applyFocus('daily', parts[1], parts[2]);
        else applyFocus(+parts[0], parts[1], parts[2]); // ei (parts[2]) をそのまま渡す
      } else {
        // focus first available eitem
        const el = document.querySelector('.eitem');
        if (el) {
          el.focus(); el.classList.add('kfocus');
          const [pi, wk, ei] = [el.dataset.pi, el.dataset.wk, el.dataset.ei];
          focusKey = fkey(pi, wk, ei);
        }
      }
    }
    function refocusAfterBtn() {
      // ＋ button was clicked — panel opens, but if it's closed later, refocus
      // nothing needed here, tryClosePanel calls refocusGrid
    }

    /* ── keyboard navigation ── */


    function showHint(msg) {
      const h = $('shortcut-hint'); h.textContent = msg; h.classList.add('show');
      clearTimeout(showHint._t); showHint._t = setTimeout(() => h.classList.remove('show'), 1500);
    }
    function showHelp() {
      alert('【キーボードショートカット】\n\n━━ グリッド（表） ━━\nCtrl+K  ……  コマンドパレットを開く\nTab / Shift+Tab  ……  インデント増 / 減（ノートと統一）\n↑ / ↓  ……  アイテム間を移動\n← / →  ……  前週 / 次週\nEnter  ……  ノートを開いてノードにフォーカス（グリッド→ノート）\nShift+Enter  ……  詳細パネルを開く\nCtrl+Enter  ……  リンクを別タブで開く\nSpace  ……  ToDoチェック切替\nAlt+Shift+↑ / ↓  ……  アイテムを上下に移動（ノートと統一）\nAlt+Shift+← / →  ……  前週 / 次週（ビュー移動）\nAlt+Shift+E  ……  新規追加\nAlt+Shift+N  ……  ノートを開く\nAlt+Shift+C  ……  圧縮モードON/OFF\nEsc  ……  パネルを閉じる\n\n━━ 圧縮モード（ヘッダ行フォーカス中） ━━\n↑ / ↓  ……  前後のプロジェクトへ移動\nEnter / →  ……  展開して先頭アイテムへ\n← / Space  ……  折りたたみ / トグル\nEsc（アイテム操作中） ……  折りたたんでヘッダへ戻る\nAlt+H  ……  ヘッダへフォーカス（未有効時は圧縮モードを自動ON）\n\n━━ ノートエディタ ━━\nCtrl+↑ / ↓  ……  折りたたむ / 展開（グリッドと統一）\nAlt+Shift+↑ / ↓  ……  ノードを移動（グリッドと統一）\nTab / Shift+Tab  ……  インデント増 / 減（グリッドと統一）\nCtrl+L  ……  リンク挿入\nCtrl+.  ……  拡張メニュー（ToDo変換・色変更・日付移動 等）\nAlt+Enter  ……  グリッドへジャンプ（ノート→グリッド）\nAlt+↑ / ↓  ……  フォーカスモード戻る / 入る\nAlt+← / →  ……  前日 / 翌日\n→ / ←  ……  行端で次/前ノードへ\n\n━━ パネル内 ━━\nEnter  ……  テキスト欄で保存\nCtrl+Enter  ……  備考欄で保存');
    }

    /* ================================================================
       COMMAND PALETTE (Ctrl+K)
    ================================================================ */
    let _cmdActive = 0; // 選択中インデックス

    function _buildCmdList() {
      const list = [
        { id: 'search', icon: '🔍', label: '検索を開く', romaji: 'kensaku search', key: 'Ctrl+F', fn: () => { closeCmdPalette(); openSearch(); } },
        { id: 'new', icon: '＋', label: '新規追加', romaji: 'shinkitsuika', key: 'Alt+Shift+E', fn: () => openQA() },
        { id: 'view_all', icon: '🌐', label: '全表示モード', romaji: 'zenshyoji', key: 'Alt+1', fn: () => { closeCmdPalette(); _viewMode = 'all'; saveState(); render(); } },
        { id: 'view_work', icon: '💼', label: 'お仕事モード', romaji: 'oshigoto', key: 'Alt+2', fn: () => { closeCmdPalette(); _viewMode = 'work'; saveState(); render(); } },
        { id: 'view_private', icon: '🏠', label: 'プライベートモード', romaji: 'private', key: 'Alt+3', fn: () => { closeCmdPalette(); _viewMode = 'private'; saveState(); render(); } },
        { id: 'goToday', icon: '📅', label: '今週へ移動', romaji: 'konshu', key: 'Alt+0', fn: () => { closeCmdPalette(); goToday(); } },
        { id: 'prevW', icon: '◀', label: '前週へ移動', romaji: 'zenshu', key: 'Alt+Shift+←', fn: () => { prevW(); showHint('◀ 前週') } },
        { id: 'nextW', icon: '▶', label: '次週へ移動', romaji: 'jisshu', key: 'Alt+Shift+→', fn: () => { nextW(); showHint('▶ 次週') } },
        { id: 'hideDone', icon: '☑', label: _hideDone ? '完了済みを表示' : '完了済みを非表示', romaji: 'kanryo', key: 'Alt+D', fn: () => { closeCmdPalette(); toggleHideDone(); } },
        { id: 'compact', icon: '⊟', label: _compactMode ? '圧縮モードOFF' : '圧縮モードON', romaji: 'asshuku', key: 'Alt+Shift+C', fn: () => toggleCompactMode() },
        { id: 'hdr-focus', icon: '⬆', label: _compactMode ? 'ヘッダ行へフォーカス（折りたたまず）' : 'ヘッダ行へフォーカス（圧縮モードを有効化）', romaji: 'hedda header', key: 'Alt+H', fn: () => {
          let pi = -1;
          const kfEl = document.querySelector('.eitem.kfocus');
          if (kfEl) pi = +kfEl.dataset.pi;
          if (pi < 0 && focusKey) { const p = focusKey.split(':'); if (p[0] !== 'daily' && p[0] !== '') pi = +p[0]; }
          if (pi < 0) { const qa = document.activeElement; if (qa && qa.classList && qa.classList.contains('qainp')) pi = +qa.dataset.pi; }
          if (pi < 0 && S.projects && S.projects.length > 0) pi = 0;
          if (pi < 0) return;
          if (!_compactMode) { _compactMode = true; const btn = $('compact-btn'); if (btn) btn.classList.add('btn-active'); const grid = $('grid-wrap'); if (grid) grid.classList.add('compact-mode'); render(); }
          requestAnimationFrame(() => focusCompactHeader(pi));
        }},
        { id: 'note', icon: '📝', label: _notePanelOpen ? 'ノートを閉じる' : 'ノートを開く', romaji: 'note', key: 'Alt+Shift+N', fn: () => { _notePanelOpen ? toggleNotePanel() : focusNotePanel() } },
        { id: 'today-note', icon: '📅', label: '今日のノートを開く', romaji: 'today kyou note', key: 'Alt+T', fn: () => { closeCmdPalette(); openNotePanelToDate(todayDateStr(), null); } },
        { id: 'fs-focus', icon: '🔲', label: _fsFocus ? 'フルスクリーン解除' : 'フルスクリーン集中モード', romaji: 'fullscreen', key: 'Alt+Shift+M', fn: () => { toggleFsFocus() } },
        { id: 'todo', icon: '☑', label: '未完ToDoパネル', romaji: 'todo', key: 'Alt+Shift+D', fn: () => { closeCmdPalette(); toggleTodoPanel(); } },
        { id: 'backup', icon: '💾', label: 'JSONバックアップを保存', romaji: 'backup/save', key: '', fn: () => manualExport() },
        { id: 'import', icon: '📂', label: 'JSONを読み込む', romaji: 'import', key: '', fn: () => $('imp').click() },
        { id: 'ai', icon: '🤖', label: 'AIアシスタント', romaji: 'ai/chat', key: '', fn: () => toggleAiPanel() },
        { id: 'help', icon: '⌨', label: 'ショートカット一覧', romaji: 'help', key: '', fn: () => showHelp() },
      ];
      // プロジェクトを検索対象に追加
      S.projects.forEach((p, pi) => {
        list.push({ id: `p:${pi}`, icon: '📁', label: `移動: ${p.name}`, romaji: '', fn: () => jumpTo(pi, null, -1) });
      });

      // ─ コンテキスト依存コマンド ─
      // グリッドアイテムがフォーカスされている → ノートで開く
      const kfEl = document.querySelector('.eitem.kfocus:not([data-daily])');
      if (kfEl && kfEl.dataset.ei) {
        const nodeId = kfEl.dataset.ei;
        list.push({
          id: 'grid-to-note', icon: '📝',
          label: 'ノードをノートで開く（グリッド→ノート）',
          romaji: 'note open', key: 'Enter',
          fn: () => { const f = findNodeById(nodeId); if (f) openNotePanelToDate(f.date, nodeId); }
        });
      }

      // ノートのノードがフォーカスされている → グリッドへジャンプ
      if (_olFocusId && _olCurrentDate) {
        const olNodes = olGetNodes(_olCurrentDate);
        const olNode = olNodes.find(n => n.id === _olFocusId);
        if (olNode && olNode.projTag) {
          list.push({
            id: 'note-to-grid', icon: '🗂',
            label: 'グリッドへジャンプ（ノート→グリッド）',
            romaji: 'grid jump', key: 'Alt+Enter',
            fn: () => jumpToGridFromNote()
          });
        }
      }

      return list;
    }

    function openCmdPalette() {
      _cmdActive = 0;
      $('cmd-inp').value = '';
      cmdSearch();
      $('cmd-bg').classList.add('open');
      setTimeout(() => $('cmd-inp').focus(), 30);
    }
    function closeCmdPalette() {
      $('cmd-bg').classList.remove('open');
    }

    // 簡易的なローマ字→ひらがな変換（検索ヒット向上用）
    function _toHiragana(src) {
      if (!src) return "";
      const map = {
        'a':'あ','i':'い','u':'う','e':'え','o':'お',
        'ka':'か','ki':'き','ku':'く','ke':'け','ko':'こ',
        'sa':'さ','shi':'し','su':'す','se':'せ','so':'そ',
        'ta':'た','chi':'ち','tsu':'つ','te':'て','to':'と',
        'na':'な','ni':'に','nu':'ぬ','ne':'ね','no':'の',
        'ha':'は','hi':'ひ','fu':'ふ','he':'へ','ho':'ほ',
        'ma':'ま','mi':'み','mu':'む','me':'め','mo':'も',
        'ya':'や','yu':'ゆ','yo':'よ',
        'ra':'ら','ri':'り','ru':'る','re':'れ','ro':'ろ',
        'wa':'わ','wo':'を','nn':'ん',
        'ga':'が','gi':'ぎ','gu':'ぐ','ge':'げ','go':'ご',
        'za':'ざ','ji':'じ','zu':'ず','ze':'ぜ','zo':'ぞ',
        'da':'だ','di':'ぢ','du':'づ','de':'で','do':'ど',
        'ba':'ば','bi':'び','bu':'ぶ','be':'べ','bo':'ぼ',
        'pa':'ぱ','pi':'ぴ','pu':'ぷ','pe':'ぺ','po':'ぽ',
        'kyu':'きゅう','kyo':'きょう','sha':'しゃ','shu':'しゅ','sho':'しょ',
        'cha':'ちゃ','chu':'ちゅう','cho':'ちょう'
      };
      let res = src.toLowerCase(), out = "";
      for (let i = 0; i < res.length; i++) {
        let matched = false;
        for (let len = 3; len >= 1; len--) {
          const chunk = res.substring(i, i + len);
          if (map[chunk]) { out += map[chunk]; i += len - 1; matched = true; break; }
        }
        if (!matched) out += res[i];
      }
      return out;
    }

    let _prevCmdQ = "";
    function cmdSearch() {
      const q = ($('cmd-inp').value || '').trim().toLowerCase();
      // 検索ワードが変わった場合のみ選択インデックスをリセット
      if (q !== _prevCmdQ) {
        _cmdActive = 0;
        _prevCmdQ = q;
      }
      const hiraQ = _toHiragana(q);
      const allItems = _buildCmdList();
      const items = allItems.filter(c => {
        if (!q) return true;
        const lowL = c.label.toLowerCase();
        return lowL.includes(q) 
            || lowL.includes(hiraQ) // ひらがな変換後でヒットさせる
            || (c.romaji && c.romaji.toLowerCase().includes(q))
            || (c.key && c.key.toLowerCase().includes(q));
      });
      renderCmdList(items);
    }
    function cmdKey(ev) {
      const items = $('cmd-list')._items || [];
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        _cmdActive = Math.min(_cmdActive + 1, (items.length || 1) - 1);
        renderCmdList(items); return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        _cmdActive = Math.max(_cmdActive - 1, 0);
        renderCmdList(items); return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (items[_cmdActive]) { 
          const fn = items[_cmdActive].fn;
          closeCmdPalette(); 
          if (fn) fn(); 
        }
        return;
      }
      if (ev.key === 'Escape') { closeCmdPalette(); return; }
    }

    function renderCmdList(items) {
      let h = '';
      if (!items.length) { h = '<div id="cmd-empty">一致する機能が見つかりません</div>'; }
      else {
        items.forEach((c, i) => {
          h += `<div class="cmd-item${i === _cmdActive ? ' active' : ''}" data-idx="${i}" onmousedown="event.preventDefault()" onclick="cmdExecItem(${i})">`;
          h += `<span class="cmd-icon">${c.icon}</span>`;
          h += `<div class="cmd-info">`;
          h += `  <span class="cmd-label">${c.label}</span>`;
          if (c.romaji) h += `  <span class="cmd-romaji">${c.romaji}</span>`;
          h += `</div>`;
          if (c.key) h += `<span class="cmd-key">${c.key}</span>`;
          h += `</div>`;
        });
      }
      $('cmd-list').innerHTML = h;
      // アクティブ行にスクロール
      const active = $('cmd-list').querySelector('.cmd-item.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
      $('cmd-list')._items = items;
    }
    function cmdExecItem(i) {
      const items = $('cmd-list')._items || [];
      closeCmdPalette();
      if (items[i]) items[i].fn();
    }

    /* ── PANEL (right) ── */
    function markDirty() { panelDirty = true; $('unsaved-bar').classList.add('show') }
    function clearDirty() { panelDirty = false; $('unsaved-bar').classList.remove('show') }

    function openPanel(pi, wk, ei) {
      const isProj = wk === 'proj' || wk === null;
      if (isProj) wk = 'proj';
      pCtx = { pi, wk, ei, proj: isProj }; clearDirty();
      const isNew = ei === null;
      let n;
      if (isNew) {
        n = { id: '', type: 'todo', text: '', note: '', url: '', images: [], priority: '', tags: [], start: '', due: '', isTodo: true, checked: false };
      } else {
        const found = findNodeById(ei);
        n = found ? found.node : null;
      }
      if (!n && !isNew) return; // node not found
      $('ptitle').textContent = isProj ? (isNew ? 'プロジェクト項目の追加' : 'プロジェクト項目の詳細') : (isNew ? '新規追加' : '詳細');
      const saved = parseInt(localStorage.getItem(PK_R) || '380');
      $('panel').style.width = saved + 'px';
      $('rz-right').classList.add('visible');
      buildPB(n, pi, wk, ei, isNew, isProj, false);
      setTimeout(() => { const t = $('pf-text'); if (t) t.focus() }, 60);
    }
    function openProjPanel(pi, ei) { openPanel(pi, 'proj', ei); }


    function buildPB(n, pi, wk, ei, isNew, isProj, isRec) {
      let h = '';
      h += `<label class="fl">種類</label>`;
      h += `<select class="fi" id="pf-type" onchange="pfTC();markDirty()">`;
      [{ v: 'todo', l: '☑ ToDo' }, { v: 'log', l: '📝 ログ/議事録' }, { v: 'link', l: '🔗 リンク' }].forEach(o => {
        h += `<option value="${o.v}"${n.type === o.v ? ' selected' : ''}>${o.l}</option>`;
      });
      h += `</select>`;

      h += `<label class="fl">テキスト</label>`;
      h += `<input class="fi" id="pf-text" type="text" value="${esc(n.text || '')}" oninput="markDirty()" onkeydown="pfTextKey(event)">`;

      h += `<div id="pf-url-w">`;
      h += `<label class="fl">URL（任意）</label>`;
      h += `<input class="fi" id="pf-url" type="url" value="${esc(n.url || '')}" placeholder="https://" oninput="markDirty()">`;
      h += `</div>`;

      h += `<div class="note-drop-wrap" id="note-drop-wrap">`;
      h += `<textarea class="fi" id="pf-note" placeholder="詳細メモ… ここに画像をドロップ・Ctrl+Vで貼り付け可" oninput="markDirty()" onkeydown="pfNoteKey(event)">${esc(n.note || '')}</textarea>`;
      h += `<div class="drop-hint">🖼 画像をドロップ</div>`;
      h += `</div>`;
      // ── 開始日・期限日 ──
      h += `<div style="display:flex;gap:10px;margin-bottom:10px">`;
      h += `  <div style="flex:1">`;
      h += `    <label class="fl">開始日</label>`;
      h += `    <input class="fi" id="pf-start" type="date" value="${n.start || ''}" oninput="markDirty()">`;
      h += `  </div>`;
      h += `  <div style="flex:1">`;
      h += `    <label class="fl">期限日</label>`;
      h += `    <input class="fi" id="pf-due" type="date" value="${n.due || ''}" oninput="markDirty()">`;
      h += `  </div>`;
      h += `</div>`;

      // ── スパン期間（複数週またぎ表示）──
      h += `<div style="background:var(--bg2);border:1px solid var(--bd);border-radius:var(--radius);padding:8px 10px;margin-bottom:10px">`;
      h += `  <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">`;
      h += `    <span style="font-size:11px;font-weight:700;color:var(--tx2)">📊 スパン表示（複数週またぎ）</span>`;
      h += `    <span style="font-size:10px;color:var(--tx3)">グリッドにバーとして表示されます</span>`;
      h += `  </div>`;
      h += `  <div style="display:flex;gap:10px">`;
      h += `    <div style="flex:1">`;
      h += `      <label class="fl">スパン開始</label>`;
      h += `      <input class="fi" id="pf-startDate" type="date" value="${n.startDate || ''}" oninput="markDirty()" placeholder="YYYY-MM-DD">`;
      h += `    </div>`;
      h += `    <div style="flex:1">`;
      h += `      <label class="fl">スパン終了</label>`;
      h += `      <input class="fi" id="pf-endDate" type="date" value="${n.endDate || ''}" oninput="markDirty()" placeholder="YYYY-MM-DD">`;
      h += `    </div>`;
      h += `    <div style="display:flex;align-items:flex-end;padding-bottom:2px">`;
      h += `      <button class="btn" onclick="pfClearSpan()" title="スパン設定をクリア" style="font-size:11px;padding:4px 8px">✕ クリア</button>`;
      h += `    </div>`;
      h += `  </div>`;
      h += `</div>`;

      h += `<div id="img-list">`;
      if (!isNew) {
        (n.images || []).forEach((img, ii) => {
          const id = `p-img-${ii}`;
          h += `<div class="img-wrap"><img id="${id}" src="" onclick="showFull('${img}')" title="拡大" style="opacity:0.5"><button class="img-del" onclick="delImg(${ii})">✕</button></div>`;
          // 非同期で認証済みURLをセット
          ghGetAuthBlob(img).then(url => {
            const el = $(id);
            if (el) { el.src = url; el.style.opacity = 1; }
          });
        });
      }
      h += `</div>`;
      if (!isNew) {
        h += `<label class="img-add-lbl">🖼 ファイルから追加<input type="file" accept="image/*" multiple style="display:none" onchange="addImgsFromFile(event)"></label>`;
        h += `<p style="font-size:10px;color:var(--tx3);margin-top:4px">画像追加時にJSONを自動保存します</p>`;
      } else {
        h += `<span style="font-size:11px;color:var(--tx3)">保存後に画像を追加できます</span>`;
      }

      {
        // ── 優先度セレクタ（週エントリ・プロジェクトエントリ共通） ──
        const prio = n.priority || 'none';
        h += `<label class="fl">優先度</label>`;
        h += `<div class="prio-btns" id="prio-btns">`;
        [{ v: 'none', l: 'なし' }, { v: 'low', l: '低' }, { v: 'mid', l: '中' }, { v: 'high', l: '高' }].forEach(p => {
          h += `<button class="prio-btn${prio === p.v ? ' active-' + p.v : ''}" onclick="pfSetPrio('${p.v}')" type="button">${p.l}</button>`;
        });
        h += `</div>`;
        h += `<input type="hidden" id="pf-priority" value="${prio}">`;

        // ── タグ入力 ──
        h += `<label class="fl">タグ</label>`;
        h += `<div class="tag-inp-wrap" id="pf-tag-wrap" onclick="$('pf-tag-inp').focus()">`;
        (n.tags || []).forEach((t, i) => {
          h += `<span class="tag-chip-del" data-tag="${escA(t)}">${esc(t)}<span onclick="pfDelTag(${i})">✕</span></span>`;
        });
        h += `<input id="pf-tag-inp" type="text" placeholder="タグを入力してEnter" onkeydown="pfTagKeyDown(event)" autocomplete="off">`;
        h += `</div>`;
        h += `<p style="font-size:10px;color:var(--tx3);margin-top:-6px;margin-bottom:10px">Enterで追加、クリックのX で削除</p>`;
      }

      h += `<div class="fsep"></div>`;
      if (!isProj) {
        h += `<div style="font-size:11px;color:var(--tx2);margin-bottom:10px">週: ${wkeyLabel(wk)}&nbsp;&nbsp;プロジェクト: ${esc(S.projects[pi].name)}</div>`;
        if (!isNew) h += `<button class="fbtn fbtn-postpone" onclick="postpone()">⏩ 次の週に延期</button>`;
      } else {
        h += `<div style="font-size:11px;color:var(--tx2);margin-bottom:10px">プロジェクト全体のメモ: ${esc(S.projects[pi].name)}</div>`;
      }
      h += `<button class="fbtn fbtn-save" onclick="savePanel()">${isNew ? '追加' : '保存　(Enter)'}</button>`;
      if (!isNew) h += `<button class="fbtn fbtn-del" onclick="deleteFromPanel()">削除</button>`;
      const pb = $('pb');
      pb.innerHTML = h;
      ghAuthInContainer(pb);
      pb.classList.remove('panel-enter');
      void pb.offsetWidth;
      pb.classList.add('panel-enter');
      setupImageDropZone();
    }

    function pfTC() {/* 種類変更時の処理 — URL欄は全種類で常時表示のため切替不要 */ }
    function pfTextKey(ev) { if (ev.key === 'Enter') { ev.preventDefault(); savePanel() } }
    function pfNoteKey(ev) { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); savePanel() } }

    // 優先度ボタン
    function pfSetPrio(v) {
      $('pf-priority').value = v;
      document.querySelectorAll('.prio-btn').forEach(b => {
        b.className = 'prio-btn' + (b.textContent === { none: 'なし', low: '低', mid: '中', high: '高' }[v] ? ' active-' + v : '');
      });
      // 正確にクラスを再付与
      [{ v: 'none', l: 'なし' }, { v: 'low', l: '低' }, { v: 'mid', l: '中' }, { v: 'high', l: '高' }].forEach(p => {
        document.querySelectorAll('.prio-btn').forEach(b => {
          if (b.textContent === p.l) b.className = 'prio-btn' + (v === p.v ? ' active-' + v : '');
        });
      });
      markDirty();
    }

    // タグ入力キー処理（Enter/,でタグ追加）
    function pfTagKeyDown(ev) {
      if (ev.key === 'Enter' || ev.key === ',') {
        ev.preventDefault();
        const inp = $('pf-tag-inp');
        const tag = (inp.value || '').trim().replace(/,/g, '');
        if (!tag) return;
        // 重複チェック
        const existing = Array.from(document.querySelectorAll('#pf-tag-wrap .tag-chip-del')).map(el => el.dataset.tag);
        if (existing.includes(tag)) { inp.value = ''; return; }
        const chip = document.createElement('span');
        chip.className = 'tag-chip-del'; chip.dataset.tag = tag;
        const idx = existing.length;
        chip.innerHTML = `${esc(tag)}<span onclick="this.parentElement.remove();markDirty()">✕</span>`;
        $('pf-tag-wrap').insertBefore(chip, $('pf-tag-inp'));
        inp.value = '';
        tagRecordUse(tag);
        markDirty();
      }
      if (ev.key === 'Backspace' && !ev.target.value) {
        const chips = [...$('pf-tag-wrap').querySelectorAll('.tag-chip-del')];
        if (chips.length) chips[chips.length - 1].remove();
        markDirty();
      }
    }

    // タグチップの削除
    function pfDelTag(idx) {
      const chips = [...$('pf-tag-wrap').querySelectorAll('.tag-chip-del')];
      if (chips[idx]) chips[idx].remove();
      markDirty();
    }

    // ノートへリンク（ノートペインを開いてリンクモードを開始）

    function pfClearSpan() {
      const s = $('pf-startDate'), e = $('pf-endDate');
      if (s) s.value = '';
      if (e) e.value = '';
      markDirty();
    }

    function savePanel() {
      const { pi, wk, ei, proj } = pCtx;
      const type = $('pf-type').value;
      const text = ($('pf-text').value || '').trim();
      const url = ($('pf-url') ? $('pf-url').value || '' : '').trim();
      const note = ($('pf-note').value || '').trim();
      if (!text) { $('pf-text').focus(); return }

      const priority = $('pf-priority') ? ($('pf-priority').value === 'none' ? '' : $('pf-priority').value) : '';
      const tagChips = $('pf-tag-wrap') ? [...$('pf-tag-wrap').querySelectorAll('.tag-chip-del')].map(el => el.dataset.tag) : [];
      const start     = $('pf-start')     ? ($('pf-start').value     || '') : '';
      const due       = $('pf-due')       ? ($('pf-due').value       || '') : '';
      const startDate = $('pf-startDate') ? ($('pf-startDate').value || '') : '';
      const endDate   = $('pf-endDate')   ? ($('pf-endDate').value   || '') : '';

      const projTag = S.projects[pi].name.replace(/\s+/g, '_');

      if (ei === null) {
        // New node
        let targetDate;
        if (proj) {
          targetDate = 'proj:' + pi;
        } else if (wk === wkey(new Date())) {
          targetDate = todayDateStr();
        } else {
          const mondayDate = wkeyToDate(wk);
          targetDate = mondayDate.getFullYear() + '-' + (mondayDate.getMonth() + 1) + '-' + mondayDate.getDate();
        }
        const nodes = olGetNodes(targetDate);
        nodes.push({
          id: olNewId(), text, type, isTodo: type === 'todo', checked: false,
          indent: 0, projTag, url, note, images: [], priority, tags: tagChips, start, due, startDate, endDate
        });
      } else {
        // Edit existing node
        const found = findNodeById(ei);
        if (found) {
          const n = found.node;
          Object.assign(n, { type, text, url, note, isTodo: type === 'todo', priority, tags: tagChips, start, due, startDate, endDate });
          // Update html to match text
          n.html = esc(text);
          // Refresh note panel if open
          if (_notePanelOpen && _olCurrentDate === found.date) {
            olRender('ol-container', _olCurrentDate);
          }
        }
      }

      cleanupUnusedTags(); // パネルでタグを削除した場合、未使用タグをtagMetaから除去
      clearDirty(); saveState(); render(); closePanel();
      refocusGrid();
    }

    function tryClosePanel() {
      if (panelDirty) { if (!confirm('未保存の変更があります。破棄しますか？')) return }
      clearDirty(); closePanel();
      refocusGrid();
    }
    function closePanel() {
      $('panel').style.width = '0';
      $('rz-right').classList.remove('visible');
      pCtx = null; clearDirty();
    }
    function postpone() {
      const { pi, wk, ei } = pCtx;
      const found = findNodeById(ei);
      if (!found) return;
      const n = found.node;
      const nw = wkeyNext(wk);
      const mondayDate = wkeyToDate(nw);
      const targetDate = mondayDate.getFullYear() + '-' + (mondayDate.getMonth() + 1) + '-' + mondayDate.getDate();
      const nodes = olGetNodes(targetDate);
      nodes.push({
        id: olNewId(), text: n.text, type: n.type || getNodeType(n), isTodo: n.isTodo, checked: false,
        indent: 0, projTag: n.projTag, url: n.url || '', note: n.note || '',
        images: [...(n.images || [])], priority: n.priority || '', tags: [...(n.tags || [])],
        start: n.start || '', due: n.due || ''
      });
      clearDirty(); saveState(); render(); closePanel();
      alert('次週（' + wkeyLabel(nw) + '）にも追加しました。');
      refocusGrid();
    }
    function deleteFromPanel() {
      if (!confirm('削除しますか？')) return;
      const { pi, wk, ei } = pCtx;
      const found = findNodeById(ei);
      if (!found) return;
      const nodes = S.dailyOutline[found.date];
      nodes.splice(found.idx, 1);
      cleanupUnusedTags(); // ノード削除で使用タグがなくなった場合にtagMetaから除去
      clearDirty(); saveState(); render(); closePanel();
      if (_notePanelOpen && _olCurrentDate === found.date) {
        olRender('ol-container', _olCurrentDate);
      }
      refocusGrid();
    }

    /* ── images ── */
    // pasteController: パネルを開き直すたびに前回のペーストリスナーを確実に除去する
    let _pasteController = null;

    function setupImageDropZone() {
      const wrap = $('note-drop-wrap'); const pb = $('pb');
      if (!wrap) return;

      // ドロップゾーン（wrap は buildPB のたびに新しい DOM なのでリスナー重複なし）
      wrap.addEventListener('dragenter', ev => { if ([...ev.dataTransfer.types].includes('Files')) { ev.preventDefault(); wrap.classList.add('drag-over') } });
      wrap.addEventListener('dragover', ev => { if ([...ev.dataTransfer.types].includes('Files')) ev.preventDefault() });
      wrap.addEventListener('dragleave', ev => { if (!wrap.contains(ev.relatedTarget)) wrap.classList.remove('drag-over') });
      wrap.addEventListener('drop', ev => {
        wrap.classList.remove('drag-over');
        const files = [...ev.dataTransfer.files].filter(f => f.type.startsWith('image/'));
        if (files.length) { ev.preventDefault(); addImgsFromBlobs(files) }
      });

      // ペーストは #pb（永続 DOM）に登録するため、前回のリスナーを AbortController で除去
      if (_pasteController) _pasteController.abort();
      _pasteController = new AbortController();
      pb.addEventListener('paste', ev => {
        const items = [...(ev.clipboardData?.items || [])];
        const imgs = items.filter(it => it.type.startsWith('image/'));
        if (!imgs.length) return;
        ev.preventDefault();
        addImgsFromBlobs(imgs.map(it => it.getAsFile()).filter(Boolean));
      }, { signal: _pasteController.signal });
    }
    const IMG_MAX_BYTES = 2 * 1024 * 1024; // 2MB per image
    async function addImgsFromBlobs(files) {
      if (!pCtx || pCtx.ei === null) return;
      const { pi, wk, ei, proj } = pCtx;
      let node;
      if (proj) {
        const projNodes = olGetNodes('proj:' + pi);
        node = projNodes.find(n => n.id === ei);
      } else {
        const found = findNodeById(ei);
        node = found ? found.node : null;
      }
      if (!node) return;

      // GitHub設定チェック（未設定なら案内して終了）
      const { token, repo } = ghGetSettings();
      if (!token || !repo) {
        showToast('❌ 画像はGitHubへアップロードされます。設定パネルでGitHubトークンとリポジトリを設定してください。', true);
        return;
      }

      if (!node.images) node.images = [];
      let done = 0;
      const total = files.length;
      showToast('⏳ GitHubへアップロード中...');

      for (const f of files) {
        if (f.size > IMG_MAX_BYTES) {
          showToast('❌ 画像が大きすぎます（上限2MB）: ' + (f.name || 'image') + ' (' + (f.size / 1024 / 1024).toFixed(1) + 'MB)');
          done++;
        } else {
          try {
            const url = await ghUploadImage(f);
            node.images.push(url);
            done++;
            showToast(`⏳ アップロード中... (${done}/${total})`);
          } catch (err) {
            showToast('❌ アップロード失敗: ' + err.message, true);
            done++;
          }
        }
        if (done === total) {
          saveState(); triggerAutoSave();
          if (proj) openProjPanel(pi, ei); else openPanel(pi, wk, ei);
          showToast('✓ 画像をGitHubへアップロードしました');
        }
      }
    }
    function addImgsFromFile(ev) { addImgsFromBlobs(Array.from(ev.target.files)) }
    function delImg(ii) {
      const { pi, wk, ei, proj } = pCtx;
      let node;
      if (proj) {
        const projNodes = olGetNodes('proj:' + pi);
        node = projNodes.find(n => n.id === ei);
      } else {
        const found = findNodeById(ei);
        node = found ? found.node : null;
      }
      if (!node || !node.images) return;
      node.images.splice(ii, 1); saveState();
      if (proj) openProjPanel(pi, ei); else openPanel(pi, wk, ei);
    }
    /* ── images ── */
    const _imgBlobCache = new Map(); // url -> {url, time}

    async function ghGetAuthBlob(url, forceFetch = false) {
      if (!url) return url;
      // トークンがあれば削除してベースURLをキャッシュキーにする
      let stableUrl = url.split('?token=')[0];

      // すでに blob: などの場合はスキップ
      if (stableUrl.startsWith('blob:') || stableUrl.startsWith('data:')) return url;
      
      // キャッシュにあり、かつ有効期限内（4分以内）ならそれを返す
      if (!forceFetch && _imgBlobCache.has(stableUrl)) {
        const ent = _imgBlobCache.get(stableUrl);
        if (Date.now() - ent.time < 240000) return ent.url;
      }

      const { token, repo: configRepo } = ghGetSettings();
      if (!token) return url;

      let repo = configRepo;
      let path = stableUrl;
      let branch = '';

      // URLからリポジトリ情報を抽出 (raw.githubusercontent.com/{owner}/{repo}/{branch}/{path})
      const m = stableUrl.match(/raw\.githubusercontent\.com\/([^\/]+\/[^\/]+)\/([^\/]+)\/(.+)$/);
      if (m) {
        repo = m[1]; branch = m[2]; path = m[3];
      } else if (stableUrl.startsWith('images/')) {
        path = stableUrl;
      } else {
        return url;
      }

      try {
        // APIを使用して一時トークン付きの download_url を取得
        const apiTarget = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
        const res = await fetch(apiTarget + (branch ? `?ref=${branch}` : ''), {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.download_url) {
            _imgBlobCache.set(stableUrl, { url: data.download_url, time: Date.now() });
            return data.download_url;
          }
        }
      } catch (e) {
        console.error('GitHub API Image Metadata fetch failed (' + path + '):', e);
      }
      return url;
    }

    // 文字列内の画像をキャッシュ済みトークンURLで置換する
    function _olPreTokenize(html) {
      if (!html || (!html.includes('raw.githubusercontent.com') && !html.includes('images/'))) return html;
      _imgBlobCache.forEach((ent, stable) => {
        if (ent && Date.now() - ent.time < 240000) {
          const targetUrl = ent.blobUrl || ent.url;
          if (targetUrl) html = html.split(stable).join(targetUrl);
        }
      });
      return html;
    }

    async function showFull(src) {
      const authUrl = await ghGetAuthBlob(src);
      $('img-full-img').src = authUrl;
      $('img-full').classList.add('open');
    }

    async function ghAuthInContainer(container) {
      if (!container) return;
      const imgs = container.querySelectorAll('img');
      if (imgs.length === 0) return;
      console.debug('ghAuthInContainer: processing', imgs.length, 'images');
      const tasks = [];
      for (const img of imgs) {
        const os = img.getAttribute('src');
        if (os && !os.startsWith('blob:') && !os.startsWith('data:')) {
          tasks.push(ghLoadAndSetBlob(img, os));
        }
      }
      if (tasks.length) await Promise.all(tasks);
    }

    async function ghLoadAndSetBlob(img, originalUrl) {
      const stableUrl = originalUrl.split('?token=')[0];
      
      // キャッシュチェック（有効な Blob URL があれば即座に適用）
      if (_imgBlobCache.has(stableUrl)) {
        const ent = _imgBlobCache.get(stableUrl);
        if (ent.blobUrl && Date.now() - ent.time < 600000) { // 有効期限を10分に延長
          if (img.src !== ent.blobUrl) img.src = ent.blobUrl;
          return;
        }
      }

      const { token, repo: configRepo } = ghGetSettings();
      if (!token) return;

      // URLから情報を抽出
      let repo = configRepo, branch = 'main', path = '';
      const m = stableUrl.match(/raw\.githubusercontent\.com\/([^\/]+\/[^\/]+)\/([^\/]+)\/(.+)$/);
      if (m) {
        repo = m[1]; branch = m[2]; path = m[3];
      } else if (stableUrl.startsWith('images/')) {
        path = stableUrl;
      } else {
        return;
      }

      try {
        console.debug('Fetching direct RAW binary from API:', path);
        const apiTarget = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
        const res = await fetch(apiTarget + (branch ? `?ref=${branch}` : ''), {
          headers: { 
            Authorization: `Bearer ${token}`, 
            Accept: 'application/vnd.github.v3.raw' 
          }
        });
        
        if (!res.ok) throw new Error('API RAW Fetch failed: ' + res.status);
        
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        // キャッシュ更新
        const prev = _imgBlobCache.get(stableUrl);
        if (prev && prev.blobUrl) try { URL.revokeObjectURL(prev.blobUrl); } catch(e){}
        _imgBlobCache.set(stableUrl, { url: originalUrl, blobUrl: blobUrl, time: Date.now() });
        
        img.src = blobUrl;
      } catch (e) {
        console.warn('Direct API load failed, falling back to tokenized URL:', e.message);
        const authUrl = await ghGetAuthBlob(originalUrl);
        if (authUrl && img.src !== authUrl) img.src = authUrl;
      }
    }

    // 接続テスト
    async function ghDiagConnection() {
      const { token, repo } = ghGetSettings();
      if (!token || !repo) { console.warn('[Diag] Token or repo missing'); return; }
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}`, { 
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) console.info('[Diag] API Connection Successful');
        else console.error('[Diag] API Connection Failed: ' + res.status);
      } catch (e) { console.error('[Diag] API Connection Error:', e); }
    }
    setTimeout(ghDiagConnection, 1000);


    /* ── resize ── */
    function startResize(ev, side) {
      ev.preventDefault();
      const handleId = side === 'right' ? 'rz-right' : side === 'note' ? 'rz-note' : 'rz-left';
      const handle = $(handleId);
      handle.classList.add('dragging');
      const panel = $(side === 'right' ? 'panel' : side === 'note' ? 'note-panel' : 'todo-panel');
      const startX = ev.clientX, startW = panel.offsetWidth;
      function onMove(e) {
        const delta = (side === 'right' || side === 'note') ? (startX - e.clientX) : (e.clientX - startX);
        const newW = Math.max(180, Math.min(window.innerWidth * 0.55, startW + delta));
        panel.style.width = newW + 'px';
        if (side === 'left') { const s = $('todo-panel').style; s.setProperty('--panel-left', newW + 'px') }
      }
      function onUp() {
        handle.classList.remove('dragging');
        if (side === 'right') localStorage.setItem(PK_R, $('panel').offsetWidth);
        else if (side === 'note') localStorage.setItem('pwt_np_w', $('note-panel').offsetWidth);
        else localStorage.setItem(PK_L, $('todo-panel').offsetWidth);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    /* ── todo left panel ── */
    function toggleTodoShowAll() {
      _todoShowAll = !_todoShowAll;
      const btn = $('todo-all-btn');
      if (btn) btn.classList.toggle('active', _todoShowAll);
      if (!todoOpen) toggleTodoPanel();
      else renderTodo();
    }

    function toggleTodoPanel() {
      todoOpen = !todoOpen;
      $('tv-btn').classList.toggle('btn-active', todoOpen);
      $('todo-panel').classList.toggle('open', todoOpen);
      $('rz-left').classList.toggle('visible', todoOpen);
      if (todoOpen) renderTodo();
    }
    let _todoShowAll = false; // false=プロジェクト付きのみ / true=全タスク

    function renderTodo() {
      const today = getMonday(new Date());
      let grouped = {};

      // Phase 2: getAllNodes() で全日付横断
      const allNodes = getAllNodes({ includeProj: true });
      allNodes.forEach(({ node: n, date }) => {
        if (getNodeType(n) !== 'todo' || n.checked) return;
        if (!_todoShowAll && !n.projTag) return; // プロジェクト付きモードはプロジェクト必須

        const projIdx = n.projTag
          ? S.projects.findIndex(p => p.name.replace(/\s+/g, '_') === n.projTag)
          : -1;
        const proj = projIdx >= 0 ? S.projects[projIdx] : null;
        if (!_todoShowAll && !proj) return;

        let wk;
        if (date.startsWith('proj:')) {
          wk = 'proj';
        } else {
          try { wk = wkey(new Date(date.replace(/-/g, '/'))); } catch(e) { return; }
        }

        if (!grouped[wk]) grouped[wk] = [];
        grouped[wk].push({ proj, pi: projIdx, wk, nodeId: n.id, n, date });
      });

      const keys = Object.keys(grouped).filter(k => k !== 'proj').sort();
      if (grouped['proj']) keys.unshift('proj');

      let h = '';
      if (!keys.length) { h = `<p style="font-size:12px;color:var(--tx3);padding:8px 4px">未完了のToDoはありません 🎉</p>`; }
      keys.forEach(wk => {
        const isPast = wk !== 'proj' && wkeyToDate(wk) < today;
        const label = wk === 'proj' ? 'プロジェクトメモ' : wkeyLabel(wk);
        h += `<div class="tv-group">`;
        const pastCls = isPast ? ' past' : '';
        const pastIcon = isPast ? '⚠ ' : '';
        h += `<div class="tv-group-head${pastCls}">${pastIcon}${label}</div>`;
        grouped[wk].forEach(({ proj, pi, wk: w, nodeId, n }) => {
          const onclk = wk === 'proj' ? `openPanel(${pi},'proj','${nodeId}')` : `jumpTo(${pi},'${w}','${nodeId}')`;
          h += `<div class="tv-item" onclick="${onclk}">`;
          h += `<input type="checkbox" class="cb" onclick="event.stopPropagation();tvCheck('${nodeId}')">`;
          h += `<div><span>${esc(n.text)}</span><span class="tv-proj">${esc(proj.name)}</span></div>`;
          h += `</div>`;
        });
        h += `</div>`;
      });
      $('todo-body').innerHTML = h;
    }
    function tvCheck(nodeId) {
      const found = findNodeById(nodeId);
      if (!found) return;
      found.node.checked = !found.node.checked;
      saveState(); render();
      if (todoOpen) renderTodo();
      if (_notePanelOpen && _olCurrentDate === found.date) {
        olRender('ol-container', found.date);
      }
    }
    function tvCheckDaily(dateStr, nodeId) {
      if (!S.dailyOutline || !S.dailyOutline[dateStr]) return;
      const nodes = S.dailyOutline[dateStr];
      const n = nodes.find(x => x.id === nodeId);
      if (n) {
        n.checked = !n.checked;
        saveState(); render();
        if (todoOpen) renderTodo();
        if (typeof _notePanelOpen !== 'undefined' && _notePanelOpen && typeof _olCurrentDate !== 'undefined' && _olCurrentDate === dateStr) {
          olRender('ol-container', dateStr);
        }
      }
    }
    function openNotePanelToDate(dateStr, id) {
      // 閲覧履歴に記録
      _notePush(dateStr, id || null);
      // 対象ノードが折りたたまれた祖先の下にある場合、祖先を展開してから開く
      if (id) {
        const nodes = olGetNodes(dateStr);
        const targetIdx = nodes.findIndex(n => n.id === id);
        if (targetIdx > 0) {
          let changed = false;
          let lookFor  = nodes[targetIdx].indent - 1; // 探す祖先のインデントレベル
          let bound    = targetIdx - 1;               // 検索上限
          // インデントを1段ずつ遡って直接の祖先チェーンを展開
          while (lookFor >= 0) {
            let found = false;
            for (let i = bound; i >= 0; i--) {
              if (nodes[i].indent === lookFor) {
                if (nodes[i].collapsed) { nodes[i].collapsed = false; changed = true; }
                bound   = i - 1;
                lookFor--;
                found   = true;
                break;
              }
            }
            if (!found) break;
          }
          if (changed) saveState();
        }
      }

      if (typeof _notePanelOpen === 'undefined' || !_notePanelOpen) toggleNotePanel(dateStr);
      else {
        _olCurrentDate = dateStr;
        if (typeof updateOlNav === 'function') updateOlNav();
        olRender('ol-container', dateStr);
      }
      if (id) {
        setTimeout(() => {
          _olFocusId = id;
          const el = document.getElementById('olt-' + id);
          if (el) el.focus();
        }, 100);
      }
    }
    // ノートの現在フォーカスノード → グリッドアイテムへジャンプ
    function jumpToGridFromNote() {
      if (!_olFocusId || !_olCurrentDate) {
        showToast('ノードを選択してください'); return;
      }
      const nodes = olGetNodes(_olCurrentDate);
      const n = nodes.find(x => x.id === _olFocusId);
      if (!n || !n.projTag) {
        showToast('このノードにはプロジェクトタグがありません（「@」メニューで設定してください）'); return;
      }
      const pi = S.projects.findIndex(p => p.name.replace(/\s+/g, '_') === n.projTag);
      if (pi < 0) { showToast('対応するプロジェクトが見つかりません'); return; }

      // 対応する週を特定（proj: 日付なら project 列、それ以外は日付の週）
      let wk;
      if (_olCurrentDate.startsWith('proj:')) {
        wk = 'proj';
      } else {
        try { wk = wkey(new Date(_olCurrentDate.replace(/-/g, '/'))); } catch(e) { wk = wkey(new Date()); }
      }

      // 表示週がずれていれば wOff を調整してから render
      const weeks = getWeeks().map(w => wkey(w));
      let needsRender = false;
      if (wk !== 'proj' && !weeks.includes(wk)) {
        const target = wkeyToDate(wk), base = getMonday(new Date());
        S.wOff = Math.round((target - base) / (7 * 24 * 3600 * 1000));
        saveState();
        needsRender = true;
      }

      // プロジェクト行が折りたたまれている場合は展開する
      if (S.projects[pi].collapsed) {
        S.projects[pi].collapsed = false;
        saveState();
        needsRender = true;
      }
      // 圧縮モードで折りたたまれている場合も展開する
      if (_compactMode && !_compactExpanded.has(pi)) {
        _compactExpanded.add(pi);
        needsRender = true;
      }
      // 対象ノードが子アイテム（gridCollapsed された親の下）にある場合、親を展開する
      {
        const treeItems = getTreeOrderedItems(pi, wk);
        const myTreeItem = treeItems.find(i => i.node.id === n.id);
        if (myTreeItem && myTreeItem.isChild) {
          const parentFound = findNodeById(myTreeItem.node.parentId);
          if (parentFound && parentFound.node.gridCollapsed) {
            parentFound.node.gridCollapsed = false;
            saveState();
            needsRender = true;
          }
        }
      }
      if (needsRender) render();

      // グリッドアイテムにフォーカス
      setTimeout(() => {
        applyFocus(pi, wk, n.id);
        showToast('🗂 グリッドへ移動しました');
      }, needsRender ? 80 : 0);
    }

    function jumpTo(pi, wk, ei) {
      // ei is now nodeId (string)
      const weeks = getWeeks().map(w => wkey(w));
      if (!weeks.includes(wk)) {
        const target = wkeyToDate(wk), base = getMonday(new Date());
        S.wOff = Math.round((target - base) / (7 * 24 * 3600 * 1000));
      }
      // プロジェクト行・子アイテム親の折りたたみを解除してからレンダリング
      let needsRender2 = false;
      if (S.projects[pi] && S.projects[pi].collapsed) {
        S.projects[pi].collapsed = false;
        saveState();
        needsRender2 = true;
      }
      {
        const treeItems = getTreeOrderedItems(pi, wk);
        const myItem = treeItems.find(i => i.node.id === ei);
        if (myItem && myItem.isChild) {
          const parentFound = findNodeById(myItem.node.parentId);
          if (parentFound && parentFound.node.gridCollapsed) {
            parentFound.node.gridCollapsed = false;
            saveState();
            needsRender2 = true;
          }
        }
      }
      focusKey = fkey(pi, wk, ei);
      render();
      setTimeout(() => openPanel(pi, wk, ei), needsRender2 ? 80 : 50);
    }

    /* ── project ops ── */
    function toggleProjEntries(pi) {
      S.projects[pi].projEntriesOpen = !S.projects[pi].projEntriesOpen;
      saveState(); render();
    }
    function quickAdd(pi, wk, inp) {
      const txt = inp.value.trim(); if (!txt) return;
      const p = S.projects[pi];
      const projTag = p.name.replace(/\s+/g, '_');

      // Determine target date for the node
      let targetDate;
      if (wk === 'proj') {
        targetDate = 'proj:' + pi;
      } else if (wk === wkey(new Date())) {
        targetDate = todayDateStr(); // current week → today
      } else {
        const mondayDate = wkeyToDate(wk);
        targetDate = mondayDate.getFullYear() + '-' + (mondayDate.getMonth() + 1) + '-' + mondayDate.getDate();
      }

      const nodes = olGetNodes(targetDate);
      const nodeId = olNewId();
      nodes.push({
        id: nodeId, text: txt, indent: 0, isTodo: true, checked: false,
        type: 'todo', projTag: projTag,
        url: '', note: '', images: [], priority: '', tags: [], start: '', due: '', startDate: '', endDate: ''
      });

      saveState();
      render();
      // Note panel refresh if open
      if (_notePanelOpen && _olCurrentDate === targetDate) {
        olRender('ol-container', _olCurrentDate);
      }
      inp.value = '';
    }
    function toggleTodo(pi, wk, ei, displayWk) {
      // ei is now nodeId
      // displayWk: ミラーアイテムの場合は表示上の週(currentWk)を渡してフォーカスを維持
      const found = findNodeById(ei);
      if (!found) return;
      found.node.checked = !found.node.checked;
      focusKey = fkey(pi, displayWk || wk, ei);
      saveState(); render(); if (todoOpen) renderTodo();
      // Refresh note panel
      if (_notePanelOpen && _olCurrentDate === found.date) {
        olRender('ol-container', found.date);
      }
    }
    function toggleProjTodo(pi, ei) { toggleTodo(pi, 'proj', ei); }
    function deleteE(pi, wk, ei) {
      if (!confirm('削除しますか？')) return;
      // ei is now nodeId
      const found = findNodeById(ei);
      if (!found) return;
      const nodes = S.dailyOutline[found.date];
      // アウトラインの子ノード（同日付・より深いインデント）ごと削除
      const subtreeCount = olGetSubtree(nodes, found.idx);
      nodes.splice(found.idx, subtreeCount);
      // parentId でリンクされた子ノードを再帰的に削除（子の子も含む）
      const deleteLinkedChildren = (parentId) => {
        if (!S.dailyOutline) return;
        for (const d in S.dailyOutline) {
          const dn = S.dailyOutline[d];
          if (!Array.isArray(dn)) continue;
          for (let i = dn.length - 1; i >= 0; i--) {
            if (dn[i].parentId === parentId) {
              const childId = dn[i].id;
              deleteLinkedChildren(childId); // 孫ノード以降も再帰削除
              const childSubtree = olGetSubtree(dn, i);
              dn.splice(i, childSubtree);
            }
          }
        }
      };
      deleteLinkedChildren(ei);
      saveState(); render();
      if (_notePanelOpen && _olCurrentDate === found.date) {
        olRender('ol-container', found.date);
      }
    }
    function deleteProjE(pi, ei) { deleteE(pi, 'proj', ei); }
    function addProj() { const n = prompt('プロジェクト名:'); if (!n) return; S.projects.push({ name: n, collapsed: false, projEntriesOpen: false, links: [], isPrivate: false }); saveState(); render() }
    function addProjFromInput(inp) { const n = inp.value.trim(); if (!n) return; S.projects.push({ name: n, collapsed: false, projEntriesOpen: false, links: [], isPrivate: false }); inp.value = ''; saveState(); render() }
    function deleteProj(pi) { if (confirm('「' + S.projects[pi].name + '」を削除しますか？')) { S.projects.splice(pi, 1); saveState(); render() } }
    function startRename(pi, el) {
      const inp = document.createElement('input'); inp.className = 'rename-inp'; inp.value = S.projects[pi].name;
      el.replaceWith(inp); inp.focus(); inp.select();
      const done = () => { const v = inp.value.trim(); if (v) S.projects[pi].name = v; saveState(); render() };
      inp.onblur = done; inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { saveState(); render() } };
    }

    // v1.2.3: プロジェクト名のシングルクリック→ノート、ダブルクリック→リネーム
    // 200ms 待って click を遅延発火させ、その間に dblclick が来れば click をキャンセル
    let _projNameClickTimer = null;
    function projNameClick(pi) {
      if (_projNameClickTimer) { clearTimeout(_projNameClickTimer); }
      _projNameClickTimer = setTimeout(() => {
        _projNameClickTimer = null;
        toggleNotePanel('proj:' + pi);
      }, 200);
    }
    function projNameDblClick(pi, el) {
      if (_projNameClickTimer) { clearTimeout(_projNameClickTimer); _projNameClickTimer = null; }
      startRename(pi, el);
    }

    function toggleProjPrivate(pi) {
      S.projects[pi].isPrivate = !S.projects[pi].isPrivate;
      saveState(); render();
    }
    function toggleViewMode() {
      // 全表示 → お仕事 → プライベート → 全表示 の順循環
      _viewMode = _viewMode === 'all' ? 'work' : _viewMode === 'work' ? 'private' : 'all';
      render();
      // ノートも実表示状態で再描画
      if (_olCurrentDate) olRender('ol-container', _olCurrentDate);
    }

    /* ── drag ── */
    function pDragStart(ev, pi) { dragProjIdx = pi; ev.dataTransfer.effectAllowed = 'move' }
    function pDragOver(ev, pi) { if (dragProjIdx !== null && dragProjIdx !== pi) ev.preventDefault() }
    function pDrop(ev, pi) { ev.preventDefault(); if (dragProjIdx === null || dragProjIdx === pi) { dragProjIdx = null; return } const [m] = S.projects.splice(dragProjIdx, 1); S.projects.splice(pi, 0, m); dragProjIdx = null; saveState(); render() }
    function eDragStart(ev, pi, wk, ei) {
      dragECtx = { pi, wk, ei }; // ei is now nodeId
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', ''); // Safari/Firefox 対応
      ev.stopPropagation();
    }
    function eDragOver(ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move' }
    function eDrop(ev, tpi, twk) {
      ev.preventDefault(); if (!dragECtx) return;
      const { pi, wk, ei } = dragECtx; dragECtx = null; // ei is nodeId
      const found = findNodeById(ei);
      if (!found) return;
      const node = found.node;

      // Update projTag to target project
      const tProjTag = S.projects[tpi].name.replace(/\s+/g, '_');
      node.projTag = tProjTag;

      // If moving between weeks (or between proj/week), move the node to the new date
      if (twk !== wk || pi !== tpi) {
        let targetDate;
        if (twk === 'proj') {
          targetDate = 'proj:' + tpi;
        } else {
          // If target week is current week, keep on same date or use today
          // Otherwise move to Monday of target week
          if (found.date && !found.date.startsWith('proj:') && wk === twk) {
            targetDate = found.date; // same week, just changing project
          } else if (twk === wkey(new Date())) {
            targetDate = todayDateStr();
          } else {
            const mondayDate = wkeyToDate(twk);
            targetDate = mondayDate.getFullYear() + '-' + (mondayDate.getMonth() + 1) + '-' + mondayDate.getDate();
          }
        }

        if (targetDate !== found.date) {
          // Remove from old location
          const oldNodes = S.dailyOutline[found.date];
          const oldIdx = oldNodes.findIndex(n => n.id === ei);
          if (oldIdx >= 0) oldNodes.splice(oldIdx, 1);
          // Add to new location
          const newNodes = olGetNodes(targetDate);
          newNodes.push(node);
        }

        if (pi !== tpi) {
          showToast('🏷️ ' + S.projects[pi].name + ' → ' + S.projects[tpi].name + ' に移動しました');
        }
      }

      saveState(); render();
      if (_olCurrentDate) olRender('ol-container', _olCurrentDate);
    }

    // アイテム上へのドロップ（セル内並び替え + セル間移動）
    function eDropOnItem(ev, tpi, twk, tei) {
      ev.preventDefault(); ev.stopPropagation();
      if (!dragECtx) return;
      const { pi, wk, ei } = dragECtx; dragECtx = null;
      if (ei === tei) return;

      const found = findNodeById(ei);
      const tFound = findNodeById(tei);
      if (!found || !tFound) return;

      // projTag を更新
      const tProjTag = S.projects[tpi].name.replace(/\s+/g, '_');
      found.node.projTag = tProjTag;

      // 移動先の日付を決定
      let targetDate;
      if (twk === 'proj') {
        targetDate = 'proj:' + tpi;
      } else {
        targetDate = tFound.date;
      }

      // 元の位置から削除
      const oldNodes = S.dailyOutline[found.date];
      const oldIdx = oldNodes ? oldNodes.findIndex(n => n.id === ei) : -1;
      if (oldIdx >= 0) oldNodes.splice(oldIdx, 1);

      // 挿入位置を計算（削除後のインデックスずれを補正）
      const newNodes = olGetNodes(targetDate);
      let tgtIdx = newNodes.findIndex(n => n.id === tei);
      if (tgtIdx < 0) tgtIdx = newNodes.length;
      else if (found.date === targetDate && oldIdx >= 0 && oldIdx < tgtIdx) tgtIdx--;
      newNodes.splice(tgtIdx, 0, found.node);

      if (pi !== tpi) {
        showToast('🏷️ ' + S.projects[pi].name + ' → ' + S.projects[tpi].name + ' に移動しました');
      } else {
        showHint('↕ 並び替えました');
      }

      saveState(); render();
      if (_olCurrentDate) olRender('ol-container', _olCurrentDate);
      requestAnimationFrame(() => applyFocus(tpi, twk, ei));
    }

    /* ================================================================
       設定モーダル & GitHub 同期
    ================================================================ */
    const GH_TOKEN_SK = 'pwt_gh_token';
    const GH_REPO_SK = 'pwt_gh_repo';
    const GH_FILE_SK = 'pwt_gh_file';
    const GH_ENABLED_SK = 'pwt_gh_enabled';
    const GH_SHA_SK = 'pwt_gh_sha';

    function openSettings() {
      $('settings-modal').classList.add('open');
      if ($('app-ver-disp')) $('app-ver-disp').textContent = 'Version ' + APP_VERSION;
      if ($('header-ver-disp')) $('header-ver-disp').textContent = APP_VERSION;

      const g = ghGetSettings();
      $('gh-repo-s').value = g.repo;
      $('gh-file-s').value = g.file;
      $('gh-enabled-s').checked = g.enabled;

      const tok = localStorage.getItem(GH_TOKEN_SK);
      $('gh-token-s').value = tok ? '●'.repeat(20) : '';
      $('gh-token-s').dataset.saved = tok ? '1' : '';

      const sha = localStorage.getItem(GH_SHA_SK);
      if (sha) ghStatus('最終同期 SHA: ' + sha.slice(0, 7) + '…');

      // テーマの設定
      const theme = localStorage.getItem('pwt_theme') || 'auto';
      if ($('theme-s')) $('theme-s').value = theme;
    }

    function closeSettings() {
      $('settings-modal').classList.remove('open');
    }

    function saveSettingsAndClose() {
      const gRepo = $('gh-repo-s').value.trim();
      const gFile = $('gh-file-s').value.trim() || 'data.json';
      const gEnabled = $('gh-enabled-s').checked;

      localStorage.setItem(GH_REPO_SK, gRepo);
      localStorage.setItem(GH_FILE_SK, gFile);
      localStorage.setItem(GH_ENABLED_SK, gEnabled ? '1' : '0');

      const tokEl = $('gh-token-s');
      const mask = '●'.repeat(20);
      if (tokEl.value !== mask) {
        const v = tokEl.value.trim();
        if (v) localStorage.setItem(GH_TOKEN_SK, v);
        else if (tokEl.value === '') localStorage.removeItem(GH_TOKEN_SK);
      }

      // テーマの保存
      const theme = $('theme-s').value;
      localStorage.setItem('pwt_theme', theme);
      applyTheme(theme);

      ghStatus(gEnabled ? '同期有効' : '同期無効');
      const badge = $('gh-sync-badge');
      if (badge) badge.style.display = gEnabled ? 'inline' : 'none';

      closeSettings();
      showToast('⚙️ 設定を保存しました');
    }

    function applyTheme(theme) {
      document.documentElement.classList.remove('dark-theme', 'light-theme');
      if (theme === 'dark') {
        document.documentElement.classList.add('dark-theme');
      } else if (theme === 'light') {
        document.documentElement.classList.add('light-theme');
      }
      // auto の場合はクラスを付与せず @media に任せる
    }

    let _ghSyncing = false;

    function ghGetSettings() {
      return {
        token: localStorage.getItem(GH_TOKEN_SK) || '',
        repo: localStorage.getItem(GH_REPO_SK) || '',
        file: localStorage.getItem(GH_FILE_SK) || 'data.json',
        enabled: localStorage.getItem(GH_ENABLED_SK) === '1',
      };
    }

    function ghStatus(msg, isErr = false) {
      const el = $('gh-status');
      if (el) { el.textContent = msg; el.style.color = isErr ? '#d9534f' : 'var(--tx3)'; }
      // ツールバーのバッジにも反映（有効時のみ表示）
      const badge = $('gh-sync-badge');
      if (badge && ghGetSettings().enabled) {
        badge.style.display = 'inline';
        badge.textContent = msg;
        badge.style.color = isErr ? '#d9534f' : 'var(--tx3)';
      }
    }

    function toggleGhSettings() {
      const el = $('gh-settings');
      const tog = el.previousElementSibling;
      const opening = el.style.display === 'none';
      el.style.display = opening ? 'block' : 'none';
      tog.textContent = (opening ? '▼' : '▶') + ' GitHub同期設定';
      if (opening) {
        const g = ghGetSettings();
        $('gh-repo').value = g.repo;
        $('gh-file').value = g.file;
        $('gh-enabled').checked = g.enabled;
        const tok = localStorage.getItem(GH_TOKEN_SK);
        $('gh-token').value = tok ? '●'.repeat(20) : '';
        $('gh-token').dataset.saved = tok ? '1' : '';
        const sha = localStorage.getItem(GH_SHA_SK);
        if (sha) ghStatus('最終 SHA: ' + sha.slice(0, 7) + '…');
      }
    }

    function saveGhSettings() {
      const tokEl = $('gh-token');
      const mask = '●'.repeat(20);
      if (tokEl.value !== mask) {
        const v = tokEl.value.trim();
        if (v) localStorage.setItem(GH_TOKEN_SK, v);
        tokEl.value = v ? mask : '';
        tokEl.dataset.saved = '1';
      }
      localStorage.setItem(GH_REPO_SK, $('gh-repo').value.trim());
      localStorage.setItem(GH_FILE_SK, $('gh-file').value.trim() || 'data.json');
      localStorage.setItem(GH_ENABLED_SK, $('gh-enabled').checked ? '1' : '0');
      ghStatus('設定を保存しました');
    }

    /* GitHub Contents API — ファイル取得（SHA も記録） */
    async function ghFetchRaw() {
      const { token, repo, file } = ghGetSettings();
      if (!token || !repo) throw new Error('トークンとリポジトリを設定してください');
      const res = await fetch(
        `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(file)}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
      );
      if (res.status === 404) return null;
      if (!res.ok) { const e = await res.json().catch(() => ({ message: 'HTTP ' + res.status })); throw new Error(e.message); }
      const data = await res.json();
      localStorage.setItem(GH_SHA_SK, data.sha);

      // ファイルサイズが 1MB 超の場合、Contents API の content フィールドが null になる
      // → Git Blobs API にフォールバック（上限 ~100MB）
      let base64;
      if (data.content && data.encoding === 'base64') {
        base64 = data.content;
      } else {
        const blobRes = await fetch(
          `https://api.github.com/repos/${ghGetSettings().repo}/git/blobs/${data.sha}`,
          { headers: { Authorization: `Bearer ${ghGetSettings().token}`, Accept: 'application/vnd.github+json' } }
        );
        if (!blobRes.ok) { const e = await blobRes.json().catch(() => ({ message: 'HTTP ' + blobRes.status })); throw new Error(e.message); }
        const blob = await blobRes.json();
        base64 = blob.content;
      }

      const binary = atob(base64.replace(/\n/g, ''));
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    }

    /* GitHub Contents API — ファイル作成 or 更新 */
    async function ghPushRaw() {
      const { token, repo, file } = ghGetSettings();
      if (!token || !repo) throw new Error('トークンとリポジトリを設定してください');
      const sha = localStorage.getItem(GH_SHA_SK);
      // TextEncoder で正確に UTF-8 エンコード（unescape/encodeURIComponent は非推奨のため不使用）
      const jsonStr = JSON.stringify(S, null, 2);
      const bytes = new TextEncoder().encode(jsonStr);
      const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
      const content = btoa(binary);
      const body = { message: 'sync: ' + new Date().toISOString(), content, ...(sha ? { sha } : {}) };
      const res = await fetch(
        `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(file)}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) { const e = await res.json().catch(() => ({ message: 'HTTP ' + res.status })); throw new Error(e.message); }
      const data = await res.json();
      localStorage.setItem(GH_SHA_SK, data.content.sha);
    }

    /* GitHub API — 画像アップロード（images/フォルダへ） */
    async function ghUploadImage(file) {
      const { token, repo } = ghGetSettings();
      if (!token || !repo) throw new Error('GitHubの設定（トークン・リポジトリ）が必要です');

      const ext = file.name.split('.').pop() || 'png';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const random = Math.random().toString(36).substring(2, 7);
      const filename = `images/${timestamp}_${random}.${ext}`;

      const reader = new FileReader();
      const base64Promise = new Promise((resolve, reject) => {
        reader.onload = e => resolve(e.target.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const content = await base64Promise;

      const res = await fetch(
        `https://api.github.com/repos/${repo}/contents/${filename}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'upload image: ' + filename, content }),
        }
      );
      if (!res.ok) { const e = await res.json().catch(() => ({ message: 'HTTP ' + res.status })); throw new Error(e.message); }
      const data = await res.json();
      // download_url から短命な ?token=... を削除して恒急的なURLを保存する
      let finalUrl = data.content.download_url;
      if (finalUrl.includes('?token=')) {
        finalUrl = finalUrl.split('?token=')[0];
      }
      return finalUrl;
    }

    /* 既存の base64 画像をすべて GitHub へ移行してノートを軽量化する */
    async function olMigrateImages() {
      const g = ghGetSettings();
      if (!g.enabled || !g.token || !g.repo) { alert('GitHub 同期を有効にして設定（トークン・リポジトリ）を保存してから実行してください。'); return; }

      let count = 0;
      const allDates = Object.keys(S.dailyOutline || {});
      const toProcess = [];

      allDates.forEach(date => {
        S.dailyOutline[date].forEach(n => {
          if (n.html && n.html.includes('src="data:image/')) toProcess.push({ date, n });
        });
      });

      if (toProcess.length === 0) { alert('移行が必要な base64 画像は見つかりませんでした。'); return; }
      if (!confirm(`${toProcess.length} 個のノードに埋め込まれた画像を GitHub へアップロードし、ノートを軽量化しますか？\n（処理には時間がかかる場合があります）`)) return;

      showToast('⏳ 画像の移行を開始します...');
      for (const item of toProcess) {
        const div = document.createElement('div');
        div.innerHTML = item.n.html;
        const imgs = div.querySelectorAll('img[src^="data:image/"]');
        for (const img of imgs) {
          try {
            const base64 = img.src;
            const res = await fetch(base64);
            const blob = await res.blob();
            const file = new File([blob], "migrated_image.png", { type: blob.type });
            const newUrl = await ghUploadImage(file);
            img.src = newUrl;
            count++;
            showToast(`⏳ 移行中... (${count}件完了)`);
          } catch (err) {
            console.error('Image migration failed:', err);
          }
        }
        item.n.html = div.innerHTML;
        // text も更新（画像タグが含まれる場合）
        item.n.text = div.textContent;
      }

      saveState();
      render();
      if (_olCurrentDate) olRender('ol-container', _olCurrentDate);
      alert(`${count} 個の画像を GitHub へ移行しました。data.json が大幅に軽量化されました。`);
    }

    /* 起動時 or 手動「↓ 取得」 */
    async function ghSyncLoad(manual = false) {
      const g = ghGetSettings();
      if (!g.enabled && !manual) return;
      if (!g.token || !g.repo) { if (manual) ghStatus('トークンとリポジトリを設定してください', true); return; }
      if (_ghSyncing) return;
      _ghSyncing = true;
      ghStatus('⏳ GitHubから取得中…');
      try {
        const remote = await ghFetchRaw();
        if (!remote) { ghStatus('ℹ️ リモートにファイルなし（初回は「↑ 送信」を）'); return; }
        const localAt = S.savedAt ? new Date(S.savedAt) : new Date(0);
        const remoteAt = remote.savedAt ? new Date(remote.savedAt) : new Date(0);
        if (manual || remoteAt > localAt) {
          // 手動取得の場合は上書き前に確認（ローカルに未同期データがある可能性）
          if (manual && S.projects && S.projects.length) {
            const ok = confirm(
              'リモート（GitHub）のデータをローカルに上書きしますか？\n\n' +
              'リモート更新日時: ' + (remote.savedAt ? new Date(remote.savedAt).toLocaleString() : '不明') + '\n' +
              'ローカル更新日時: ' + (S.savedAt ? new Date(S.savedAt).toLocaleString() : '不明') + '\n\n' +
              '※ ローカルの未保存変更は失われます。'
            );
            if (!ok) { ghStatus('取得をキャンセルしました'); _ghSyncing = false; return; }
          }
          S = remote;
          try {
            localStorage.setItem(SK, JSON.stringify(S));
          } catch (e) {
            ghStatus('❌ ローカル保存失敗: ' + e.message, true);
            _ghSyncing = false; return;
          }
          render();
          ghStatus('✓ ' + new Date().toLocaleTimeString() + ' 取得（リモートが最新）');
        } else {
          ghStatus('✓ ' + new Date().toLocaleTimeString() + ' 確認済み（ローカルが最新）');
        }
      } catch (e) {
        ghStatus('❌ ' + e.message, true);
      } finally { _ghSyncing = false; }
    }

    /* 保存時 or 手動「↑ 送信」 */
    async function ghSyncSave(manual = false) {
      const g = ghGetSettings();
      if (!g.enabled && !manual) return;
      if (!g.token || !g.repo) return;
      if (_ghSyncing) return;
      _ghSyncing = true;
      ghStatus('⏳ GitHubへ送信中…');
      try {
        // 毎回プッシュ前に最新 SHA を取得する（陳腐化した SHA による競合を根本から防止）
        await ghFetchRaw().catch(() => { });
        await ghPushRaw();
        _ghDirty = false;
        ghStatus('✓ ' + new Date().toLocaleTimeString() + ' 同期しました');
      } catch (e) {
        // "does not match" / "409" / "sha" いずれの形式でも SHA 競合として再試行
        const msg = String(e.message);
        if (msg.includes('does not match') || msg.includes('409') || msg.includes('sha')) {
          localStorage.removeItem(GH_SHA_SK);
          try {
            await ghFetchRaw().catch(() => { });
            await ghPushRaw();
            _ghDirty = false;
            ghStatus('✓ ' + new Date().toLocaleTimeString() + ' 同期しました（競合解決）');
          } catch (e2) { ghStatus('❌ ' + e2.message, true); }
        } else { ghStatus('❌ ' + msg, true); }
      } finally { _ghSyncing = false; }
    }

    /* ================================================================
       AI パネル — Google Gemini API を使ったチャット・アシスト
       - APIキーはパネル内入力欄で設定、localStorage(AI_KEY)に保存
       - 使用モデルは localStorage(AI_MODEL)に保存（デフォルト: gemini-1.5-flash）
       - 会話履歴は _aiHistory 配列で管理（ページリロードまで保持）
    ================================================================ */
    const AI_KEY_SK = 'pwt_ai_key';
    const AI_MODEL_SK = 'pwt_ai_model';
    const AI_DEFAULT_MODEL = 'gemini-2.5-flash-lite'; // 無料枠あり・推奨

    let _aiHistory = [];   // {role:'user'|'assistant', content:string}
    let _aiOpen = false;
    let _tmplOpen = false;

    /* ── panel open/close ── */
    function toggleAiPanel() {
      _aiOpen = !_aiOpen;
      const panel = $('ai-panel');
      const handle = $('rz-ai');
      const btn = $('ai-btn');
      if (_aiOpen) {
        const w = parseInt(localStorage.getItem('pwt_ai_w') || '360');
        panel.style.width = w + 'px';
        panel.classList.add('open');
        handle.classList.add('visible');
        btn && btn.classList.add('btn-active');
        initAiPanel();
      } else {
        panel.style.width = '0';
        panel.classList.remove('open');
        handle.classList.remove('visible');
        btn && btn.classList.remove('btn-active');
      }
    }

    function initAiPanel() {
      // APIキーをUIに反映
      const key = localStorage.getItem(AI_KEY_SK) || '';
      $('ai-key').value = key ? '●'.repeat(20) : '';
      $('ai-key').dataset.saved = key ? '1' : '';
      // モデル選択を反映
      const mdl = $('ai-model');
      if (mdl) mdl.value = localStorage.getItem(AI_MODEL_SK) || AI_DEFAULT_MODEL;
    }

    function saveAiModel() {
      const mdl = $('ai-model');
      if (mdl) localStorage.setItem(AI_MODEL_SK, mdl.value);
      showToast('✅ モデルを変更しました: ' + (mdl ? mdl.value : ''));
    }

    function getAiModel() {
      return localStorage.getItem(AI_MODEL_SK) || AI_DEFAULT_MODEL;
    }

    /* ── API key ── */
    function saveApiKey() {
      const v = $('ai-key').value.trim();
      if (!v) { alert('APIキーを入力してください'); return; }
      if (v.startsWith('●')) { showToast('APIキーは変更されていません'); return; }
      localStorage.setItem(AI_KEY_SK, v);
      $('ai-key').dataset.saved = '1';
      $('ai-key').value = '●'.repeat(20);
      showToast('✅ APIキーを保存しました');
    }

    function getApiKey() {
      return localStorage.getItem(AI_KEY_SK) || '';
    }

    // APIキー入力欄をクリックしたとき中身をクリアして再入力可能に
    document.addEventListener('click', ev => {
      const inp = $('ai-key');
      if (inp && ev.target === inp && inp.dataset.saved) {
        inp.value = '';
        delete inp.dataset.saved;
      }
    });

    /* ── template ── */

    /* ── build week context for AI ── */
    function buildWeekContext() {
      const weeks = getWeeks();
      const cw = wkey(new Date());
      const label = wkeyLabel(cw);
      let doneTasks = [], undoneTasks = [], logs = [];

      S.projects.forEach((proj, pi) => {
        const items = getGridItems(pi, cw);
        items.forEach(({ node: n }) => {
          const prefix = `【${proj.name}】`;
          const type = getNodeType(n);
          if (type === 'todo') {
            if (n.checked) doneTasks.push(prefix + n.text);
            else undoneTasks.push(prefix + n.text + (n.note ? `（${n.note}）` : ''));
          } else if (type === 'log') {
            logs.push(prefix + n.text + (n.note ? `
  ${n.note}` : ''));
          }
        });
      });

      return { label, doneTasks, undoneTasks, logs };
    }


    /* ── chat rendering ── */
    function renderAiChat() {
      const chat = $('ai-chat');
      chat.innerHTML = _aiHistory.map((m, i) => {
        const isUser = m.role === 'user';
        const text = escHtml(m.content);
        const copyBtn = !isUser
          ? `<button class="ai-copy-btn" onclick="copyAiMsg(${i})" title="コピー">📋</button>`
          : '';
        return `<div class="ai-msg ${isUser ? 'ai-msg-user' : 'ai-msg-ai'}">
      <div class="ai-msg-body">${text}</div>
      ${copyBtn}
    </div>`;
      }).join('');
      chat.scrollTop = chat.scrollHeight;
    }

    function escHtml(s) {
      return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    }

    function copyAiMsg(idx) {
      const text = _aiHistory[idx]?.content || '';
      navigator.clipboard.writeText(text).then(() => showToast('📋 コピーしました'));
    }

    /* ── generate weekly report ── */

    /* ── send custom message ── */
    async function sendAiMsg() {
      const key = getApiKey();
      if (!key) { alert('APIキーが設定されていません。'); return; }
      const inp = $('ai-input');
      const text = inp.value.trim();
      if (!text) return;
      inp.value = '';

      // 週データをシステムコンテキストとして付加
      const ctx = buildWeekContext();
      const systemCtx = 'あなたはプロジェクト管理AIアシスタントです。ユーザーの週次タスク管理ツールに組み込まれています。\n\n'
        + '【今週（' + ctx.label + '）のデータ】\n'
        + '完了タスク:\n' + (ctx.doneTasks.length ? ctx.doneTasks.map(t => '- ' + t).join('\n') : 'なし') + '\n\n'
        + '未完了タスク:\n' + (ctx.undoneTasks.length ? ctx.undoneTasks.map(t => '- ' + t).join('\n') : 'なし') + '\n\n'
        + 'ログ:\n' + (ctx.logs.length ? ctx.logs.map(t => '- ' + t).join('\n') : 'なし');

      _aiHistory.push({ role: 'user', content: text });
      renderAiChat();
      await callClaude(key, null, systemCtx);
    }

    /* ── core API call (Gemini) ── */
    async function callClaude(key, singlePrompt, systemCtx) {
      const sendBtn = $('ai-send');
      if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '生成中…'; }

      // ローディング表示
      _aiHistory.push({ role: 'assistant', content: '⏳ 生成中…' });
      renderAiChat();

      try {
        // Gemini の contents 形式に変換
        // ・role は "user" / "model" (OpenAI の "assistant" → "model")
        // ・各メッセージは parts:[{text:'...'}] 形式
        let contents;
        if (singlePrompt) {
          // 週報生成: 1回限りのプロンプト
          contents = [{ role: 'user', parts: [{ text: singlePrompt }] }];
        } else {
          // チャット: 会話履歴から最後の「生成中」を除いて送る
          contents = _aiHistory
            .slice(0, -1)
            .filter(m => m.content !== '⏳ 生成中…')
            .map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }]
            }));
        }

        // システム指示がある場合は最初のユーザーメッセージの先頭に埋め込む（v1 互換）
        if (systemCtx && contents.length > 0) {
          const firstUser = contents.find(m => m.role === 'user');
          if (firstUser) {
            firstUser.parts[0].text = systemCtx + '\n\n' + firstUser.parts[0].text;
          }
        }

        const body = {
          contents,
          generationConfig: { maxOutputTokens: 2000 },
        };

        const model = getAiModel();
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '（応答なし）';

        // ダミーを本物に差し替え
        _aiHistory[_aiHistory.length - 1] = { role: 'assistant', content: reply };

      } catch (e) {
        _aiHistory[_aiHistory.length - 1] = { role: 'assistant', content: `❌ エラー: ${e.message}` };
      } finally {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '送信'; }
        renderAiChat();
      }
    }

    /* ── AI panel resize ── */
    function startResizeAi(ev) {
      ev.preventDefault();
      const handle = $('rz-ai');
      handle.classList.add('dragging');
      const panel = $('ai-panel');
      const startX = ev.clientX, startW = panel.offsetWidth;
      function onMove(e) {
        const newW = Math.max(280, Math.min(window.innerWidth * 0.5, startW + (startX - e.clientX)));
        panel.style.width = newW + 'px';
      }
      function onUp() {
        handle.classList.remove('dragging');
        localStorage.setItem('pwt_ai_w', $('ai-panel').offsetWidth);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    /* ── link modal ── */
    function openLM(pi, type) {
      lmCtx = { pi, type };
      $('lm-title').textContent = 'リンクを追加';
      $('lm-lbl').value = ''; $('lm-url').value = '';
      $('lm-bg').classList.add('open');
      setTimeout(() => $('lm-lbl').focus(), 50);
    }
    function closeLM() { $('lm-bg').classList.remove('open'); lmCtx = null }
    function saveLM() {
      if (!lmCtx) return;
      const lbl = $('lm-lbl').value.trim(), url = $('lm-url').value.trim();
      if (!lbl || !url) return;
      if (!S.projects[lmCtx.pi].links) S.projects[lmCtx.pi].links = [];
      S.projects[lmCtx.pi].links.push({ label: lbl, url });
      saveState(); closeLM(); render();
    }

    /* ── nav ── */
    function prevW() { S.wOff--; saveState(); render() }
    function nextW() { S.wOff++; saveState(); render() }
    function goToday() { S.wOff = 0; saveState(); render() }

    /* ── global events ── */
    $('lm-bg').addEventListener('click', e => { if (e.target === $('lm-bg')) closeLM() });
    $('qa-bg').addEventListener('click', e => { if (e.target === $('qa-bg')) closeQA() });
    document.addEventListener('keydown', ev => {

      // Ctrl+F: 検索
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'f') {
        ev.preventDefault(); openSearch(); return;
      }

      // Ctrl+K: コマンドパレット
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'k') {
        ev.preventDefault();
        if ($('cmd-bg').classList.contains('open')) { closeCmdPalette(); }
        else { openCmdPalette(); }
        return;
      }
      if (ev.key === 'Escape') {
        if ($('cmd-bg').classList.contains('open')) { closeCmdPalette(); return }
        if ($('img-full').classList.contains('open')) { $('img-full').classList.remove('open'); return }
        if ($('qa-bg').style.display !== 'none') { closeQA(); return }
        if (pCtx) { tryClosePanel(); return }
        closeLM();
      }
      // Alt+H: ヘッダ行へフォーカス（圧縮モード未有効なら自動で有効化、折りたたみはしない）
      // どの状態（eitem / qainp / ノート / 未フォーカス）でも動作する
      if (ev.altKey && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && (ev.key === 'H' || ev.key === 'h')) {
        ev.preventDefault();
        // ── pi を複数の方法で特定 ──
        let pi = -1;
        // ① kfocusクラスのeitem
        const kfEl = document.querySelector('.eitem.kfocus');
        if (kfEl) pi = +kfEl.dataset.pi;
        // ② focusKey から（qainp等でもここで取れる: "pi:wk:-1"）
        if (pi < 0 && focusKey) {
          const p = focusKey.split(':');
          if (p[0] !== 'daily' && p[0] !== '') pi = +p[0];
        }
        // ③ activeElement が qainp の場合
        if (pi < 0) {
          const qa = document.activeElement;
          if (qa && qa.classList && qa.classList.contains('qainp')) pi = +qa.dataset.pi;
        }
        // ④ 圧縮ヘッダ自体にフォーカスがある場合
        if (pi < 0) {
          const hdrTd = document.querySelector('tr.proj-hdr-row td.col-proj:focus');
          if (hdrTd) pi = +hdrTd.dataset.pi;
        }
        // ⑤ フォールバック: 表示モードで見えている最初のプロジェクト
        if (pi < 0) pi = getNextVisiblePi(-1, 1);
        if (pi < 0) return; // プロジェクトなし
        // ── 圧縮モードが無効なら有効化（折りたたみなし） ──
        if (!_compactMode) {
          _compactMode = true;
          const btn = $('compact-btn');
          if (btn) btn.classList.add('btn-active');
          const grid = $('grid-wrap');
          if (grid) grid.classList.add('compact-mode');
          render();
        }
        showHint('⬆ ヘッダへ');
        requestAnimationFrame(() => focusCompactHeader(pi));
        return;
      }
      // Alt+0: 今週へ
      if (ev.altKey && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && ev.key === '0') {
        ev.preventDefault(); goToday(); return;
      }
      // Alt+1/2/3: 表示モード切替
      if (ev.altKey && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
        if (ev.key === '1') { ev.preventDefault(); _viewMode='all';   saveState(); render(); return; }
        if (ev.key === '2') { ev.preventDefault(); _viewMode='work';  saveState(); render(); return; }
        if (ev.key === '3') { ev.preventDefault(); _viewMode='private'; saveState(); render(); return; }
      }
      // Alt+D: 完了非表示トグル
      if (ev.altKey && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && (ev.key === 'd' || ev.key === 'D')) {
        ev.preventDefault(); toggleHideDone(); return;
      }
      // Alt+Shift+D: ToDoパネル
      if (ev.altKey && ev.shiftKey && !ev.ctrlKey && !ev.metaKey && (ev.key === 'd' || ev.key === 'D')) {
        ev.preventDefault(); toggleTodoPanel(); return;
      }

      // Alt+T: 今日のノートを開く
      if (ev.altKey && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && (ev.key === 'T' || ev.key === 't')) {
        ev.preventDefault();
        openNotePanelToDate(todayDateStr(), null);
        return;
      }

      // Ctrl+;: ノートペイン内インクリメンタル検索（ノートペイン中のみ）
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.key === ';') {
        const np = $('note-panel');
        if (np && (np.contains(document.activeElement) || _notePanelOpen)) {
          ev.preventDefault();
          toggleIncSearchBar();
          return;
        }
      }
      // Alt+Shift+E: 新規追加モーダルを開く
      if (ev.altKey && ev.shiftKey && ev.key === 'E') { ev.preventDefault(); openQA(); return }
      // Alt+Shift+C: 圧縮モードトグル
      if (ev.altKey && ev.shiftKey && (ev.key === 'C' || ev.key === 'c')) { ev.preventDefault(); toggleCompactMode(); return }
      // Alt+Shift+N: ノートパネルを開いてフォーカス / ノート内フォーカス中は閉じる
      if (ev.altKey && ev.shiftKey && (ev.key === 'N' || ev.key === 'n')) {
        ev.preventDefault();
        const np = $('note-panel');
        if (_notePanelOpen && np && np.contains(document.activeElement)) {
          toggleNotePanel(); // ノート内にフォーカス → 閉じる
        } else {
          focusNotePanel(); // それ以外 → 開いてフォーカス
        }
        return;
      }
      // Alt+Shift+M: フルスクリーンフォーカスモード（オーバーラップ表示）
      if (ev.altKey && ev.shiftKey && (ev.key === 'M' || ev.key === 'm')) {
        ev.preventDefault();
        const np = $('note-panel');
        if (_fsFocus && np && np.contains(document.activeElement)) {
          toggleFsFocus();
        } else {
          if (!_fsFocus) toggleFsFocus();
          else focusNotePanel();
        }
        return;
      }
      // ノートペイン中: Ctrl+← / Ctrl+→ で日付ナビゲーション（Alt+←/→ は履歴ナビに変更）
      if (_notePanelOpen && (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey) {
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); olPrevDay(); return }
        if (ev.key === 'ArrowRight') { ev.preventDefault(); olNextDay(); return }
      }
      // ノートペイン中: Alt+← / Alt+→ で閲覧履歴ナビゲーション
      if (_notePanelOpen && ev.altKey && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); _noteGoBack(); return }
        if (ev.key === 'ArrowRight') { ev.preventDefault(); _noteGoForward(); return }
      }
      if (ev.altKey && ev.shiftKey && !focusKey) {
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); prevW(); showHint('◀ 前週') }
        if (ev.key === 'ArrowRight') { ev.preventDefault(); nextW(); showHint('▶ 次週') }
      }
    });

    /* ── quick-add modal ── */
    function openQA() {
      const pSel = $('qa-proj');
      pSel.innerHTML = '';
      S.projects.forEach((p, pi) => {
        const o = document.createElement('option');
        o.value = pi; o.textContent = p.name;
        if (focusKey && +focusKey.split(':')[0] === pi) o.selected = true;
        pSel.appendChild(o);
      });
      const wSel = $('qa-week');
      wSel.innerHTML = '';
      const cw = wkey(new Date());
      const baseWeeks = getWeeks();
      const allWeeks = [
        addDays(baseWeeks[0], -14), addDays(baseWeeks[0], -7),
        ...baseWeeks,
        addDays(baseWeeks[baseWeeks.length - 1], 7), addDays(baseWeeks[baseWeeks.length - 1], 14)
      ];
      allWeeks.forEach(w => {
        const k = wkey(w);
        const o = document.createElement('option');
        o.value = k;
        o.textContent = (k === cw ? '★今週 ' : '') + wkeyLabel(k);
        const fwk = focusKey ? focusKey.split(':')[1] : null;
        if ((fwk && k === fwk) || (!fwk && k === cw)) o.selected = true;
        wSel.appendChild(o);
      });
      $('qa-type').value = 'todo';
      $('qa-text').value = '';
      $('qa-url').value = '';
      $('qa-note').value = '';
      $('qa-type').onchange = null;
      $('qa-bg').style.display = 'flex';
      setTimeout(() => $('qa-text').focus(), 60);
    }
    function closeQA() { $('qa-bg').style.display = 'none' }
    function saveQA() {
      const pi = +$('qa-proj').value;
      const wk = $('qa-week').value;
      const type = $('qa-type').value;
      const text = ($('qa-text').value || '').trim();
      const url = ($('qa-url').value || '').trim();
      const note = ($('qa-note').value || '').trim();
      if (!text) { $('qa-text').focus(); return }
      const proj = S.projects[pi];
      const projTag = proj.name.replace(/\s+/g, '_');

      // Determine target date
      let targetDate;
      if (wk === wkey(new Date())) {
        targetDate = todayDateStr();
      } else {
        const mondayDate = wkeyToDate(wk);
        targetDate = mondayDate.getFullYear() + '-' + (mondayDate.getMonth() + 1) + '-' + mondayDate.getDate();
      }

      const nodes = olGetNodes(targetDate);
      const nodeId = olNewId();
      nodes.push({
        id: nodeId, text, type, isTodo: type === 'todo', checked: false,
        indent: 0, projTag, url, note, images: [], priority: '', tags: [], start: '', due: ''
      });

      saveState();
      const weeks = getWeeks().map(w => wkey(w));
      if (!weeks.includes(wk)) {
        const target = wkeyToDate(wk), base = getMonday(new Date());
        S.wOff = Math.round((target - base) / (7 * 24 * 3600 * 1000));
      }
      focusKey = fkey(pi, wk, nodeId);
      closeQA(); render();
      showHint('✅ ' + proj.name + ' に追加しました');
    }

    /* ── sample data ── */
    function initSample() {
      const cw = wkey(new Date()), pw = wkey(addDays(new Date(), -7));
      const today = todayDateStr();
      const lastMonday = (function() { const d = wkeyToDate(pw); return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate(); })();
      S.projects = [
        { name: 'HACCP', links: [], projEntriesOpen: true, collapsed: false },
        { name: '販促システム', links: [], projEntriesOpen: false, collapsed: false },
        { name: '在庫管理', links: [], projEntriesOpen: false, collapsed: false }
      ];
      // Add sample nodes for HACCP
      const hTag = 'HACCP';
      if (!S.dailyOutline) S.dailyOutline = {};
      S.dailyOutline['proj:0'] = [
        { id: olNewId(), text: '全店舗展開計画の最終確認', indent: 0, isTodo: true, checked: false, type: 'todo', projTag: hTag, url: '', note: '', images: [], priority: '', tags: [], start: '', due: '' },
        { id: olNewId(), text: '予算: 850万円', indent: 0, isTodo: false, checked: false, type: 'log', projTag: hTag, url: '', note: '', images: [], priority: '', tags: [], start: '', due: '' }
      ];
      S.dailyOutline[lastMonday] = [
        { id: olNewId(), text: '6.16 経営会議承認', indent: 0, isTodo: false, checked: false, type: 'log', projTag: hTag, url: '', note: '', images: [], priority: '', tags: [], start: '', due: '' },
        { id: olNewId(), text: 'バイロット展開開始10月', indent: 0, isTodo: true, checked: true, type: 'todo', projTag: hTag, url: '', note: '', images: [], priority: '', tags: [], start: '', due: '' }
      ];
      S.dailyOutline[today] = [
        { id: olNewId(), text: 'ステコミ3.4対応', indent: 0, isTodo: true, checked: true, type: 'todo', projTag: hTag, url: '', note: '', images: [], priority: '', tags: [], start: '', due: '' },
        { id: olNewId(), text: '設置不足店舗の対応計画', indent: 0, isTodo: true, checked: false, type: 'todo', projTag: hTag, url: '', note: '富士通・成電社・小泉成器へ確認予定', images: [], priority: '', tags: [], start: '', due: '' },
        { id: olNewId(), text: '運用開始案内！', indent: 0, isTodo: true, checked: false, type: 'todo', projTag: hTag, url: '', note: '', images: [], priority: '', tags: [], start: '', due: '' },
        { id: olNewId(), text: 'HACCP設置間違いのある店舗', indent: 0, isTodo: false, checked: false, type: 'link', projTag: hTag, url: '#', note: '', images: [], priority: '', tags: [], start: '', due: '' },
        { id: olNewId(), text: '仕様書レビュー', indent: 0, isTodo: true, checked: false, type: 'todo', projTag: '販促システム', url: '', note: '', images: [], priority: '', tags: [], start: '', due: '' },
        { id: olNewId(), text: '定例MTG実施', indent: 0, isTodo: false, checked: false, type: 'log', projTag: '販促システム', url: '', note: '議事録はSharePointに保存', images: [], priority: '', tags: [], start: '', due: '' }
      ];
    }

    /* ================================================================
       VERSION TIMESTAMP — 最終保存時刻の表示
    ================================================================ */
    function updateSaveTimeDisplay() {
      const el = $('save-time'); if (!el) return;
      if (!S.savedAt) { el.textContent = ''; return; }
      const d = new Date(S.savedAt);
      const hm = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
      el.textContent = '保存 ' + hm;
      el.title = '最終保存: ' + d.toLocaleString('ja-JP');
    }


    /* ================================================================
       TODAY FOCUS MODE
    ================================================================ */

    function todayDateStr() {
      const d = new Date();
      return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function toggleHideDone() {
      _hideDone = !_hideDone;
      const btn = $('hide-done-btn');
      if (btn) btn.classList.toggle('btn-active', _hideDone);
      document.body.classList.toggle('hide-done', _hideDone);
      showHint(_hideDone ? '完了済みを非表示' : '完了済みを表示');
      // ノートパネルが開いている場合は再描画（olVisible のフィルタを反映）
      // v1.4.3a: 集約セクションは renderKey に含まれないため、強制再描画でフィルタを反映させる
      if (_olCurrentDate) {
        _olLastRenderKey = '';
        olRender('ol-container', _olCurrentDate);
      }
    }

    function toggleCompactMode() {
      // フォーカス中のpiを切替前に取得しておく
      let focusedPi = -1;
      const kfEl = document.querySelector('.eitem.kfocus');
      if (kfEl) {
        focusedPi = +kfEl.dataset.pi;
      } else if (focusKey) {
        const parts = focusKey.split(':');
        if (parts[0] !== 'daily' && parts[0] !== '') focusedPi = +parts[0];
      }
      // 折りたたみ中ならヘッダtdからpiを取得
      if (focusedPi < 0) {
        const hdrTd = document.querySelector('tr.proj-hdr-row td.col-proj:focus');
        if (hdrTd) focusedPi = +hdrTd.dataset.pi;
      }

      _compactMode = !_compactMode;
      if (!_compactMode) _compactExpanded.clear();
      const btn = $('compact-btn');
      if (btn) btn.classList.toggle('btn-active', _compactMode);
      const grid = $('grid-wrap');
      if (grid) grid.classList.toggle('compact-mode', _compactMode);
      render();

      if (_compactMode) {
        // 折りたたみON → 該当プロジェクトのヘッダにフォーカス
        // フォーカス履歴がない場合は表示モードで見えている最初のプロジェクトへ
        const targetPi = focusedPi >= 0 ? focusedPi : getNextVisiblePi(-1, 1);
        if (targetPi >= 0) requestAnimationFrame(() => focusCompactHeader(targetPi));
      } else if (focusedPi >= 0) {
        // 折りたたみOFF → 該当プロジェクトの最初のアイテムにフォーカス
        requestAnimationFrame(() => {
          const weeks = getWeeks();
          for (const w of weeks) {
            const k = wkey(w);
            const items = getGridItems(focusedPi, k);
            if (items.length) {
              applyFocus(focusedPi, k, items[0].node.id);
              return;
            }
          }
          // アイテムが無ければヘッダに留まる（非圧縮モードなのでtabindexなし→スキップ）
        });
      }
    }
    function compactToggleRow(pi) {
      if (_compactExpanded.has(pi)) _compactExpanded.delete(pi);
      else _compactExpanded.add(pi);
      render();
    }

    // ── 圧縮モード: プロジェクトヘッダ行のキーボードナビゲーション ──────────────

    /** 現在のviewModeで表示される次/前のプロジェクトpi（dir=1:下/−1:上）を返す */
    function getNextVisiblePi(pi, dir) {
      let next = pi + dir;
      while (next >= 0 && next < S.projects.length) {
        const p = S.projects[next];
        if (_viewMode === 'all') return next;
        if (_viewMode === 'work' && !p.isPrivate) return next;
        if (_viewMode === 'private' && p.isPrivate) return next;
        next += dir;
      }
      return -1;
    }

    /** 圧縮ヘッダ行のtd[data-pi=pi]にフォーカスを移す */
    function focusCompactHeader(pi) {
      const td = document.querySelector(`tr.proj-hdr-row td.col-proj[data-pi="${pi}"]`);
      if (td) {
        _programmaticFocus = true;
        td.focus();
        requestAnimationFrame(() => { _programmaticFocus = false; });
      }
    }

    function projHdrKeyDown(ev, pi) {
      if (!_compactMode) return;
      const isCollapsed = !_compactExpanded.has(pi);

      // ↑/↓: 前後のプロジェクトヘッダへ
      if (!ev.altKey && !ev.shiftKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
        ev.preventDefault();
        const nextPi = getNextVisiblePi(pi, ev.key === 'ArrowDown' ? 1 : -1);
        if (nextPi >= 0) {
          showHint(ev.key === 'ArrowDown' ? '▼ 次プロジェクト' : '▲ 前プロジェクト');
          focusCompactHeader(nextPi);
        }
        return;
      }

      // Enter / → (折りたたみ中): 展開して先頭アイテムへフォーカス移動
      if ((ev.key === 'Enter' || (ev.key === 'ArrowRight' && isCollapsed)) && !ev.altKey && !ev.shiftKey) {
        ev.preventDefault();
        if (isCollapsed) {
          _compactExpanded.add(pi);
          render();
          requestAnimationFrame(() => {
            // 最初に表示されている週の先頭アイテムへ
            const weeks = getWeeks();
            for (const w of weeks) {
              const k = wkey(w);
              const items = getGridItems(pi, k);
              if (items.length) { applyFocus(pi, k, items[0].node.id); return; }
            }
            focusCompactHeader(pi); // アイテムがなければヘッダへ戻る
          });
        }
        return;
      }

      // ← (展開中) / Space: 折りたたんでヘッダにフォーカスを戻す
      if ((ev.key === 'ArrowLeft' && !isCollapsed) || (ev.key === ' ')) {
        ev.preventDefault();
        if (!isCollapsed) _compactExpanded.delete(pi);
        else _compactExpanded.add(pi);
        render();
        requestAnimationFrame(() => focusCompactHeader(pi));
        return;
      }

      // Tab: 展開中なら先頭アイテムへ進む
      if (ev.key === 'Tab' && !ev.shiftKey && !isCollapsed) {
        ev.preventDefault();
        const weeks = getWeeks();
        for (const w of weeks) {
          const k = wkey(w);
          const items = getGridItems(pi, k);
          if (items.length) { applyFocus(pi, k, items[0].node.id); return; }
        }
        return;
      }
    }


    let _fsFocus = false;
    function toggleFsFocus() {
      _fsFocus = !_fsFocus;
      document.body.classList.toggle('fs-focus-mode', _fsFocus);
      if (_fsFocus) {
        if (!_notePanelOpen) {
          _notePanelOpen = true; // 手動でフラグを立ててから toggleNotePanel の内部処理を模倣（再帰を避ける）
          const np = $('note-panel'), btn = $('note-btn'), rzn = $('rz-note');
          if (!_olCurrentDate) _olCurrentDate = todayDateStr();
          np.classList.add('open');
          btn && btn.classList.add('btn-active');
          rzn && rzn.classList.add('visible');
          updateOlNav();
          olRender('ol-container', _olCurrentDate);
          olSetupPasteHandler();
        }
        focusNotePanel();
      } else {
        // フルスクリーン解除時、サイドパネルとして残すか閉じるかは Alt+Shift+N と同様のルールに準じる
        // ここでは単にクラスを外すのみ
      }
    }

    /* ================================================================
       Step 5: プロジェクトノートの予約セクション（Phase / Link）
       proj:{pi} ノートに以下の構造を保証する:
           Phase (indent=0, type='phase-root')
             フェーズ1 (indent=1, type='phase' を自動付与)
             ...
           Link  (indent=0, type='link-root')
             各リンク (indent=1, type='link' を自動付与)
       ※既存の indent=0 type='link' などのノードは破壊せずに残す。
       ================================================================ */
    function ensureProjNotePreambles(pi) {
      if (typeof pi !== 'number' || !S.projects[pi]) return;
      const key = 'proj:' + pi;
      if (!S.dailyOutline) S.dailyOutline = {};
      let nodes = S.dailyOutline[key];
      if (!nodes) { S.dailyOutline[key] = nodes = []; }

      const hasPhaseRoot = nodes.some(n => n && n.type === 'phase-root');
      const hasLinkRoot  = nodes.some(n => n && n.type === 'link-root');

      // 「Phase」見出しが無ければ先頭に挿入
      if (!hasPhaseRoot) {
        const phaseNode = {
          id: olNewId(), text: 'Phase', indent: 0,
          type: 'phase-root', isTodo: false, checked: false,
          bold: true, color: '', collapsed: false, tags: [], images: []
        };
        nodes.unshift(phaseNode);
      }
      // 「Link」見出しが無ければ Phase の直後（先頭から2番目）に挿入
      if (!hasLinkRoot) {
        const linkNode = {
          id: olNewId(), text: 'Link', indent: 0,
          type: 'link-root', isTodo: false, checked: false,
          bold: true, color: '', collapsed: false, tags: [], images: []
        };
        // Phase 見出しの直後を探す
        const phaseIdx = nodes.findIndex(n => n && n.type === 'phase-root');
        const insertAt = phaseIdx >= 0 ? phaseIdx + 1 : 0;
        // ただし Phase の indent=1 子ノードがあれば、その後ろに置く
        let after = insertAt;
        while (after < nodes.length && nodes[after] && nodes[after].indent >= 1
               && nodes[after].type !== 'link-root') {
          after++;
        }
        nodes.splice(after, 0, linkNode);
      }
    }

    /**
     * proj:{pi} ノートで、Phase見出し直下（indent>=1）のノードに type='phase' を、
     * Link見出し直下（indent>=1）のノードに type='link' を自動付与する。
     * 見出し自身（phase-root / link-root）は触らない。
     * 既存の type が空・'phase'・'link' の場合のみ書き換え、'todo' 等は維持。
     */
    function applyProjAutoTypes(pi) {
      if (typeof pi !== 'number' || !S.projects[pi]) return;
      const key = 'proj:' + pi;
      const nodes = (S.dailyOutline && S.dailyOutline[key]) || [];
      let currentSection = null; // 'phase' | 'link' | null
      for (const n of nodes) {
        if (!n) continue;
        if (n.type === 'phase-root') { currentSection = 'phase'; continue; }
        if (n.type === 'link-root')  { currentSection = 'link';  continue; }
        if (n.indent === 0) { currentSection = null; continue; }
        // indent>=1 の子ノード
        if (currentSection === 'phase' && (!n.type || n.type === 'phase' || n.type === 'link')) {
          n.type = 'phase';
        } else if (currentSection === 'link' && (!n.type || n.type === 'phase' || n.type === 'link')) {
          n.type = 'link';
        }
      }
    }

    /**
     * Step 3: タグ→phase の自動正規化（両対応）
     * node.projTag からプロジェクトを特定し、そのプロジェクトの Phase 見出し直下のノード名と
     * node.tags 内の要素が一致すれば node.phase に格納する。
     * 一致するタグがなければ node.phase は変更しない（既存値を尊重）。
     */
    function getProjPhaseChildrenNames(pi) {
      const key = 'proj:' + pi;
      const nodes = (S.dailyOutline && S.dailyOutline[key]) || [];
      const names = [];
      let inPhase = false;
      for (const n of nodes) {
        if (!n) continue;
        if (n.type === 'phase-root') { inPhase = true; continue; }
        if (n.type === 'link-root')  { inPhase = false; continue; }
        if (n.indent === 0) { inPhase = false; continue; }
        if (inPhase && n.indent >= 1) {
          const t = (n.text || '').trim();
          if (t) names.push(t);
        }
      }
      return names;
    }
    function normalizeNodePhase(node) {
      if (!node || !node.projTag) return;
      if (!Array.isArray(node.tags) || !node.tags.length) return;
      // projTag からプロジェクト index を特定
      const pi = S.projects.findIndex(p => p.name.replace(/\s+/g, '_') === node.projTag);
      if (pi < 0) return;
      const phaseNames = getProjPhaseChildrenNames(pi);
      if (!phaseNames.length) return;
      // tags の中で phase 名と一致するものを探す
      for (const tag of node.tags) {
        if (phaseNames.includes(tag)) {
          node.phase = tag;
          return;
        }
      }
    }

    function toggleNotePanel(date) {
      if (date && typeof date === 'string') {
        if (!_olCurrentDate || _olCurrentDate !== date) { _olCurrentDate = date; }
      }
      _notePanelOpen = !_notePanelOpen;
      const np = $('note-panel'), btn = $('note-btn'), rzn = $('rz-note');
      if (_notePanelOpen) {
        if (!_olCurrentDate) _olCurrentDate = todayDateStr();
        np.classList.add('open');
        btn && btn.classList.add('btn-active');
        rzn && rzn.classList.add('visible');
        const saved = localStorage.getItem('pwt_np_w');
        if (saved) np.style.width = saved + 'px';
        // Step 5: proj:N を開くときは予約セクション（Phase / Link 見出し）を保証
        if (typeof _olCurrentDate === 'string' && _olCurrentDate.startsWith('proj:')) {
          const _pi = parseInt(_olCurrentDate.slice(5), 10);
          if (!isNaN(_pi)) { ensureProjNotePreambles(_pi); applyProjAutoTypes(_pi); saveState(); }
        }
        updateOlNav();
        olRender('ol-container', _olCurrentDate);
        olSetupPasteHandler();
      } else {
        np.classList.remove('open');
        btn && btn.classList.remove('btn-active');
        rzn && rzn.classList.remove('visible');
        np.style.width = '';
        // フルスクリーンモード中なら解除
        if (_fsFocus) {
          _fsFocus = false;
          document.body.classList.remove('fs-focus-mode');
        }
      }
    }

    // ノートパネルを開いて先頭ノードにフォーカス（ショートカット Alt+Shift+N 用）
    function focusNotePanel() {
      if (!_notePanelOpen) {
        // 閉じている → 開いてフォーカス（toggleNotePanel が render+focus を実行する）
        toggleNotePanel();
      } else {
        // 既に開いている → 現在の日付の先頭ノードにフォーカス
        if (_olCurrentDate) {
          _olFocusId = null; // 先頭へ
          olRender('ol-container', _olCurrentDate);
        }
      }
    }

    // 日付ナビゲーション
    function olNavFinish() {
      // 日付移動後の共通処理: ナビ更新→描画→リンクモードが有効なら再設定
      updateOlNav();
      olRender('ol-container', _olCurrentDate);
    }

    function olPrevDay() {
      if (!_olCurrentDate || _olCurrentDate.toString().startsWith('proj:')) return;
      const d = new Date(_olCurrentDate.replace(/(\d+)-(\d+)-(\d+)/, (_, y, m, day) => y + '-' + ('0' + m).slice(-2) + '-' + ('0' + day).slice(-2)));
      d.setDate(d.getDate() - 1);
      const newDate = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      // _olFocusId をクリアする前に push することで、離れる日付のフォーカス位置が履歴に保存される
      _notePush(newDate, null);
      _olCurrentDate = newDate;
      _olFocusId = null;
      olNavFinish();
    }

    function olNextDay() {
      if (!_olCurrentDate || _olCurrentDate.startsWith('proj:')) return;
      const d = new Date(_olCurrentDate.replace(/(\d+)-(\d+)-(\d+)/, (_, y, m, day) => y + '-' + m.padStart(2, '0') + '-' + day.padStart(2, '0')));
      d.setDate(d.getDate() + 1);
      const newDate = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      // _olFocusId をクリアする前に push することで、離れる日付のフォーカス位置が履歴に保存される
      _notePush(newDate, null);
      _olCurrentDate = newDate;
      _olFocusId = null;
      olNavFinish();
    }


    function olGoDate(dateStr) {
      if (!dateStr) return;
      // input[type=date] の値は YYYY-MM-DD 形式なので変換
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        _olCurrentDate = parseInt(parts[0]) + '-' + parseInt(parts[1]) + '-' + parseInt(parts[2]);
      } else {
        _olCurrentDate = dateStr;
      }
      _olFocusId = null;
      olNavFinish();
    }

    function updateOlNav() {
      try {
        const disp = $('ol-date-disp');
        if (!_olCurrentDate) return;

        // 【最優先】表示テキストの更新
        if (_olCurrentDate.toString().startsWith('proj:')) {
          const pi = parseInt(_olCurrentDate.split(':')[1]);
          const pName = (S.projects[pi] && S.projects[pi].name) ? S.projects[pi].name : '不明なプロジェクト';
          if (disp) disp.textContent = '📂 プロジェクトノート: ' + pName;
          
          const els = document.getElementsByClassName('ol-nav-date-only');
          for (let i = 0; i < els.length; i++) els[i].style.display = 'none';
          return;
        }

        const parts = _olCurrentDate.toString().split('-').map(Number);
        if (parts.length === 3) {
          const d = new Date(parts[0], parts[1] - 1, parts[2]);
          const days = ['日', '月', '火', '水', '木', '金', '土'];
          const today = todayDateStr();
          const isToday = (_olCurrentDate === today);
          const dateText = parts[0] + '年' + parts[1] + '月' + parts[2] + '日（' + days[d.getDay()] + '）' + (isToday ? ' ★今日' : '');
          if (disp) disp.textContent = dateText;

          // カレンダーのセット (YYYY-MM-DD)
          const picker = $('ol-date-picker');
          if (picker) {
            const mm = ('0' + parts[1]).slice(-2);
            const dd = ('0' + parts[2]).slice(-2);
            picker.value = parts[0] + '-' + mm + '-' + dd;
          }
        }

        // ナビ表示の復元
        const els = document.getElementsByClassName('ol-nav-date-only');
        for (let i = 0; i < els.length; i++) els[i].style.display = 'inline-flex';

      } catch (err) {
        console.error('updateOlNav Error:', err);
      }
    }


    /* ================================================================
       OUTLINE EDITOR (Workflowy風)
       S.dailyOutline = { "YYYY-M-D": [OlNode] }
       OlNode = { id, text, indent, bold, color, collapsed }
       ・Enter     → 同レベルに新規ノード追加（カーソル位置でテキスト分割）
       ・Tab       → インデント増（前ノードが親になる）
       ・Shift+Tab → インデント減
       ・Backspace → 空の場合は削除してひとつ上にフォーカス
       ・↑/↓      → 前後の可視ノードへ移動
       ・Ctrl+B    → 太字トグル
       ・折りたたみ → 子ノードを持つノードの ▼/▶ をクリック
    ================================================================ */
    let _olFocusId = null;   // 現在フォーカス中のノードID
    let _olFocusAtStart = false; // true=先頭 false=末尾にカーソルを置く
    let _olSaveTimer = null;
    let _olCurrentDate = null;  // アウトラインエディタで表示中の日付 (YYYY-M-D)
    let _olSuppressFocus = false; // trueのとき olRender はフォーカスを奪わず scrollIntoView のみ実行
    // Undo/Redo履歴（日付ごとに独立したスタック）
    const _olUndoStacks = {};  // { [date]: [ JSON文字列, ... ] }
    const _olRedoStacks = {};  // { [date]: [ JSON文字列, ... ] }
    const OL_UNDO_MAX = 80;
    // 選択ノードID（マルチセレクト）
    let _olSelected = new Set();
    let _olShiftSelecting = false; // Shift+↑↓ 操作中フラグ（フォーカス変更時の選択クリアを抑制）
    let _olMouseShift = false;     // Shift+クリック 操作中フラグ（onfocus での選択クリア抑制用）
    // マルチセレクト構造クリップボード: { nodes: [...深いコピー...], text: 'プレーンテキスト', ts: timestamp }
    // Ctrl+C / Ctrl+X 時に保存し、Ctrl+Shift+V で構造ペースト
    let _olMultiClipboard = null;
    let _olSlashMulti = null;      // Ctrl+. 起動時に選択ノード群を保持 (Set<id> または null)
    let _olFocusMode = null;    // フォーカスモード {date, nodeId} or null
    let _olRefRowsExpanded = false; // フォーカス中ノードのサブタスク参照行を展開中か
    let _imgResizeObs = null;   // ResizeObserver for ol-img-wrap size persistence
    let _notePanelOpen = false; // ノートペイン開閉状態

    // ── ノート閲覧履歴（Alt+←/→ で戻る/進む）──
    let _noteNavHistory = [];      // [{ date, nodeId }] 上限50件
    let _noteNavHistoryIdx = -1;   // 現在位置（-1 = 未記録）
    let _noteNavBusy = false;      // 履歴ナビ中は新規プッシュしない

    function _notePush(date, nodeId) {
      if (_noteNavBusy || !date) return;
      // 離れる前に現在の位置のフォーカスノードを記録しておく
      // (ナビ後にノード移動していた場合に戻ったとき同じノードが選択される)
      if (_noteNavHistoryIdx >= 0 && _noteNavHistory[_noteNavHistoryIdx]) {
        _noteNavHistory[_noteNavHistoryIdx].nodeId = _olFocusId || _noteNavHistory[_noteNavHistoryIdx].nodeId;
      }
      const entry = { date, nodeId: nodeId || null };
      // 同じ場所への重複プッシュを防ぐ
      const cur = _noteNavHistory[_noteNavHistoryIdx];
      if (cur && cur.date === entry.date && cur.nodeId === entry.nodeId) return;
      // 現在位置より先の履歴を切り捨て（新規遷移）
      _noteNavHistory = _noteNavHistory.slice(0, _noteNavHistoryIdx + 1);
      _noteNavHistory.push(entry);
      if (_noteNavHistory.length > 50) _noteNavHistory.shift();
      _noteNavHistoryIdx = _noteNavHistory.length - 1;
    }

    function _noteGoBack() {
      if (_noteNavHistoryIdx <= 0) { showToast('これ以上戻れません'); return; }
      _noteNavBusy = true;
      _noteNavHistoryIdx--;
      const h = _noteNavHistory[_noteNavHistoryIdx];
      _olCurrentDate = h.date;
      _olFocusId = h.nodeId;
      olNavFinish();
      if (h.nodeId) setTimeout(() => {
        const el = document.getElementById('olt-' + h.nodeId);
        if (el) el.focus();
      }, 80);
      _noteNavBusy = false;
    }

    function _noteGoForward() {
      if (_noteNavHistoryIdx >= _noteNavHistory.length - 1) { showToast('これ以上進めません'); return; }
      _noteNavBusy = true;
      _noteNavHistoryIdx++;
      const h = _noteNavHistory[_noteNavHistoryIdx];
      _olCurrentDate = h.date;
      _olFocusId = h.nodeId;
      olNavFinish();
      if (h.nodeId) setTimeout(() => {
        const el = document.getElementById('olt-' + h.nodeId);
        if (el) el.focus();
      }, 80);
      _noteNavBusy = false;
    }

    // フォーカスモードを終了する（パンくず「戻る」ボタン・Escapeから呼ばれる）
    function olExitFocus(date) {
      _olFocusMode = null;
      olRender('ol-container', date);
    }

    function olNewId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

    // --- Undo/Redo -------------------------------------------------------
    function olPushHistory(date) {
      if (!_olUndoStacks[date]) _olUndoStacks[date] = [];
      if (!_olRedoStacks[date]) _olRedoStacks[date] = [];
      const nodes = olGetNodes(date);
      const snap = JSON.stringify(nodes);
      const stack = _olUndoStacks[date];
      if (stack.length && stack[stack.length - 1] === snap) return; // 同じ状態なら積まない
      stack.push(snap);
      if (stack.length > OL_UNDO_MAX) stack.shift();
      _olRedoStacks[date] = []; // 新しい変更でRedoスタックをクリア
    }
    function olUndo(date) {
      if (!_olUndoStacks[date] || !_olUndoStacks[date].length) return;
      // 現在状態をRedoスタックに保存
      if (!_olRedoStacks[date]) _olRedoStacks[date] = [];
      _olRedoStacks[date].push(JSON.stringify(olGetNodes(date)));
      const snap = _olUndoStacks[date].pop();
      if (!S.dailyOutline) S.dailyOutline = {};
      S.dailyOutline[date] = JSON.parse(snap);
      // フォーカスIDが復元後のノード一覧に存在すれば維持、存在しなければ先頭へ
      const prevId = _olFocusId;
      if (!prevId || !S.dailyOutline[date].some(n => n.id === prevId)) {
        _olFocusId = S.dailyOutline[date][0]?.id || null;
      }
      saveState(); olRender('ol-container', date);
    }
    function olRedo(date) {
      if (!_olRedoStacks[date] || !_olRedoStacks[date].length) return;
      if (!_olUndoStacks[date]) _olUndoStacks[date] = [];
      _olUndoStacks[date].push(JSON.stringify(olGetNodes(date)));
      const snap = _olRedoStacks[date].pop();
      if (!S.dailyOutline) S.dailyOutline = {};
      S.dailyOutline[date] = JSON.parse(snap);
      // フォーカスIDが復元後のノード一覧に存在すれば維持、存在しなければ先頭へ
      const prevId = _olFocusId;
      if (!prevId || !S.dailyOutline[date].some(n => n.id === prevId)) {
        _olFocusId = S.dailyOutline[date][0]?.id || null;
      }
      saveState(); olRender('ol-container', date);
    }
    // ---------------------------------------------------------------------

    function olGetNodes(date) {
      if (!S.dailyOutline) S.dailyOutline = {};
      if (!S.dailyOutline[date] || !S.dailyOutline[date].length) {
        S.dailyOutline[date] = [{ id: olNewId(), text: '', indent: 0, bold: false, color: '', collapsed: false }];
      }
      return S.dailyOutline[date];
    }

    /* ================================================================
       UNIFIED NODE ACCESS — Phase 2
       S.dailyOutline 構造は保持しつつ、全ノードを横断するAPIを追加。
       各ノードに date プロパティを付与することで、
       日付またぎの検索・一覧・フィルタリングを可能にする。
    ================================================================ */

    /** 全 dailyOutline のノードを date プロパティ付きのフラット配列で返す
     *  @param {object} [opts]
     *  @param {boolean} [opts.includeProj=false] proj:N キーのノードも含める
     *  @returns {{node: object, date: string}[]}
     */
    function getAllNodes({ includeProj = false } = {}) {
      if (!S.dailyOutline) return [];
      const result = [];
      for (const date in S.dailyOutline) {
        if (!includeProj && date.startsWith('proj:')) continue;
        const nodes = S.dailyOutline[date];
        if (!Array.isArray(nodes)) continue;
        for (const node of nodes) {
          // date プロパティを付与（まだない場合）
          if (!node.date) node.date = date;
          result.push({ node, date });
        }
      }
      return result;
    }

    /** 既存ノード全てに date プロパティを付与するマイグレーション
     *  loadState 後に一度だけ呼ぶ。既存データへの影響は date 追加のみ。
     */
    function ensureNodeDates() {
      if (!S.dailyOutline) return;
      for (const date in S.dailyOutline) {
        const nodes = S.dailyOutline[date];
        if (!Array.isArray(nodes)) continue;
        for (const node of nodes) {
          if (!node.date) node.date = date;
        }
      }
    }

    /** 新規ノード作成時のデフォルトフィールドに date を含める
     *  既存の olNewNode() 相当のファクトリ
     */
    function olMakeNode(date, overrides = {}) {
      return {
        id: olNewId(), text: '', indent: 0, bold: false, color: '',
        collapsed: false, date,
        ...overrides
      };
    }

    // Node query engine functions
    function getGridItems(pi, wk) {
      const proj = S.projects[pi];
      if (!proj) return [];
      const projTag = proj.name.replace(/\s+/g, '_');
      const items = [];
      if (!S.dailyOutline) return items;
      for (const date in S.dailyOutline) {
        if (date.startsWith('proj:')) continue;
        let dateWk;
        try {
          dateWk = wkey(new Date(date.replace(/-/g, '/')));
        } catch(e) { continue; }
        if (dateWk !== wk) continue;
        const nodes = S.dailyOutline[date];
        if (!Array.isArray(nodes)) continue;
        nodes.forEach((n, idx) => {
          if (n.projTag === projTag) {
            items.push({ node: n, date, idx });
          }
        });
      }
      return items;
    }

    // グリッドセルのアイテムを親子ツリー順に整理して返す
    // 戻り値: [{node, date, idx, isParent, isChild, children:[]}]
    function getTreeOrderedItems(pi, wk) {
      const items = getGridItems(pi, wk);
      const itemsById = new Map(items.map(i => [i.node.id, i]));
      const topLevel = [];
      const childrenOf = new Map(); // parentId -> [item]

      for (const item of items) {
        const pId = item.node.parentId;
        if (pId && itemsById.has(pId)) {
          if (!childrenOf.has(pId)) childrenOf.set(pId, []);
          childrenOf.get(pId).push(item);
        } else {
          topLevel.push(item);
        }
      }

      const result = [];
      for (const item of topLevel) {
        const children = childrenOf.get(item.node.id) || [];
        result.push({ ...item, isParent: children.length > 0, isChild: false, children });
        if (children.length > 0 && !item.node.gridCollapsed) {
          for (const child of children) {
            result.push({ ...child, isParent: false, isChild: true, children: [] });
          }
        }
      }
      return result;
    }

    // ── ミラーアイテム取得 ─────────────────────────────────────────────
    // 今週(currentWk)より前の週にある未完了アイテムを返す
    // 条件: todo → !checked、log/link → due が設定されている
    // 子アイテムは親がミラー対象なら一緒に返す
    function getMirrorItems(pi, currentWk) {
      if (!S.dailyOutline) return [];
      const result = [];
      const seenIds = new Set();
      const processedWks = new Set();

      for (const date in S.dailyOutline) {
        if (date.startsWith('proj:')) continue;
        let dateWk;
        try {
          dateWk = wkey(new Date(date.replace(/-/g, '/')));
        } catch(e) { continue; }
        // 今週以降はスキップ（過去週のみ）
        if (dateWk >= currentWk) continue;
        if (processedWks.has(dateWk)) continue;
        processedWks.add(dateWk);

        const treeItems = getTreeOrderedItems(pi, dateWk);
        for (const item of treeItems) {
          if (item.isChild) continue; // トップレベルのみ判定
          const n = item.node;
          const nodeType = getNodeType(n);
          // ミラー条件
          const shouldMirror =
            (nodeType === 'todo' && !n.checked) ||
            (nodeType !== 'todo' && n.due && n.due.trim());
          if (!shouldMirror) continue;
          if (seenIds.has(n.id)) continue;
          seenIds.add(n.id);
          result.push({ ...item, isMirror: true, originWk: dateWk });
          // 子アイテムも追加（done/undone問わず、gridCollapsedを尊重）
          if (!n.gridCollapsed) {
            for (const child of item.children) {
              if (seenIds.has(child.node.id)) continue;
              seenIds.add(child.node.id);
              result.push({ ...child, isMirror: true, isChild: true, children: [], originWk: dateWk });
            }
          }
        }
      }

      // 現在週に存在するが parentId がミラー親を指しているアイテムも継続中セクションに含める
      // （パネルや別経路で現在週に追加された子アイテムをミラー親の下にグルーピング）
      const mirrorParentIds = new Set(result.filter(r => !r.isChild).map(r => r.node.id));
      if (mirrorParentIds.size > 0) {
        const curItems = getGridItems(pi, currentWk);
        for (const item of curItems) {
          const n = item.node;
          if (n.parentId && mirrorParentIds.has(n.parentId) && !seenIds.has(n.id)) {
            seenIds.add(n.id);
            // 現在週の子なのでミラーではなく通常アイテムとして扱うが、継続中セクションに表示
            result.push({ ...item, isMirror: false, isChild: true, children: [], originWk: currentWk });
          }
        }
      }

      return result;
    }

    // 親タスクの折りたたみ状態をトグル
    function toggleParentCollapse(pi, wk, nodeId) {
      const found = findNodeById(nodeId);
      if (!found) return;
      found.node.gridCollapsed = !found.node.gridCollapsed;
      saveState(); triggerAutoSave(); render();
      requestAnimationFrame(() => applyFocus(pi, wk, nodeId));
    }

    function getProjItems(pi) {
      const proj = S.projects[pi];
      if (!proj) return [];
      const projTag = proj.name.replace(/\s+/g, '_');
      const dateKey = 'proj:' + pi;
      if (!S.dailyOutline || !S.dailyOutline[dateKey]) return [];
      const nodes = S.dailyOutline[dateKey];
      const items = [];
      nodes.forEach((n, idx) => {
        if (n.projTag === projTag) {
          items.push({ node: n, date: dateKey, idx });
        }
      });
      return items;
    }

    function findNodeById(id) {
      if (!id) return null;
      // getAllNodes() で全日付横断検索（Phase 2）
      const all = getAllNodes({ includeProj: true });
      for (let i = 0; i < all.length; i++) {
        const { node, date } = all[i];
        if (node.id === id) {
          const idx = S.dailyOutline[date].indexOf(node);
          return { node, date, idx };
        }
      }
      return null;
    }

    function getNodeType(n) {
      if (n.type) return n.type;
      if (n.isTodo) return 'todo';
      if (n.url) return 'link';
      return 'log';
    }

    // あるインデックスのノードが子を持つか（次のノードがより深いインデント）
    function olHasChildren(nodes, idx) {
      const myI = nodes[idx].indent;
      for (let i = idx + 1; i < nodes.length; i++) {
        if (nodes[i].indent > myI) return true;
        if (nodes[i].indent <= myI) break;
      }
      return false;
    }

    // ノードのプライベートフラグをトグル
    function olToggleNodePrivate() {
      if (!_olCurrentDate || !_olFocusId) { showToast('ノードを選択してください'); return; }
      const nodes = olGetNodes(_olCurrentDate);
      const node = nodes.find(n => n.id === _olFocusId);
      if (!node) return;
      node.isPrivate = !node.isPrivate;
      olPushHistory(_olCurrentDate);
      saveState();
      olRender('ol-container', _olCurrentDate);
      render(); // グリッド側も即時反映
    }

    // 折りたたみを考慮して可視ノードの配列を返す（元のインデックス _idx 付き）
    function olVisible(nodes) {
      // ── Step 1: 各ノードが「プライベート継承」かどうかを事前計算 ──
      // プライベートフラグが付いたノード自身、およびその子孫を全て「継承プライベート」として扱う
      const inheritedPrivate = new Set();
      // アクティブなプライベート祖先のインデントを追跡するスタック
      const privateAncestorStack = [];
      nodes.forEach((n, i) => {
        // 現在のインデント以上のスタック要素（兄弟・叔父）を除去
        while (privateAncestorStack.length > 0 && privateAncestorStack[privateAncestorStack.length - 1] >= n.indent) {
          privateAncestorStack.pop();
        }
        // 祖先スタックに要素があれば、この祖先はプライベート → 子も継承
        const hasPrivateAncestor = privateAncestorStack.length > 0;
        if (n.isPrivate || hasPrivateAncestor) {
          inheritedPrivate.add(i);
          if (n.isPrivate) {
            // 自身がプライベートなら、子孫に継承させるためスタックに積む
            privateAncestorStack.push(n.indent);
          }
        }
      });

      // ── Step 2: 折りたたみ & プライベートフィルタを適用 ──
      const hidden = new Set();
      const res = [];
      nodes.forEach((n, i) => {
        // プライベートフィルタ
        if (_viewMode === 'work' && inheritedPrivate.has(i)) return;      // お仕事: 継承プライベートを隠す
        if (_viewMode === 'private' && !inheritedPrivate.has(i)) return;  // プライベート: 非プライベートを隠す

        if (hidden.has(i)) return;
        // 完了非表示フィルタ（折りたたみと同じルールで子孫も隠す）
        if (_hideDone && n.isTodo && n.checked) {
          for (let j = i + 1; j < nodes.length; j++) {
            if (nodes[j].indent > n.indent) hidden.add(j);
            else break;
          }
          return;
        }
        res.push({ ...n, _idx: i });
        if (n.collapsed && olHasChildren(nodes, i)) {
          for (let j = i + 1; j < nodes.length; j++) {
            if (nodes[j].indent > n.indent) hidden.add(j);
            else break;
          }
        }
      });
      return res;
    }

    let _olLastRenderKey = '';

    // フォーカスモードを考慮した可視ノードリストを返す共通関数
    // olRender と ArrowUp/Down ハンドラの両方から呼ぶことで、
    // 「画面に表示されているノード」と「キー移動で対象にするノード」を一致させる。
    // 戻り値: { visible: Array, focusNodeText: string }
    //   visible の各要素は { ...node, _idx: number, indent: number（正規化済み） }
    function olGetVisibleForDate(nodes, date) {
      let visible = olVisible(nodes);
      let focusNodeText = '';

      if (_olFocusMode && _olFocusMode.date === date && _olFocusMode.nodeId) {
        const fIdx = nodes.findIndex(n => n.id === _olFocusMode.nodeId);
        if (fIdx >= 0) {
          const fNode = nodes[fIdx];
          focusNodeText = fNode.text || '(空のノード)';
          const fIndent = fNode.indent;
          // サブツリー範囲を collapsed を無視してスキャン
          let endRaw = fIdx + 1;
          while (endRaw < nodes.length && nodes[endRaw].indent > fIndent) endRaw++;
          // フォーカスノード自身の collapsed を無視（子を必ず表示）
          // 各子ノードの collapsed は通常通り尊重（子の子以降を隠す）
          // フォーカスモード内でもプライベートフィルタを適用（olVisible と同ロジック）
          const fInheritedPrivate = new Set();
          const fPrivStack = [];
          for (let i = fIdx + 1; i < endRaw; i++) {
            const n = nodes[i];
            while (fPrivStack.length > 0 && fPrivStack[fPrivStack.length - 1] >= n.indent) fPrivStack.pop();
            if (n.isPrivate || fPrivStack.length > 0) {
              fInheritedPrivate.add(i);
              if (n.isPrivate) fPrivStack.push(n.indent);
            }
          }
          const hidden = new Set();
          const fVis = [];
          for (let i = fIdx + 1; i < endRaw; i++) {
            if (hidden.has(i)) continue;
            const n = nodes[i];
            // プライベートフィルタ
            if (_viewMode === 'work' && fInheritedPrivate.has(i)) continue;
            if (_viewMode === 'private' && !fInheritedPrivate.has(i)) continue;
            // 完了非表示フィルタ
            if (_hideDone && n.isTodo && n.checked) {
              for (let j = i + 1; j < endRaw; j++) {
                if (nodes[j].indent > n.indent) hidden.add(j);
                else break;
              }
              continue;
            }
            fVis.push({ ...n, _idx: i });
            if (n.collapsed && olHasChildren(nodes, i)) {
              for (let j = i + 1; j < endRaw; j++) {
                if (nodes[j].indent > n.indent) hidden.add(j);
                else break;
              }
            }
          }
          visible = fVis.map(n => ({ ...n, indent: n.indent - fIndent - 1 }));
        } else {
          _olFocusMode = null; // フォーカスノードが消えた場合は解除
        }
      }

      return { visible, focusNodeText };
    }

    // アウトラインを描画する
    function olRender(containerId, date) {
      const container = document.getElementById(containerId);
      if (!container) return;
      // Step 5: proj:N の場合、描画前に予約セクション保証＋自動type付与
      if (typeof date === 'string' && date.startsWith('proj:')) {
        const _pi = parseInt(date.slice(5), 10);
        if (!isNaN(_pi)) {
          if (typeof ensureProjNotePreambles === 'function') ensureProjNotePreambles(_pi);
          if (typeof applyProjAutoTypes === 'function') applyProjAutoTypes(_pi);
        }
      }
      const nodes = olGetNodes(date);
      let { visible, focusNodeText } = olGetVisibleForDate(nodes, date);

      // フォーカスモード用パンくずバー
      let html = '';
      if (_olFocusMode && _olFocusMode.date === date) {
        const safeText = focusNodeText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `<div class="ol-breadcrumb">`
          + `<div class="ol-bc-nav">`
          +   `<button class="ol-bc-back" onmousedown="event.preventDefault()" onclick="olExitFocus('${date}')" title="フォーカスモードを終了 (Escape)">◀ 戻る</button>`
          +   `<span class="ol-bc-sep" style="font-size:10px">ズーム中（タイトルは編集可）</span>`
          + `</div>`
          + `<div class="ol-bc-title ol-text" id="olt-${_olFocusMode.nodeId}" contenteditable="true" spellcheck="false"`
          + ` data-date="${date}" data-nid="${_olFocusMode.nodeId}"`
          + ` title="クリックして親ノードのタイトルを編集 / Enter・↓で子ノードへ移動"`
          + ` oninput="olInput('${date}','${_olFocusMode.nodeId}',this)"`
          + ` onkeydown="olKeyDown(event,'${date}','${_olFocusMode.nodeId}')"`
          + ` onfocus="_olFocusId='${_olFocusMode.nodeId}';updateOlFmt('${date}')">`
          + `${safeText}</div>`
          + `</div>`;
      }

      // parentId 参照用マップを構築（全 dailyOutline を対象）
      const _nodeTextById = new Map();
      const _childrenByParentId = new Map(); // parentId -> [{id, text, date}]
      if (S.dailyOutline) {
        for (const d in S.dailyOutline) {
          const dn = S.dailyOutline[d];
          if (!Array.isArray(dn)) continue;
          dn.forEach(nd => {
            if (nd.id) _nodeTextById.set(nd.id, nd.text || '');
            if (nd.parentId) {
              if (!_childrenByParentId.has(nd.parentId)) _childrenByParentId.set(nd.parentId, []);
              _childrenByParentId.get(nd.parentId).push({ id: nd.id, text: nd.text || '', date: d });
            }
          });
        }
      }

      // ── バックリンクマップ: どのノードIDから参照されているかを一括計算 ──
      // nodelink ノードが参照しているリンク元ノードIDへ { fromId, fromDate } を集める
      const _backlinkMap = new Map(); // sourceNodeId → [{fromId, fromDate, fromText}]
      if (S.dailyOutline) {
        for (const _d in S.dailyOutline) {
          const _ns = S.dailyOutline[_d];
          if (!Array.isArray(_ns)) continue;
          for (const _nd of _ns) {
            if (_nd.type === 'nodelink' && _nd.linkedNodeId) {
              if (!_backlinkMap.has(_nd.linkedNodeId)) _backlinkMap.set(_nd.linkedNodeId, []);
              _backlinkMap.get(_nd.linkedNodeId).push({ fromId: _nd.id, fromDate: _d, fromText: _nd.text || '' });
            }
          }
        }
      }

      // ── searchsummary ノードの仮想結果を事前計算 ──
      // renderKey に含めて変化を正しく検出するため、forEach の前に計算
      const _ssResultsMap = new Map();
      visible.forEach(n => {
        if (n.type === 'searchsummary' && !n.collapsed && n.savedQuery) {
          const q = n.savedQuery;
          const res = _runSearchQuery(q.q1 || '', q.q2 || '', q.tags || []);
          _ssResultsMap.set(n.id, res);
        }
      });

      visible.forEach(n => {
        const isParent = olHasChildren(nodes, n._idx);
        // 三角ボタン削除に伴い、インデント位置を調整（少し右に寄せて余白を確保）
        const pl = (n.indent * 22) + 12;

        // projTag バッジ（プロジェクト帰属表示）
        const projTagBadge = n.projTag
          ? `<span class="ol-tag-proj" title="プロジェクト: ${escA(n.projTag)}">#${esc(n.projTag)}</span>`
          : '';
        const selCls = _olSelected.has(n.id) ? ' ol-selected' : '';
        let tStyle = [n.bold ? 'font-weight:700' : '', n.color ? `color:${n.color}` : ''].filter(Boolean).join(';');

        const nodeTypeForBullet = getNodeType(n);
        let bulletHtml = '';
        if (n.isTodo) {
          const collapsedMark = (isParent && n.collapsed) ? '<span class="ol-collapsed-mark" style="font-size:10px;margin-left:-4px;margin-right:2px;color:var(--accent);cursor:pointer" onclick="event.stopPropagation();olToggle(\'' + date + '\',\'' + n.id + '\')">◎</span>' : '';
          bulletHtml = `<div class="ol-cb-area">`
            + `<input type="checkbox" class="ol-todo-cb" ${n.checked ? 'checked' : ''} onmousedown="event.preventDefault()" onclick="event.stopPropagation();olToggleTodo('${date}','${n.id}')">`
            + `</div>${collapsedMark}`;
          if (n.checked) tStyle += (tStyle ? ';' : '') + 'text-decoration:line-through;color:var(--tx3)';
        } else if (nodeTypeForBullet === 'link') {
          // リンクノード: 🔗をクリックでURL開く
          const linkHref = escA(n.url || '#');
          const isWF = (n.url || '').includes('workflowy.com');
          const linkTgt = isWF ? 'workflowy-pane' : '_blank';
          const collapsedMark = (isParent && n.collapsed) ? '<span class="ol-collapsed-mark" style="font-size:10px;margin-left:-4px;margin-right:2px;color:var(--accent);cursor:pointer" onclick="event.stopPropagation();olToggle(\'' + date + '\',\'' + n.id + '\')">◎</span>' : '';
          bulletHtml = `<span class="ol-bullet ol-lnk-bullet"><a href="${linkHref}" target="${linkTgt}" rel="noopener" onclick="event.stopPropagation()" title="${linkHref}">🔗</a></span>${collapsedMark}`;
        } else if (nodeTypeForBullet === 'nodelink') {
          // ノードリンク: 🔖をクリックでリンク元ノードへジャンプ
          const collapsedMark = (isParent && n.collapsed) ? '<span class="ol-collapsed-mark" style="font-size:10px;margin-left:-4px;margin-right:2px;color:var(--accent);cursor:pointer" onclick="event.stopPropagation();olToggle(\'' + date + '\',\'' + n.id + '\')">◎</span>' : '';
          bulletHtml = `<span class="ol-nodelink-bullet" onmousedown="event.preventDefault()" onclick="event.stopPropagation();olJumpToLinkedNode('${escA(n.linkedNodeId||'')}','${escA(n.linkedNodeDate||'')}')" title="元のノードへジャンプ">🔖</span>${collapsedMark}`;
        } else if (nodeTypeForBullet === 'searchsummary') {
          // 検索サマリーノード: 🔍をクリックで折りたたみ切り替え
          const ssCollapsed = n.collapsed;
          bulletHtml = `<span class="ol-ss-bullet" onmousedown="event.preventDefault()" onclick="event.stopPropagation();olToggle('${date}','${n.id}')" title="${ssCollapsed ? '▶ クリックまたは→キーで展開' : '▼ クリックまたは←キーで折りたたむ'}">${ssCollapsed ? '🔍▶' : '🔍▼'}</span>`;
        } else {
          // ドット（•）をCSS制御の丸に変更して位置を固定
          const bulletContent = (isParent && n.collapsed) ? '◎' : '<span class="ol-dot-inner"></span>';
          const toggleAttr = isParent ? `onclick="event.stopPropagation();olToggle('${date}','${n.id}')" style="cursor:pointer" title="展開/折りたたみ"` : '';
          bulletHtml = `<span class="ol-bullet" ${toggleAttr}>${bulletContent}</span>`;
        }

        // リンクノード: URL表示行（小さいテキストで表示、クリックで遷移）
        const urlSubLine = (nodeTypeForBullet === 'link' && n.url)
          ? (() => {
              const isWF2 = n.url.includes('workflowy.com');
              const tgt2 = isWF2 ? 'workflowy-pane' : '_blank';
              const short = n.url.length > 50 ? n.url.slice(0, 47) + '…' : n.url;
              return `<div class="ol-link-url"><a href="${escA(n.url)}" target="${tgt2}" rel="noopener" onclick="event.stopPropagation()" title="${escA(n.url)}">${esc(short)}</a></div>`;
            })()
          : '';

        // サブタスクの場合: 「親名＞」ラベルをテキストの前に表示
        const parentLabelHtml = (n.parentId && _nodeTextById.has(n.parentId))
          ? `<span class="ol-parent-label">${esc(_nodeTextById.get(n.parentId))}＞</span>`
          : '';

        // ノードリンク: ジャンプ先テキスト行（小さいテキストで「→ 元のノードへ」表示）
        const nodeLinkRef = (nodeTypeForBullet === 'nodelink' && n.linkedNodeId)
          ? `<div class="ol-nodelink-ref" onclick="event.stopPropagation();olJumpToLinkedNode('${escA(n.linkedNodeId)}','${escA(n.linkedNodeDate||'')}')" title="元のノードへジャンプ">→ 元のノードへ</div>`
          : '';

        // バックリンクバー: このノードへリンクしているノードリンクがあれば、件数バッジ1個に集約
        // クリックで showBacklinkPopup() を呼びポップオーバーで一覧表示
        const _bls = _backlinkMap.get(n.id);
        const backlinkBar = (_bls && _bls.length > 0)
          ? `<span class="ol-backlink-chip" onmousedown="event.preventDefault()" onclick="event.stopPropagation();showBacklinkPopup('${escA(n.id)}',event)" title="このノードへのリンク元 ${_bls.length} 件（クリックで一覧）">↩ ${_bls.length}</span>`
          : '';

        const isNodeLink = nodeTypeForBullet === 'nodelink';
        const isSearchSummary = nodeTypeForBullet === 'searchsummary';
        html += `<div class="ol-row${selCls}${n.isPrivate ? ' ol-private' : ''}${isNodeLink ? ' ol-row-nodelink' : ''}${isSearchSummary ? ' ol-row-searchsummary' : ''}" data-id="${n.id}" style="padding-left:${pl}px">`
          + bulletHtml
          + `<div class="ol-text-area">`
          + parentLabelHtml
          + `<div class="ol-text" id="olt-${n.id}" contenteditable="true" spellcheck="false"`
          + ` data-date="${date}" data-nid="${n.id}"`
          + ` data-ph="${n._idx === 0 && !(_olFocusMode && _olFocusMode.date === date) ? 'ここにノートを書く（Enterで追加、Tabでインデント）' : ''}"`
          + ` style="${tStyle}"`
          + ` oninput="olInput('${date}','${n.id}',this)"`
          + ` onkeydown="olKeyDown(event,'${date}','${n.id}')"`
          + ` onfocus="_olRefRowsExpanded=false;_olFocusId='${n.id}';if(!_olShiftSelecting&&!_olMouseShift)_olSelected.clear();updateOlFmt('${date}')"`
          + `></div>`
          + urlSubLine
          + nodeLinkRef
          + backlinkBar
          + projTagBadge
          + (n.tags && n.tags.length ? n.tags.map(t => {
              const ts = tagChipStyle(t);
              return `<span class="ol-note-tag-chip" style="${ts}" onclick="event.stopPropagation();setTagFilter('${escA(t)}')" oncontextmenu="event.preventDefault();event.stopPropagation();showTagColorPicker('${escA(t)}',event)" title="クリック: フィルタ / 右クリック: 色設定">#${esc(t)}<span class="ol-tag-del" onmousedown="event.preventDefault()" onclick="event.stopPropagation();olRemoveTag('${escA(date)}','${escA(n.id)}','${escA(t)}')" title="タグを削除"> ×</span></span>`
            }).join('') : '')
          + (() => {
              // サブタスク件数バッジ（インライン・右側）
              if (!_childrenByParentId.has(n.id)) return '';
              const refChildren = _childrenByParentId.get(n.id);
              const total = refChildren.length;
              const done = refChildren.filter(c => {
                const cf = findNodeById(c.id);
                return cf && cf.node.checked && getNodeType(cf.node) === 'todo';
              }).length;
              const label = done > 0 ? `(${done}/${total})` : `(${total})`;
              return `<span class="ol-subtask-count" onmousedown="event.preventDefault()" onclick="event.stopPropagation();olToggleRefRows()" title="Ctrl+Enter でサブタスクを展開">${label}</span>`;
            })()
          + `</div></div>`;

        // サブタスク参照行（フォーカス中かつ展開時のみ表示）
        if (_childrenByParentId.has(n.id) && n.id === _olFocusId && _olRefRowsExpanded) {
          const refPl = pl + 22;
          _childrenByParentId.get(n.id).forEach(child => {
            const childFound = findNodeById(child.id);
            const isDone = childFound && childFound.node.checked && getNodeType(childFound.node) === 'todo';
            html += `<div class="ol-ref-row" style="padding-left:${refPl}px" onclick="openNotePanelToDate('${escA(child.date)}','${escA(child.id)}')" title="クリックしてノードへ移動">`
              + `<span class="ol-ref-icon">↳</span>`
              + `<span style="${isDone ? 'text-decoration:line-through;opacity:0.5' : ''}">${esc(child.text)}</span>`
              + `</div>`;
          });
        }

        // searchsummary 仮想結果行（折りたたみなしのとき）
        if (isSearchSummary && !n.collapsed) {
          const ssRes = _ssResultsMap.get(n.id) || [];
          const childPl = pl + 22;
          if (ssRes.length === 0) {
            html += `<div class="ol-row ol-ss-result" style="padding-left:${childPl}px">`
              + `<span class="ol-ss-bullet" style="opacity:0.4">·</span>`
              + `<div class="ol-text-area"><span class="ol-ss-empty">（検索結果なし）</span></div>`
              + `</div>`;
          } else {
            ssRes.slice(0, 60).forEach(res => {
              let ssAction = '';
              if (res.type === 'DAILY') {
                ssAction = `openNotePanelToDate('${escA(res.date)}','${escA(res.id)}')`;
              } else if ((res.type === 'ENTRY' || res.type === 'NOTE') && res.wk && res.ei) {
                ssAction = `jumpTo(${res.pi},'${res.wk}','${escA(res.ei)}')`;
              } else if ((res.type === 'ENTRY' || res.type === 'NOTE') && res.date && res.ei) {
                ssAction = `openNotePanelToDate('${escA(res.date)}','${escA(res.ei)}')`;
              } else if (res.type === 'PROJECT') {
                ssAction = `(function(){var _p=S.projects[${res.pi}];if(_p&&_p.collapsed){_p.collapsed=false;saveState();render();}var _wks=getWeeks();applyFocus(${res.pi},_wks.length?wkey(_wks[0]):null,null);})()`;
              }
              const typeIcon = { PROJECT: '📁', ENTRY: '·', NOTE: '📝', DAILY: '·' }[res.type] || '·';
              html += `<div class="ol-row ol-ss-result" style="padding-left:${childPl}px" tabindex="0" onclick="(function(){${ssAction}})()" onkeydown="olSsResultKeyDown(event,this,'${date}','${n.id}')">`
                + `<span class="ol-ss-bullet">${typeIcon}</span>`
                + `<div class="ol-text-area">`
                +   `<div class="ol-ss-result-inner">`
                +     `<span class="ol-ss-result-text">${esc(res.text || '')}</span>`
                +     `<span class="ol-ss-result-info">${esc(res.info || res.date || '')}</span>`
                +   `</div>`
                + `</div>`
                + `</div>`;
            });
            if (ssRes.length > 60) {
              html += `<div class="ol-row ol-ss-result" style="padding-left:${childPl}px;cursor:default">`
                + `<span class="ol-ss-bullet" style="opacity:0.4">…</span>`
                + `<div class="ol-text-area"><span class="ol-ss-empty">他 ${ssRes.length - 60} 件</span></div>`
                + `</div>`;
            }
          }
        }
      });

      // 現在の構造（ノードID・インデント・状態・内容）のハッシュを生成
      // _ssResultsMap も含めて searchsummary の結果変化を検出する
      const _ssKey = _ssResultsMap.size ? '|ss:' + [..._ssResultsMap.entries()].map(([id, res]) => id + '=' + res.length + ':' + res.slice(0,3).map(r => r.id || r.text || '').join('|')).join(',') : '';
      const _selKey = _olSelected.size ? '|sel:' + [..._olSelected].sort().join(',') : '';
      const renderKey = date + '|' + (_olFocusMode ? `${_olFocusMode.nodeId}|` : '') + _olFocusId + '|' + _olFocusAtStart + '|' + (_olRefRowsExpanded ? '1' : '0') + _selKey + '|' + JSON.stringify(S.tagMeta||{}) + _ssKey + '|' + visible.map(n => `${n.id}:${n.indent}:${n.collapsed}:${n.isTodo}:${n.checked}:${n.isPrivate}:${n.bold}:${n.color}:${n.linkedEntryRef}:${n.projTag||''}:${n.type||''}:${n.url||''}:${n.parentId||''}:${(n.tags||[]).join(',')}:${n.text}:${n.html}`).join(',');

      if (_olLastRenderKey === renderKey) {
        ghAuthInContainer(container);
        return;
      }
      _olLastRenderKey = renderKey;

      container.innerHTML = _olPreTokenize(html);
        // テキスト/HTML をノードにセット
        visible.forEach(n => {
          const el = document.getElementById('olt-' + n.id);
          if (el) {
            const isFocused = (document.activeElement === el);
            if (n.html && n.html.trim() && n.html !== n.text) {
              const finalH = _olPreTokenize(n.html);
              if (!isFocused || el.innerHTML !== finalH) el.innerHTML = finalH;
            } else {
              const txt = n.text || '';
              const escaped = txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              const withBr = escaped.replace(/\n/g, '<br>');
              let finalH = withBr;
              
              // URLリンクの置換
              if (/https?:\/\//.test(txt)) {
                finalH = finalH.replace(/(https?:\/\/[^\s<>"&]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
              }
              // タグ（#tag または #key:val）の置換 — 属性タグとプロジェクトタグを区別
              if (/#[\w\u3000-\u9FFF:/-]+/.test(txt)) {
                finalH = finalH.replace(/(#[\w\u3000-\u9FFF:/-]+)/g, (match) => {
                  const isAttr = /^#(prio|due|done|p|status|start)[:]/i.test(match) || /^#(done|p[0-3])$/i.test(match);
                  const isProjTag = S.projects && S.projects.some(p => '#' + p.name.replace(/\s+/g, '_') === match || '#' + p.name === match);
                  const cls = isAttr ? 'ol-tag-attr' : (isProjTag ? 'ol-tag-proj' : 'ol-tag');
                  const click = isAttr ? '' : ` onclick="event.stopPropagation();openSearch('${match.replace(/'/g, "\\'")}')"`;
                  return `<span class="${cls}"${click}>${match}</span>`;
                });
              }

              finalH = _olPreTokenize(finalH);
              if (!isFocused || el.innerHTML !== finalH) el.innerHTML = finalH;
            }
          }
        });
      // パンくず親ノードのコンテンツを設定（ズームモード時 — visible には含まれないため別途処理）
      if (_olFocusMode && _olFocusMode.date === date) {
        const bcEl = document.getElementById('olt-' + _olFocusMode.nodeId);
        if (bcEl) {
          const isBcFocused = document.activeElement === bcEl;
          const fNodeData = nodes.find(n => n.id === _olFocusMode.nodeId);
          if (fNodeData) {
            if (fNodeData.html && fNodeData.html.trim() && fNodeData.html !== fNodeData.text) {
              const fH = _olPreTokenize(fNodeData.html);
              if (!isBcFocused || bcEl.innerHTML !== fH) bcEl.innerHTML = fH;
            } else {
              const fTxt = fNodeData.text || '';
              const fEsc = fTxt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              let fFinal = fEsc.replace(/\n/g, '<br>');
              if (/https?:\/\//.test(fTxt)) {
                fFinal = fFinal.replace(/(https?:\/\/[^\s<>"&]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
              }
              if (/#[\w\u3000-\u9FFF:/-]+/.test(fTxt)) {
                fFinal = fFinal.replace(/(#[\w\u3000-\u9FFF:/-]+)/g, (m) => {
                  const isAttr = /^#(prio|due|done|p|status|start)[:]/i.test(m) || /^#(done|p[0-3])$/i.test(m);
                  const isProjTag = S.projects && S.projects.some(p => '#' + p.name.replace(/\s+/g, '_') === m || '#' + p.name === m);
                  const cls = isAttr ? 'ol-tag-attr' : (isProjTag ? 'ol-tag-proj' : 'ol-tag');
                  const clk = isAttr ? '' : ` onclick="event.stopPropagation();openSearch('${m.replace(/'/g, "\\'")}')"`;
                  return `<span class="${cls}"${clk}>${m}</span>`;
                });
              }
              fFinal = _olPreTokenize(fFinal);
              if (!isBcFocused || bcEl.innerHTML !== fFinal) bcEl.innerHTML = fFinal;
            }
          }
        }
      }
      // フォーカス復元
      let focusTarget = null;
      if (_olFocusId) {
        focusTarget = document.getElementById('olt-' + _olFocusId);
      }
      if (!focusTarget) {
        focusTarget = container.querySelector('.ol-text');
      }
      if (focusTarget) {
        if (_olSuppressFocus) {
          // グリッド連動モード: フォーカスを奪わずスクロールのみ＋ハイライト付与
          focusTarget.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          const row = focusTarget.closest('.ol-row');
          if (row) {
            row.classList.remove('ol-grid-highlight');
            void row.offsetWidth; // reflow for re-trigger animation
            row.classList.add('ol-grid-highlight');
            setTimeout(() => row.classList.remove('ol-grid-highlight'), 1200);
          }
          _olSuppressFocus = false;
        } else {
          focusTarget.focus();
          try {
            const range = document.createRange();
            range.selectNodeContents(focusTarget);
            range.collapse(_olFocusAtStart);
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
          } catch (e) { }
          _olFocusAtStart = false;
        }
      }
      ghAuthInContainer(container);
      // 画像リサイズのサイズ変化を監視してノードデータに永続化
      olObserveImgSizes();
      // v1.4.2: ノートペイン内インクリメンタル検索が有効なら、再描画後にハイライトを復元
      _olReapplyIncSearch();
      // v1.4.3: プロジェクトノート描画時、末尾に「自動集約セクション」を追加
      if (typeof date === 'string' && date.startsWith('proj:')) {
        const _pi = parseInt(date.split(':')[1]);
        if (!isNaN(_pi)) _renderProjectAggregateSection(container, _pi);
      }
      // v1.3.1: proj:N ノートを描画した後、グリッドの Phase列・リンク列を非同期同期
      if (typeof date === 'string' && date.startsWith('proj:')) {
        if (_projGridSyncTimer) clearTimeout(_projGridSyncTimer);
        _projGridSyncTimer = setTimeout(() => {
          _projGridSyncTimer = null;
          if (typeof render === 'function') render();
        }, 80);
      }
    }
    let _projGridSyncTimer = null;

    // 画像リサイズサイズの永続化 — ResizeObserver で ol-img-wrap の幅変化を監視
    // ユーザーが CSS resize ハンドルで画像を拡縮したとき、node.html 内の style="width:Xpx" を更新して保存する
    function olObserveImgSizes() {
      if (_imgResizeObs) _imgResizeObs.disconnect();
      if (typeof ResizeObserver === 'undefined') return;
      _imgResizeObs = new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const wrap = entry.target;
          // 初期描画直後の fire (幅が初期値と同じ) はスキップ
          const newW = Math.round(wrap.offsetWidth);
          if (!newW) continue;
          const olText = wrap.closest('.ol-text[data-nid]');
          if (!olText) continue;
          const date = olText.dataset.date;
          const nid  = olText.dataset.nid;
          if (!date || !nid) continue;
          const nodes = olGetNodes(date);
          const node  = nodes.find(n => n.id === nid);
          if (!node || !node.html) continue;
          // ol-img-wrap 内で何番目か（複数画像対応）
          const allWraps = Array.from(olText.querySelectorAll('.ol-img-wrap'));
          const wrapIdx  = allWraps.indexOf(wrap);
          if (wrapIdx === -1) continue;
          // node.html 内の同番目の ol-img-wrap の style="...width:Npx..." を更新
          let count = -1;
          const updated = node.html.replace(/(<span class="ol-img-wrap"[^>]*style=")([^"]*)"/g, (m, pre, style) => {
            count++;
            if (count !== wrapIdx) return m;
            // width:Npx を新しい値に置換（なければ末尾に追記）
            const hasWidth = /\bwidth:[^;]+/.test(style);
            const newStyle = hasWidth
              ? style.replace(/\bwidth:[^;]+;?\s*/g, '').replace(/;?\s*$/, '') + (style.replace(/\bwidth:[^;]+;?\s*/g, '').trim() ? ';' : '') + 'width:' + newW + 'px'
              : (style.trim() ? style.trimEnd().replace(/;?$/, '') + ';width:' + newW + 'px' : 'width:' + newW + 'px');
            return pre + newStyle + '"';
          });
          if (updated !== node.html) {
            node.html = updated;
            changed = true;
          }
        }
        if (changed) {
          clearTimeout(olObserveImgSizes._timer);
          olObserveImgSizes._timer = setTimeout(() => saveState(), 600);
        }
      });
      const container = document.getElementById('ol-container');
      if (!container) return;
      container.querySelectorAll('.ol-img-wrap').forEach(el => _imgResizeObs.observe(el));
    }

    // ノードのテキスト＋HTMLを両方保存するヘルパー（keydown等で利用）
    function olSaveTxt(nodes, idx, el) {
      nodes[idx].text = el.textContent;
      let h = el.innerHTML;
      _imgBlobCache.forEach((ent, stableKey) => {
        if (ent) {
          if (ent.url && ent.url !== stableKey) h = h.split(ent.url).join(stableKey);
          if (ent.blobUrl && ent.blobUrl !== stableKey) h = h.split(ent.blobUrl).join(stableKey);
        }
      });
      // 自動生成のタグスパン（ol-tag / ol-tag-attr / ol-tag-proj）を除去して保存
      // これにより n.html が毎回変化して renderKey がドリフトするのを防ぎ、上下キー移動を安定させる
      h = h.replace(/<span class="(?:ol-tag|ol-tag-attr|ol-tag-proj)"[^>]*>(.*?)<\/span>/g, '$1');
      nodes[idx].html = h;
    }

    // contenteditable 内のカーソルの文字オフセットを取得
    // anchorOffset はノード内オフセットのため、ノード内に複数テキストノードや <br> がある場合に不正確
    // Range を使って要素先頭からカーソルまでの文字数を正確に取得
    function olGetCaretOffset(el) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return el.textContent.length;
      try {
        const r = sel.getRangeAt(0);
        const pre = document.createRange();
        pre.setStart(el, 0);
        pre.setEnd(r.startContainer, r.startOffset);
        return pre.toString().length;
      } catch (e) { return el.textContent.length; }
    }

    // テキスト入力（デバウンスして保存）
    let _olHistoryTimer = null;
    function olInput(date, id, el) {
      // olRender後に切り離された要素で発火した残留イベントをスキップ
      // （C→Bなど2段階ショートカット時、olRender後も旧要素でIMEイベントが続くため）
      if (!el.isConnected) return;

      // スラッシュメニューショートカット発火直後: IMEが挿入した文字をスキップ
      if (_olSlashShortcutFired) {
        _olSlashShortcutFired = false;
        const nodes0 = olGetNodes(date);
        const node0 = nodes0.find(n => n.id === id);
        if (node0) {
          // input ハンドラ内で即座に innerHTML を変えると IME合成中の場合に
          // 組み合わせ文字が予期しない形で挿入されるため、setTimeout で遅延してから修正
          setTimeout(() => {
            if (el.isConnected) {
              el.innerHTML = (node0.html != null) ? node0.html : (node0.text || '');
              try {
                const sel = window.getSelection();
                const r = document.createRange();
                r.selectNodeContents(el); r.collapse(false);
                sel.removeAllRanges(); sel.addRange(r);
              } catch (e) {}
            }
          }, 0);
        }
        return; // node.text の上書きと hideOlSlashMenu() の両方をスキップ
      }

      const nodes = olGetNodes(date);
      const node = nodes.find(n => n.id === id);
      if (node) {
        node.text = el.textContent;
        node.html = el.innerHTML;

        // デイリー抽出用: todoノードのテキスト変更もグリッドに即時反映
        if (node.isTodo && !node.linkedEntryRef) {
          clearTimeout(olInput._gridTimer);
          olInput._gridTimer = setTimeout(() => {
            const focusedEl = document.activeElement;
            const focusedInNote = focusedEl && focusedEl.closest('#ol-container');
            let savedRange = null;
            if (focusedInNote) {
              try {
                const sel = window.getSelection();
                if (sel && sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
              } catch (e) { }
            }
            render();
            if (focusedInNote && focusedEl) {
              focusedEl.focus();
              if (savedRange) {
                try {
                  const sel = window.getSelection();
                  sel.removeAllRanges();
                  sel.addRange(savedRange);
                } catch (e) { }
              }
            }
          }, 800);
        }

      }

      // #タグ補完検知（IMEオン/オフ両対応: _olComposing フラグで制御）
      if (!_olComposing) {
        const sel2 = window.getSelection();
        if (sel2 && sel2.rangeCount && sel2.getRangeAt(0).startContainer.nodeType === Node.TEXT_NODE) {
          const range2 = sel2.getRangeAt(0);
          const beforeCursor = range2.startContainer.textContent.slice(0, range2.startOffset);
          const hashMatch = beforeCursor.match(/[#＃]([\w\u3040-\u9FFF\u30A0-\u30FF]*)$/);
          if (hashMatch) {
            olShowTagDrop(date, id, el, hashMatch[1]);
          } else {
            olHideTagDrop();
          }
        } else {
          olHideTagDrop();
        }
      }

      // プロジェクトコマンド（@, ＠）検知 ※拡張メニューは Ctrl+. ショートカットに移行
      const text = el.textContent.replace(/[\u200B-\u200D\uFEFF]/g, ''); // ゼロ幅文字を除去
      const match = text.match(/(^|\s)([＠@])$/);
      if (match && olGetCaretOffset(el) === text.length) {
        const trig = match[2];
        _olProjNodeId = id;
        _olProjDate = date;
        _olProjTrigger = trig;
        buildOlProjMenu();
        const sel = window.getSelection();
        let r;
        if (sel.rangeCount > 0) r = sel.getRangeAt(0).getBoundingClientRect();
        if (r && r.width >= 0) showOlProjMenuAt(r.left, r.bottom + 4);
        else { const rect = el.getBoundingClientRect(); showOlProjMenuAt(rect.left + 20, rect.bottom); }
      } else {
        if ($('ol-slash-menu') && $('ol-slash-menu').classList.contains('open') && _olSlashNodeId === id) hideOlSlashMenu();
        if ($('ol-proj-menu') && $('ol-proj-menu').classList.contains('open') && _olProjNodeId === id) hideOlProjMenu();
      }

      // テキスト入力1秒後にUndo履歴へ記録（頻繁なpushを避けるためdebounce）
      clearTimeout(_olHistoryTimer);
      _olHistoryTimer = setTimeout(() => olPushHistory(date), 1000);
      clearTimeout(_olSaveTimer);
      _olSaveTimer = setTimeout(() => saveState(), 600);
    }

    // カーソルが contenteditable の末尾にあるか判定（Range比較で確実）
    function olCaretAtEnd(el) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return false;
      const r = sel.getRangeAt(0);
      if (!r.collapsed) return false; // 範囲選択中は false
      try {
        const end = document.createRange();
        end.selectNodeContents(el);
        end.collapse(false); // 末尾へ
        return r.compareBoundaryPoints(Range.END_TO_END, end) >= 0;
      } catch (e) { return false; }
    }
    // カーソルが contenteditable の先頭にあるか判定
    function olCaretAtStart(el) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return false;
      const r = sel.getRangeAt(0);
      if (!r.collapsed) return false;
      try {
        const start = document.createRange();
        start.selectNodeContents(el);
        start.collapse(true); // 先頭へ
        return r.compareBoundaryPoints(Range.START_TO_START, start) <= 0;
      } catch (e) { return false; }
    }

    // IME 変換状態トラッキング（#タグ補完の誤検知を防ぐ）
    document.addEventListener('compositionstart', () => { _olComposing = true; });
    document.addEventListener('compositionend', (ev) => {
      _olComposing = false;
      // ＃（全角）などIME経由で確定した直後、input が発火しない場合があるため
      // compositionend 側でもタグ補完検知を走らせる
      const target = ev.target;
      if (target && target.classList && target.classList.contains('ol-text')) {
        const date = target.dataset.date;
        const id   = target.dataset.nid;
        if (date && id) {
          const sel2 = window.getSelection();
          if (sel2 && sel2.rangeCount && sel2.getRangeAt(0).startContainer.nodeType === Node.TEXT_NODE) {
            const range2 = sel2.getRangeAt(0);
            const beforeCursor = range2.startContainer.textContent.slice(0, range2.startOffset);
            const hashMatch = beforeCursor.match(/[#＃]([\w\u3040-\u9FFF\u30A0-\u30FF]*)$/);
            if (hashMatch) { olShowTagDrop(date, id, target, hashMatch[1]); }
            else { olHideTagDrop(); }
          }
        }
      }
    });

    // キーボードナビ中はhover表示を抑制、マウス移動で解除（Bug3対策）
    document.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown' ||
          ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        document.body.classList.add('kb-nav');
      }
    }, { passive: true });
    document.addEventListener('mousemove', () => {
      if (document.body.classList.contains('kb-nav')) {
        document.body.classList.remove('kb-nav');
      }
    }, { passive: true });

    // キーボード操作
    function olKeyDown(ev, date, id) {
      const nodes = olGetNodes(date);
      const idx = nodes.findIndex(n => n.id === id);
      if (idx === -1) return;

      // #タグドロップダウンが開いている場合は専用ナビゲーション
      const dd = $('ol-tag-dropdown');
      if (dd && dd.style.display !== 'none') {
        if (ev.key === 'Escape') { ev.preventDefault(); olHideTagDrop(); return; }
        if (ev.key === 'ArrowDown') { ev.preventDefault(); olTagDDNavActive(1); return; }
        if (ev.key === 'ArrowUp')   { ev.preventDefault(); olTagDDNavActive(-1); return; }
        if (ev.key === 'Enter' || ev.key === 'Tab') {
          ev.preventDefault();
          if (!olTagDDConfirm()) olHideTagDrop();
          return;
        }
      }

      // Proj Menu Navigation
      const projMenu = $('ol-proj-menu');
      if (projMenu && projMenu.classList.contains('open') && _olProjNodeId === id) {
        const items = projMenu.querySelectorAll('.slash-item');
        let activeIdx = Array.from(items).findIndex(el => el.classList.contains('active'));

        if (ev.key === 'Escape') { hideOlProjMenu(); ev.preventDefault(); return; }
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          if (activeIdx >= 0) items[activeIdx].classList.remove('active');
          activeIdx = (activeIdx + 1) % items.length;
          if (items[activeIdx]) { items[activeIdx].classList.add('active'); items[activeIdx].scrollIntoView({ block: 'nearest' }); }
          return;
        }
        if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          if (activeIdx >= 0) items[activeIdx].classList.remove('active');
          activeIdx = (activeIdx - 1 + items.length) % items.length;
          if (items[activeIdx]) { items[activeIdx].classList.add('active'); items[activeIdx].scrollIntoView({ block: 'nearest' }); }
          return;
        }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          if (activeIdx >= 0 && activeIdx < items.length) {
            items[activeIdx].click();
          }
          return;
        }
      }

      // Slash Menu Navigation / Execution
      const slashMenu = $('ol-slash-menu');
      if (slashMenu && slashMenu.classList.contains('open') && _olSlashNodeId === id) {
        const mainWrap = slashMenu.querySelector('#slash-menu-main');
        const colorWrap = slashMenu.querySelector('#slash-menu-color');
        const dateWrap = slashMenu.querySelector('#slash-menu-date');
        const isColorOpen = colorWrap && colorWrap.style.display === 'block';
        const isDateOpen = dateWrap && dateWrap.style.display !== 'none';
        const activeWrap = isColorOpen ? colorWrap : isDateOpen ? null : mainWrap;
        const items = activeWrap ? activeWrap.querySelectorAll('.slash-item') : [];
        let activeIdx = Array.from(items).findIndex(el => el.classList.contains('active'));

        // 日付サブ階層が開いているときは Escape で戻るのみ
        if (isDateOpen) {
          if (ev.key === 'Escape' || ev.key === 'ArrowLeft') {
            ev.preventDefault();
            applyOlSlashCommand('submenu_main');
            return;
          }
          // 日付サブ階層内では Enter キーで移動を実行
          if (ev.key === 'Enter') {
            ev.preventDefault();
            olSlashDateConfirm();
            return;
          }
          // その他のキーはデフォルト動作（date input に届く）
          return;
        }

        // 左右キー（▶ / ◀）でサブ階層の出入りを可能にする
        if (ev.key === 'ArrowRight' && !isColorOpen) {
          const activeEl = items[activeIdx];
          if (activeEl && activeEl.textContent.includes('文字色')) {
            ev.preventDefault();
            applyOlSlashCommand('submenu_color');
            return;
          }
          if (activeEl && activeEl.textContent.includes('別の日')) {
            ev.preventDefault();
            applyOlSlashCommand('submenu_date');
            return;
          }
        }
        if (ev.key === 'ArrowLeft' && isColorOpen) {
          ev.preventDefault();
          applyOlSlashCommand('submenu_main');
          return;
        }

        if (ev.key === 'Escape') { hideOlSlashMenu(); ev.preventDefault(); return; }
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          if (activeIdx >= 0) items[activeIdx].classList.remove('active');
          activeIdx = (activeIdx + 1) % items.length;
          items[activeIdx].classList.add('active');
          return;
        }
        if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          if (activeIdx >= 0) items[activeIdx].classList.remove('active');
          activeIdx = (activeIdx - 1 + items.length) % items.length;
          items[activeIdx].classList.add('active');
          return;
        }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          if (activeIdx >= 0 && activeIdx < items.length) {
            items[activeIdx].click();
          } else {
            applyOlSlashCommand('todo');
          }
          return;
        }

        // アルファベットキーでショートカット実行
        // ev.code（'KeyB' など）を使う: IMEオン時も ev.key が 'Process' にならず物理キーを確実に取得できる
        if (!ev.ctrlKey && !ev.metaKey && !ev.altKey) {
          const codeMatch = ev.code && ev.code.match(/^Key([A-Z])$/);
          if (codeMatch) {
            const k = codeMatch[1].toLowerCase();
            if (isColorOpen) {
              const colorKeys = {
                n: 'color_', r: 'color_#e74c3c', o: 'color_#e67e22',
                y: 'color_#f1c40f', g: 'color_#2ecc71', b: 'color_#3498db',
                p: 'color_#9b59b6', a: 'color_#95a5a6'
              };
              if (colorKeys[k]) { ev.preventDefault(); _olSlashShortcutFired = true; applyOlSlashCommand(colorKeys[k]); return; }
            } else {
              const mainKeys = {
                t: 'todo', d: 'bullet', b: 'bold', p: 'private',
                l: 'link', u: 'unlink', h: 'insert_table', i: 'insert_image',
                c: 'submenu_color', m: 'submenu_date'
              };
              if (mainKeys[k]) { ev.preventDefault(); _olSlashShortcutFired = true; applyOlSlashCommand(mainKeys[k]); return; }
            }
          }
        }
      }

      // ── ズームモードのパンくず親ノードにフォーカスが当たっているときの特殊処理 ──
      // Enter / ↓ / Tab → 最初の子ノードへ移動（インデント操作などは行わない）
      if (_olFocusMode && _olFocusMode.date === date && id === _olFocusMode.nodeId) {
        if (ev.key === 'Enter' || ev.key === 'ArrowDown' || ev.key === 'Tab') {
          ev.preventDefault();
          const { visible: bcVis } = olGetVisibleForDate(nodes, date);
          if (bcVis.length > 0) {
            // 子ノードがあれば最初の子へ移動
            _olFocusId = bcVis[0].id;
            olRender('ol-container', date);
          } else if (ev.key === 'Enter') {
            // Enter かつ子ノードがない → 新規子ノードを作成してフォーカス
            olPushHistory(date);
            olSaveTxt(nodes, idx, ev.target);
            const newNode = { id: olNewId(), text: '', indent: nodes[idx].indent + 1, bold: false, color: '', collapsed: false };
            nodes.splice(idx + 1, 0, newNode);
            _olFocusId = newNode.id;
            _olFocusAtStart = true;
            saveState();
            olRender('ol-container', date);
          }
          return;
        }
        // Escape・その他のCtrl/Metaキーは以降の共通ハンドラへ
        // 通常の文字入力・Backspace・Home/End などはそのまま通過させる
        if (ev.key !== 'Escape' && !ev.ctrlKey && !ev.metaKey) {
          if (ev.key === 'ArrowUp' || (ev.key === 'ArrowLeft' && olCaretAtStart(ev.target)) || (ev.key === 'ArrowRight' && olCaretAtEnd(ev.target))) {
            ev.preventDefault(); // 行頭←・行末→・↑ で子ノードリストの外に出ないようにする
          }
          return; // テキスト編集キーはネイティブ動作に任せ、以降のハンドラをスキップ
        }
      }

      // Ctrl+Enter → サブタスク参照行の展開/折りたたみ
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        const curNode = nodes[idx];
        // S.dailyOutline 全体から parentId が curNode.id を指すノードがあるか確認
        const hasRefChildren = S.dailyOutline && Object.values(S.dailyOutline).some(arr =>
          Array.isArray(arr) && arr.some(nd => nd.parentId === curNode.id)
        );
        if (hasRefChildren) {
          ev.preventDefault();
          olToggleRefRows();
          return;
        }
      }

      // Ctrl+. (or Cmd+.) → 拡張メニュー（旧: Ctrl+/）
      if ((ev.ctrlKey || ev.metaKey) && ev.key === '.') {
        ev.preventDefault();
        openOlSlashMenuFromKeyboard(id, date);
        return;
      }

      // Ctrl+Z: Undo
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key === 'z') {
        ev.preventDefault(); olUndo(date); return;
      }
      // Ctrl+Y / Ctrl+Shift+Z: Redo
      if (((ev.ctrlKey || ev.metaKey) && ev.key === 'y') || ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === 'z')) {
        ev.preventDefault(); olRedo(date); return;
      }

      // Alt+Enter または Ctrl+Enter: ノードのグリッドパネルを開く（projTagがあれば）
      // Alt+Enter: グリッドへジャンプ（ノート→グリッド）
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && ev.key === 'Enter') {
        ev.preventDefault();
        jumpToGridFromNote();
        return;
      }

      // Delete（修飾なし）+ 複数選択中: 一括削除（選択ノードと各サブツリー）
      // 1件のみ選択 / 未選択時は通常のテキスト削除を妨げないため発火しない
      if (ev.key === 'Delete' && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !ev.altKey && _olSelected.size >= 2) {
        ev.preventDefault();
        olPushHistory(date);
        olSaveTxt(nodes, idx, ev.target);
        const toDelete = new Set();
        nodes.forEach((n, i) => {
          if (_olSelected.has(n.id)) {
            const sub = olGetSubtree(nodes, i);
            for (let j = i; j < i + sub; j++) toDelete.add(j);
          }
        });
        const deletedCount = toDelete.size;
        for (let i = nodes.length - 1; i >= 0; i--) if (toDelete.has(i)) nodes.splice(i, 1);
        if (nodes.length === 0) nodes.push({ id: olNewId(), text: '', indent: 0, bold: false, color: '', collapsed: false });
        _olSelected.clear();
        _olFocusId = nodes[Math.max(0, Math.min(idx, nodes.length - 1))].id;
        _olFocusAtStart = false;
        showToast('🗑️ ' + deletedCount + ' 件を削除しました');
        saveState(); olRender('ol-container', date);
        setTimeout(() => { if (typeof render === 'function') render(); }, 10);
        return;
      }

      // Ctrl+Shift+Delete: 選択中ノード（複数可）or そのノードと配下をすべて削除
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === 'Delete') {
        ev.preventDefault();
        olPushHistory(date);
        olSaveTxt(nodes, idx, ev.target);
        if (_olSelected.size > 0) {
          // マルチセレクト削除：選択されたノードと各サブツリーを削除
          const toDelete = new Set();
          nodes.forEach((n, i) => {
            if (_olSelected.has(n.id)) {
              const sub = olGetSubtree(nodes, i);
              for (let j = i; j < i + sub; j++)toDelete.add(j);
            }
          });
          for (let i = nodes.length - 1; i >= 0; i--)if (toDelete.has(i)) nodes.splice(i, 1);
          _olSelected.clear();
        } else {
          const subtree = olGetSubtree(nodes, idx);
          nodes.splice(idx, subtree);
        }
        if (nodes.length === 0) nodes.push({ id: olNewId(), text: '', indent: 0, bold: false, color: '', collapsed: false });
        _olFocusId = nodes[Math.max(0, idx - 1)].id; _olFocusAtStart = false;
        saveState(); olRender('ol-container', date);
        // Step 2 関連バグ修正: グリッドの Phase列・リンク列を即時同期
        setTimeout(() => { if (typeof render === 'function') render(); }, 10);
        return;
      }

      // Ctrl+B: 太字トグル
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'b') {
        ev.preventDefault();
        olSaveTxt(nodes, idx, ev.target);
        nodes[idx].bold = !nodes[idx].bold;
        _olFocusId = id; saveState(); olRender('ol-container', date); return;
      }

      // Ctrl+L: リンク挿入（Ctrl+K はグローバルコマンドパレットに使用）
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'l') {
        ev.preventDefault();
        olInsertLink(); return;
      }

      // Enter: カーソル位置でテキストを分割して新規ノードを挿入
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        olPushHistory(date);
        const el = ev.target;
        // 折りたたまれているノードの場合は、サブツリー全体の後ろに新規ノードを追加
        const isColl = nodes[idx].collapsed && olHasChildren(nodes, idx);
        const insertIdx = isColl ? idx + olGetSubtree(nodes, idx) : idx + 1;
        const newIndent = nodes[idx].indent;
        // リッチノード（画像・表・URLリンクを含む）は分割せず新規ノードを後ろに追加
        // ※ URLリンクはカーソル位置の計算が不正確になるためテキスト分割を行わない
        if (el.querySelector('img,table,a[href]') || isColl || nodes[idx].type === 'nodelink' || nodes[idx].type === 'searchsummary') {
          olSaveTxt(nodes, idx, el);
          const newNode = { id: olNewId(), text: '', html: '', indent: newIndent, bold: false, color: '', collapsed: false, isPrivate: nodes[idx].isPrivate || false };
          nodes.splice(insertIdx, 0, newNode);
          _olFocusId = newNode.id; _olFocusAtStart = true;
          saveState(); olRender('ol-container', date); return;
        }
        // 通常テキスト: カーソル位置で分割（olGetCaretOffset で正確な位置を取得）
        const offset = olGetCaretOffset(el);
        const full = el.textContent;
        const isAtEnd = offset >= full.length;

        // 行頭（offset=0）で内容あり: 空ノードを直前に挿入し、元ノードはすべての修飾を保持
        if (offset === 0 && full.length > 0) {
          const emptyNode = {
            id: olNewId(), text: '', html: '',
            indent: newIndent, bold: false, color: '',
            isTodo: false, checked: false, tags: [],
            isPrivate: nodes[idx].isPrivate || false, collapsed: false,
          };
          nodes.splice(idx, 0, emptyNode); // 元ノードの直前に空ノードを挿入
          _olFocusId = emptyNode.id; _olFocusAtStart = true;
          saveState(); olRender('ol-container', date); return;
        }

        nodes[idx].text = full.slice(0, offset);
        nodes[idx].html = '';
        const newNode = { id: olNewId(), text: full.slice(offset), html: '', indent: newIndent, bold: false, color: '', collapsed: false, isPrivate: nodes[idx].isPrivate || false };
        // 文中で分割した場合: タグ・プロジェクト・サブタスク紐づけを新ノード（後半）に移す
        if (!isAtEnd) {
          if (nodes[idx].tags && nodes[idx].tags.length) {
            newNode.tags = [...nodes[idx].tags];
            nodes[idx].tags = [];
          }
          if (nodes[idx].projTag) {
            newNode.projTag = nodes[idx].projTag;
            delete nodes[idx].projTag;
          }
          // 他日付のサブタスク（parentId リンク）も新ノードに付け替える
          const oldId = nodes[idx].id;
          if (S.dailyOutline) {
            for (const d in S.dailyOutline) {
              const arr = S.dailyOutline[d];
              if (Array.isArray(arr)) {
                arr.forEach(nd => { if (nd.parentId === oldId) nd.parentId = newNode.id; });
              }
            }
          }
        }
        nodes.splice(insertIdx, 0, newNode);
        _olFocusId = newNode.id; _olFocusAtStart = true;
        saveState(); olRender('ol-container', date); return;
      }

      // ── テーブルセル内キーナビゲーション ──────────────────────────────
      // Tab/矢印キーでセル間移動。セル内にいる場合はノード間移動を抑制する。
      {
        const _sel = window.getSelection();
        if (_sel && _sel.rangeCount) {
          const _an = _sel.anchorNode;
          const _anchorEl = _an && (_an.nodeType === 1 ? _an : _an.parentElement);
          const _cell = _anchorEl && _anchorEl.closest && _anchorEl.closest('td, th');
          // セルがこの ol-text div 内に存在するか確認
          if (_cell && ev.target.contains(_cell)) {
            const _table = _cell.closest('table');
            const _allCells = _table ? Array.from(_table.querySelectorAll('td, th')) : [];
            const _ci = _allCells.indexOf(_cell);
            const _row = _cell.closest('tr');
            const _colI = Array.from(_row.cells).indexOf(_cell);

            // カーソルがセル先頭／末尾にあるかをRange比較で判定
            const _r = _sel.getRangeAt(0);
            const _atStart = (() => {
              try {
                const t = document.createRange();
                t.selectNodeContents(_cell); t.collapse(true);
                return _r.compareBoundaryPoints(Range.START_TO_START, t) <= 0;
              } catch(e) { return false; }
            })();
            const _atEnd = (() => {
              try {
                const t = document.createRange();
                t.selectNodeContents(_cell); t.collapse(false);
                return _r.compareBoundaryPoints(Range.END_TO_END, t) >= 0;
              } catch(e) { return false; }
            })();

            // フォーカスセルへカーソルを移動するヘルパー
            const _goCell = (targetCell, placeAtStart) => {
              document.querySelectorAll('.ol-text .tbl-cell-focus')
                .forEach(c => c.classList.remove('tbl-cell-focus'));
              targetCell.classList.add('tbl-cell-focus');
              const nr = document.createRange();
              nr.selectNodeContents(targetCell);
              nr.collapse(placeAtStart !== false); // true=先頭, false=末尾
              _sel.removeAllRanges(); _sel.addRange(nr);
              targetCell.scrollIntoView({ block: 'nearest' });
            };

            // Tab → 次のセルへ（最終セルは新行追加）
            if (ev.key === 'Tab' && !ev.shiftKey) {
              ev.preventDefault();
              if (_ci < _allCells.length - 1) {
                _goCell(_allCells[_ci + 1], true);
              } else {
                const newRow = _table.insertRow();
                for (let i = 0; i < _row.cells.length; i++) {
                  newRow.insertCell().innerHTML = '<br>';
                }
                olRichSave();
                _goCell(newRow.cells[0], true);
              }
              return;
            }

            // Shift+Tab → 前のセルへ
            if (ev.key === 'Tab' && ev.shiftKey) {
              ev.preventDefault();
              if (_ci > 0) _goCell(_allCells[_ci - 1], false);
              return;
            }

            // → セル末尾から次のセルへ（セル内の場合はノード間移動を抑制）
            if (ev.key === 'ArrowRight' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
              if (_atEnd && _ci < _allCells.length - 1) {
                ev.preventDefault();
                _goCell(_allCells[_ci + 1], true);
              }
              return; // セル内 → ノード間移動しない
            }

            // ← セル先頭から前のセルへ
            if (ev.key === 'ArrowLeft' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
              if (_atStart && _ci > 0) {
                ev.preventDefault();
                _goCell(_allCells[_ci - 1], false);
              }
              return; // セル内 → ノード間移動しない
            }

            // ↓ 次の行の同じ列へ（セル内の場合はノード間移動を抑制）
            if (ev.key === 'ArrowDown' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
              const nextRow = _row.nextElementSibling;
              if (nextRow && nextRow.cells[_colI]) {
                ev.preventDefault();
                _goCell(nextRow.cells[_colI], true);
              }
              return; // セル内 → ノード間移動しない
            }

            // ↑ 前の行の同じ列へ
            if (ev.key === 'ArrowUp' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
              const prevRow = _row.previousElementSibling;
              if (prevRow && prevRow.cells[_colI]) {
                ev.preventDefault();
                _goCell(prevRow.cells[_colI], false);
              }
              return; // セル内 → ノード間移動しない
            }
          }
        }
      }

      // Tab: インデント増（前ノードが存在する場合のみ、サブツリーごと）
      if (ev.key === 'Tab' && !ev.shiftKey) {
        ev.preventDefault();
        olPushHistory(date);
        olSaveTxt(nodes, idx, ev.target);
        const maxI = idx > 0 ? nodes[idx - 1].indent + 1 : 0;
        if (nodes[idx].indent < maxI) {
          const sub = olGetSubtree(nodes, idx);
          for (let i = idx; i < idx + sub; i++) nodes[i].indent++;
          // 新しい親が折りたたまれていれば展開してノードが消えないようにする
          if (idx > 0 && nodes[idx - 1].collapsed) {
            nodes[idx - 1].collapsed = false;
          }
          saveState(); _olFocusId = id; olRender('ol-container', date);
        }
        return;
      }

      // Shift+Tab: インデント減（サブツリーごと）
      if (ev.key === 'Tab' && ev.shiftKey) {
        ev.preventDefault();
        olPushHistory(date);
        olSaveTxt(nodes, idx, ev.target);
        if (nodes[idx].indent > 0) {
          const sub = olGetSubtree(nodes, idx);
          for (let i = idx; i < idx + sub; i++)nodes[i].indent--;
          saveState(); _olFocusId = id; olRender('ol-container', date);
        }
        return;
      }

      // Backspace: 空のノードを削除（リッチコンテンツがない場合のみ）
      if (ev.key === 'Backspace' && ev.target.textContent === '' && !ev.target.querySelector('img,table') && nodes.length > 1) {
        ev.preventDefault();
        olPushHistory(date);
        nodes.splice(idx, 1);
        _olFocusId = nodes[Math.max(0, idx - 1)].id; _olFocusAtStart = false;
        saveState();
        olRender('ol-container', date); // 即座に応答
        setTimeout(() => { if (typeof render === 'function') render(); }, 10); // 非同期でグリッド同期
        return;
      }

      // Ctrl+↑: 折りたたむ（子がある場合のみ）— ↑ 単独より先に判定
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (olHasChildren(nodes, idx)) {
          olSaveTxt(nodes, idx, ev.target);
          nodes[idx].collapsed = true;
          _olFocusId = id; saveState(); olRender('ol-container', date);
        }
        return;
      }
      // Ctrl+↓: 展開（子がある場合のみ）— ↓ 単独より先に判定
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (olHasChildren(nodes, idx)) {
          olSaveTxt(nodes, idx, ev.target);
          nodes[idx].collapsed = false;
          _olFocusId = id; saveState(); olRender('ol-container', date);
        }
        return;
      }

      // →: searchsummary が折りたたまれていれば展開（行末で判定）
      if (ev.key === 'ArrowRight' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
        if (nodes[idx].type === 'searchsummary' && nodes[idx].collapsed && olCaretAtEnd(ev.target)) {
          ev.preventDefault();
          olToggle(date, id);
          return;
        }
      }

      // ←: searchsummary が展開中なら折りたたむ（行頭で判定）
      if (ev.key === 'ArrowLeft' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
        if (nodes[idx].type === 'searchsummary' && !nodes[idx].collapsed && olCaretAtStart(ev.target)) {
          ev.preventDefault();
          olToggle(date, id);
          return;
        }
      }

      // →: 行末から次の可視ノードの先頭へ（Ctrl/Alt なし）
      if (ev.key === 'ArrowRight' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
        if (olCaretAtEnd(ev.target)) {
          const vis = olGetVisibleForDate(nodes, date).visible; const vi = vis.findIndex(n => n.id === id);
          if (vi < vis.length - 1) {
            ev.preventDefault();
            _olFocusId = vis[vi + 1].id; _olFocusAtStart = true;
            olRender('ol-container', date);
          }
        }
        return;
      }

      // ←: 行頭から前の可視ノードの末尾へ（Ctrl/Alt なし）
      if (ev.key === 'ArrowLeft' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
        if (olCaretAtStart(ev.target)) {
          const vis = olGetVisibleForDate(nodes, date).visible; const vi = vis.findIndex(n => n.id === id);
          if (vi > 0) {
            ev.preventDefault();
            _olFocusId = vis[vi - 1].id; _olFocusAtStart = false;
            olRender('ol-container', date);
          }
        }
        return;
      }

      // Shift+↑: マルチセレクト（前の行も選択に追加）
      if (ev.key === 'ArrowUp' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.shiftKey) {
        ev.preventDefault();
        const vis = olGetVisibleForDate(nodes, date).visible; const vi = vis.findIndex(n => n.id === id);
        if (vi > 0) {
          if (_olSelected.size === 0) _olSelected.add(id);
          const targetId = vis[vi - 1].id;
          if (_olSelected.has(targetId)) {
            _olSelected.delete(id);
          } else {
            _olSelected.add(targetId);
          }
          _olShiftSelecting = true;
          _olFocusId = vis[vi - 1].id;
          olRender('ol-container', date);
          _olShiftSelecting = false;
        }
        return;
      }

      // Shift+↓: マルチセレクト（次の行も選択に追加）
      if (ev.key === 'ArrowDown' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.shiftKey) {
        ev.preventDefault();
        const vis = olGetVisibleForDate(nodes, date).visible; const vi = vis.findIndex(n => n.id === id);
        if (vi < vis.length - 1) {
          if (_olSelected.size === 0) _olSelected.add(id);
          const targetId = vis[vi + 1].id;
          if (_olSelected.has(targetId)) {
            _olSelected.delete(id);
          } else {
            _olSelected.add(targetId);
          }
          _olShiftSelecting = true;
          _olFocusId = vis[vi + 1].id;
          olRender('ol-container', date);
          _olShiftSelecting = false;
        }
        return;
      }

      // ↑: 前の可視ノードへ（Ctrl/Meta なし）
      if (ev.key === 'ArrowUp' && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        _olSelected.clear(); // 移動時は選択解除
        // フォーカスモード中は olGetVisibleForDate を使い、描画と同じ可視リストを参照する
        const vis = olGetVisibleForDate(nodes, date).visible;
        const vi = vis.findIndex(n => n.id === id);
        if (vi > 0) {
          ev.preventDefault();
          try { olSaveTxt(nodes, idx, ev.target); } catch(e) { console.error('olSave error:', e); }
          _olFocusId = vis[vi - 1].id;
          olRender('ol-container', date);
        } else if (vi === 0 && _olFocusMode && _olFocusMode.date === date) {
          // フォーカスモードの最初の子から↑ → パンくずタイトルへ戻る
          ev.preventDefault();
          try { olSaveTxt(nodes, idx, ev.target); } catch(e) {}
          _olFocusId = _olFocusMode.nodeId;
          olRender('ol-container', date);
        }
        return;
      }

      // ↓: 次の可視ノードへ（Ctrl/Meta なし）
      if (ev.key === 'ArrowDown' && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        _olSelected.clear(); // 移動時は選択解除
        // searchsummary が展開中なら最初の結果行にフォーカス移動
        if (nodes[idx] && nodes[idx].type === 'searchsummary' && !nodes[idx].collapsed) {
          const ssRow = document.querySelector(`#ol-container .ol-row-searchsummary[data-id="${id}"]`);
          const firstResult = ssRow && ssRow.nextElementSibling;
          if (firstResult && firstResult.classList.contains('ol-ss-result') && firstResult.tabIndex === 0) {
            ev.preventDefault();
            try { olSaveTxt(nodes, idx, ev.target); } catch(e) {}
            firstResult.focus();
            return;
          }
        }
        // フォーカスモード中は olGetVisibleForDate を使い、描画と同じ可視リストを参照する
        const vis = olGetVisibleForDate(nodes, date).visible;
        const vi = vis.findIndex(n => n.id === id);
        if (vi < vis.length - 1) {
          ev.preventDefault();
          try { olSaveTxt(nodes, idx, ev.target); } catch(e) { console.error('olSave error:', e); }
          _olFocusId = vis[vi + 1].id;
          olRender('ol-container', date);
        }
        return;
      }

      // Ctrl+C: マルチセレクト中（Shift+↑↓ / Shift+クリックで選択）は
      //   ・テキスト: 行テキストをシステムクリップボードへ書き込み
      //   ・構造: トップレベル選択ノード（サブツリーを含む）の深いコピーを _olMultiClipboard に保存
      //          ※ Ctrl+Shift+V で構造ペーストできるようにする
      // ※ 未選択時はブラウザのネイティブコピー動作に委ねる
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key === 'c' && _olSelected.size > 0) {
        ev.preventDefault();
        const vis = olGetVisibleForDate(nodes, date).visible;
        const lines = vis
          .filter(n => _olSelected.has(n.id))
          .map(n => ('  '.repeat(n.indent)) + (n.text || ''));
        const text = lines.join('\n');
        // 構造クリップボード（トップレベル選択ノード＋サブツリーを保存）
        const blocks = olCollectSelectionBlocks(nodes);
        const flatNodes = [];
        blocks.forEach(b => {
          for (let j = b.idx; j < b.idx + b.sub; j++) {
            flatNodes.push(JSON.parse(JSON.stringify(nodes[j])));
          }
        });
        _olMultiClipboard = { nodes: flatNodes, text, ts: Date.now() };
        navigator.clipboard.writeText(text)
          .then(() => showToast('📋 ' + _olSelected.size + '行をコピーしました（Ctrl+V でそのまま貼り付けられます）'))
          .catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
            showToast('📋 ' + _olSelected.size + '行をコピーしました（Ctrl+V でそのまま貼り付けられます）');
          });
        return;
      }

      // Ctrl+X: マルチセレクト中はコピー＋削除（カット）
      // ※ 単一選択時はブラウザのネイティブ動作に任せる
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key === 'x' && _olSelected.size >= 2) {
        ev.preventDefault();
        olPushHistory(date);
        olSaveTxt(nodes, idx, ev.target);
        const vis = olGetVisibleForDate(nodes, date).visible;
        const lines = vis
          .filter(n => _olSelected.has(n.id))
          .map(n => ('  '.repeat(n.indent)) + (n.text || ''));
        const text = lines.join('\n');
        // 構造クリップボードへ深いコピー
        const blocks = olCollectSelectionBlocks(nodes);
        const flatNodes = [];
        blocks.forEach(b => {
          for (let j = b.idx; j < b.idx + b.sub; j++) {
            flatNodes.push(JSON.parse(JSON.stringify(nodes[j])));
          }
        });
        _olMultiClipboard = { nodes: flatNodes, text, ts: Date.now() };
        // システムクリップボードにもテキスト書き込み
        navigator.clipboard.writeText(text).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); document.body.removeChild(ta);
        });
        // ノードを削除（トップレベルブロックを下から削除）
        const cutCount = flatNodes.length;
        for (let k = blocks.length - 1; k >= 0; k--) {
          nodes.splice(blocks[k].idx, blocks[k].sub);
        }
        if (nodes.length === 0) nodes.push({ id: olNewId(), text: '', indent: 0, bold: false, color: '', collapsed: false });
        _olSelected.clear();
        _olFocusId = nodes[Math.max(0, Math.min(idx, nodes.length - 1))].id;
        _olFocusAtStart = false;
        showToast('✂️ ' + cutCount + ' 件を切り取りました（Ctrl+V で貼り付け）');
        saveState(); olRender('ol-container', date);
        setTimeout(() => { if (typeof render === 'function') render(); }, 10);
        return;
      }

      // Ctrl+Shift+V: 構造ペースト（_olMultiClipboard があれば現在ノード後に挿入）
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === 'v' || ev.key === 'V')) {
        if (_olMultiClipboard && _olMultiClipboard.nodes && _olMultiClipboard.nodes.length > 0) {
          ev.preventDefault();
          olSaveTxt(nodes, idx, ev.target);
          olPasteMultiClipboard(date, id);
          return;
        }
        // クリップボード未設定時はネイティブ動作（プレーンテキスト）に委ねる
      }

      // Escape: 選択解除 → フォーカスモード終了 の順に処理
      if (ev.key === 'Escape' && _olSelected.size > 0) {
        ev.preventDefault();
        _olSelected.clear();
        olRender('ol-container', date);
        return;
      }
      // Escape: フォーカスモードを終了
      if (ev.key === 'Escape' && _olFocusMode && _olFocusMode.date === date) {
        ev.preventDefault();
        _olFocusMode = null;
        _olFocusId = id;
        olRender('ol-container', date); return;
      }

      // Alt+↓（Shiftなし）: そのノードにフォーカスモードでクローズアップ
      // 子ノードがない葉ノードでもズーム可能（パンくずのみ表示 → タイトル編集モード）
      if (ev.altKey && !ev.shiftKey && ev.key === 'ArrowDown') {
        ev.preventDefault();
        olSaveTxt(nodes, idx, ev.target);
        _olFocusMode = { date, nodeId: id };
        // 子ノードがあれば最初の子にフォーカス、なければ親（パンくず）自身にフォーカス
        const firstChild = nodes.slice(idx + 1).find(n => n.indent > nodes[idx].indent);
        _olFocusId = firstChild ? firstChild.id : id;
        olRender('ol-container', date); return;
      }

      // Alt+↑（Shiftなし）: フォーカスモードを終了（戻る）
      if (ev.altKey && !ev.shiftKey && ev.key === 'ArrowUp') {
        if (_olFocusMode && _olFocusMode.date === date) {
          ev.preventDefault();
          _olFocusMode = null;
          _olFocusId = id;
          olRender('ol-container', date); return;
        }
      }

      // Alt+Shift+↑: ノードをひとつ上の「同じ階層のノード」の前に移動
      //   複数選択中（連続範囲）はブロックとして移動。非連続なら警告。
      if (ev.altKey && ev.shiftKey && ev.key === 'ArrowUp') {
        ev.preventDefault();
        olPushHistory(date);
        olSaveTxt(nodes, idx, ev.target);
        // ── マルチセレクト分岐 ──
        if (_olSelected.size >= 2) {
          const range = olGetContiguousSelectionRange(nodes);
          if (!range || !range.contiguous) {
            showToast('⚠️ 選択範囲が連続していないため移動できません', true);
            return;
          }
          let prevSameIdx = -1;
          for (let i = range.startIdx - 1; i >= 0; i--) {
            if (nodes[i].indent === range.baseIndent) { prevSameIdx = i; break; }
            if (nodes[i].indent < range.baseIndent) break;
          }
          if (prevSameIdx >= 0) {
            const removed = nodes.splice(range.startIdx, range.count);
            nodes.splice(prevSameIdx, 0, ...removed);
            // フォーカスは元のフォーカスIDを維持
            saveState(); olRender('ol-container', date);
          }
          return;
        }
        // ── 単一ノード ──
        const myIndent = nodes[idx].indent;
        const subtree = olGetSubtree(nodes, idx);
        // 同じインデントの直前ノードを探す（それより深いノードはスキップ、親より浅ければ停止）
        let prevSameIdx = -1;
        for (let i = idx - 1; i >= 0; i--) {
          if (nodes[i].indent === myIndent) { prevSameIdx = i; break; }
          if (nodes[i].indent < myIndent) break; // 親に当たったら停止（それ以上は上がれない）
        }
        if (prevSameIdx >= 0) {
          const removed = nodes.splice(idx, subtree);
          nodes.splice(prevSameIdx, 0, ...removed);
          _olFocusId = id; saveState(); olRender('ol-container', date);
        }
        // 同じ階層の上ノードがない場合は何もしない
        return;
      }

      // Alt+Shift+↓: ノードをひとつ下の「同じ階層のノード」の後ろに移動
      //   複数選択中（連続範囲）はブロックとして移動。非連続なら警告。
      if (ev.altKey && ev.shiftKey && ev.key === 'ArrowDown') {
        ev.preventDefault();
        olPushHistory(date);
        olSaveTxt(nodes, idx, ev.target);
        // ── マルチセレクト分岐 ──
        if (_olSelected.size >= 2) {
          const range = olGetContiguousSelectionRange(nodes);
          if (!range || !range.contiguous) {
            showToast('⚠️ 選択範囲が連続していないため移動できません', true);
            return;
          }
          let nextSameIdx = -1;
          for (let i = range.endIdx + 1; i < nodes.length; i++) {
            if (nodes[i].indent === range.baseIndent) { nextSameIdx = i; break; }
            if (nodes[i].indent < range.baseIndent) break;
          }
          if (nextSameIdx >= 0) {
            const nextSubtree = olGetSubtree(nodes, nextSameIdx);
            const removed = nodes.splice(range.startIdx, range.count);
            const insertAt = (nextSameIdx - range.count) + nextSubtree;
            nodes.splice(insertAt, 0, ...removed);
            saveState(); olRender('ol-container', date);
          }
          return;
        }
        // ── 単一ノード ──
        const myIndent = nodes[idx].indent;
        const subtree = olGetSubtree(nodes, idx);
        const endIdx = idx + subtree;
        // 同じインデントの直後ノードを探す（深いノードはスキップ、浅くなったら停止）
        let nextSameIdx = -1;
        for (let i = endIdx; i < nodes.length; i++) {
          if (nodes[i].indent === myIndent) { nextSameIdx = i; break; }
          if (nodes[i].indent < myIndent) break; // 親の兄弟に当たったら停止
        }
        if (nextSameIdx >= 0) {
          const nextSubtree = olGetSubtree(nodes, nextSameIdx);
          const removed = nodes.splice(idx, subtree);
          // splice後にnextSameIdxはsubtreeぶん前にずれる
          const insertAt = (nextSameIdx - subtree) + nextSubtree;
          nodes.splice(insertAt, 0, ...removed);
          _olFocusId = id; saveState(); olRender('ol-container', date);
        }
        // 同じ階層の下ノードがない場合は何もしない
        return;
      }
    }

    // ノードのサブツリーサイズ（自身+子孫の数）を返す
    function olGetSubtree(nodes, idx) {
      const myI = nodes[idx].indent;
      let count = 1;
      for (let i = idx + 1; i < nodes.length; i++) {
        if (nodes[i].indent > myI) count++;
        else break;
      }
      return count;
    }

    // ── マルチセレクト共通ヘルパー ─────────────────────────────────────
    // _olSelected を「トップレベル」選択（先祖が選択されていないノード）の
    // インデックスとサブツリーサイズに整理して返す。連続性チェックにも使う。
    function olCollectSelectionBlocks(nodes) {
      if (!nodes || _olSelected.size === 0) return [];
      const selIdxs = [];
      nodes.forEach((n, i) => { if (_olSelected.has(n.id)) selIdxs.push(i); });
      if (selIdxs.length === 0) return [];
      selIdxs.sort((a, b) => a - b);
      const blocks = [];
      let lastEnd = -1;
      for (const i of selIdxs) {
        if (i < lastEnd) continue; // 既に上位ブロックに含まれる子孫
        const sub = olGetSubtree(nodes, i);
        blocks.push({ idx: i, sub });
        lastEnd = i + sub;
      }
      return blocks;
    }

    // 選択ブロック群が「連続範囲」を形成しているか判定し、その範囲を返す。
    // 戻り値: { contiguous, startIdx, endIdx, baseIndent, count } または null
    function olGetContiguousSelectionRange(nodes) {
      const blocks = olCollectSelectionBlocks(nodes);
      if (blocks.length === 0) return null;
      // 連続判定: 直前ブロックの末尾 == 次ブロックの開始
      for (let i = 1; i < blocks.length; i++) {
        if (blocks[i].idx !== blocks[i - 1].idx + blocks[i - 1].sub) {
          return { contiguous: false };
        }
      }
      const startIdx = blocks[0].idx;
      const last = blocks[blocks.length - 1];
      const endIdx = last.idx + last.sub - 1;
      const baseIndent = Math.min(...blocks.map(b => nodes[b.idx].indent));
      return {
        contiguous: true,
        startIdx, endIdx,
        baseIndent,
        count: endIdx - startIdx + 1
      };
    }

    // ── マルチセレクト: 選択ノード群を別の日へ移動 ────────────────────────
    // 選択中のトップレベルノード（とサブツリー）を fromDate から toDate へ移動。
    // 元の順序を保ち、移動先末尾に追加する。
    function olMoveSelectedToDate(fromDate, toDate) {
      if (_olSelected.size === 0) return;
      if (!fromDate || !toDate) return;
      if (fromDate === toDate) { showToast('同じ日です'); return; }
      const fromNodes = S.dailyOutline[fromDate];
      if (!fromNodes) return;
      olPushHistory(fromDate);
      const blocks = olCollectSelectionBlocks(fromNodes);
      if (blocks.length === 0) return;
      // 元の順序を保ったままノードを切り出す
      const flat = [];
      blocks.forEach(b => { for (let j = b.idx; j < b.idx + b.sub; j++) flat.push(fromNodes[j]); });
      // 高い idx から削除（下から）
      for (let k = blocks.length - 1; k >= 0; k--) {
        fromNodes.splice(blocks[k].idx, blocks[k].sub);
      }
      if (fromNodes.length === 0) {
        fromNodes.push({ id: olNewId(), text: '', indent: 0, bold: false, color: '', collapsed: false });
      }
      const toNodes = olGetNodes(toDate);
      const lastIsEmpty = toNodes.length > 0 && toNodes[toNodes.length - 1].text === '' && toNodes[toNodes.length - 1].indent === 0;
      const insertAt = lastIsEmpty ? toNodes.length - 1 : toNodes.length;
      toNodes.splice(insertAt, 0, ...flat);
      // フォーカスを移動先の先頭選択ノードに合わせる
      const firstId = flat.length > 0 ? flat[0].id : null;
      _olSelected.clear();
      // 移動先ノートに切り替え、グリッド週も追従
      saveState();
      if (!toDate.startsWith('proj:')) {
        const p = toDate.split('-').map(Number);
        const td = new Date(p[0], p[1] - 1, p[2]);
        const targetMonday = getMonday(td);
        const currentWeeks = getWeeks().map(w => wkey(w));
        const targetWk = wkey(td);
        if (!currentWeeks.includes(targetWk)) {
          const baseMonday = getMonday(new Date());
          const diffMs = targetMonday.getTime() - baseMonday.getTime();
          const diffWeeks = Math.round(diffMs / (7 * 24 * 3600 * 1000));
          S.wOff = diffWeeks;
        }
        // ラベル
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        const toLabel = p[1] + '月' + p[2] + '日（' + dayNames[td.getDay()] + '）';
        showToast('📅 ' + toLabel + ' に ' + flat.length + ' 件を移動しました');
      } else {
        showToast('📅 プロジェクトノートに ' + flat.length + ' 件を移動しました');
      }
      render();
      _olCurrentDate = toDate;
      if (firstId) _olFocusId = firstId;
      updateOlNav();
      olRender('ol-container', toDate);
      setTimeout(() => {
        if (firstId) {
          const el = document.getElementById('olt-' + firstId);
          if (el) {
            el.focus();
            try {
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            } catch (e) { }
          }
        }
      }, 60);
    }

    // ── マルチセレクト: 構造ペースト ────────────────────────────────
    // _olMultiClipboard.nodes を現在ノードの直後に挿入する。
    // インデントは「貼り付け先ノードの indent ＋ 元クリップボードの最小 indent との相対値」で正規化。
    function olPasteMultiClipboard(date, focusedId) {
      if (!_olMultiClipboard || !_olMultiClipboard.nodes || _olMultiClipboard.nodes.length === 0) return false;
      const nodes = olGetNodes(date);
      const idx = nodes.findIndex(n => n.id === focusedId);
      if (idx < 0) return false;
      olPushHistory(date);
      // 深いコピー＋新ID付与
      const baseIndent = nodes[idx].indent;
      const minClipIndent = Math.min(..._olMultiClipboard.nodes.map(n => n.indent || 0));
      const newNodes = _olMultiClipboard.nodes.map(n => {
        const copy = JSON.parse(JSON.stringify(n));
        copy.id = olNewId();
        copy.indent = baseIndent + ((n.indent || 0) - minClipIndent);
        // parentId は他ノードを指す可能性があるので一旦クリア
        delete copy.parentId;
        return copy;
      });
      // 挿入位置: フォーカスノードのサブツリー直後
      const sub = olGetSubtree(nodes, idx);
      const insertAt = idx + sub;
      nodes.splice(insertAt, 0, ...newNodes);
      _olSelected.clear();
      newNodes.forEach(n => _olSelected.add(n.id));
      _olFocusId = newNodes[newNodes.length - 1].id;
      _olFocusAtStart = false;
      saveState();
      olRender('ol-container', date);
      showToast('📋 ' + newNodes.length + ' 件をペーストしました');
      return true;
    }

    // ノートコンテナのペースト処理
    //   - システムクリップボードのテキストが `_olMultiClipboard.text` と一致 → 構造ペースト
    //   - 一致しない（外部からのペースト等）→ ネイティブ動作のまま
    //   - 外部から来た多行テキスト（先頭スペース等でインデントが表現されているもの）も
    //     2スペース＝1インデントで解釈して新規ノード群を作る
    function olContainerPaste(ev) {
      if (!_olCurrentDate) return;
      // ペースト対象が ol-text 内かを確認
      const target = ev.target;
      const olText = target && target.closest && target.closest('.ol-text');
      if (!olText) return;
      const id = olText.id ? olText.id.replace('olt-', '') : null;
      if (!id) return;
      const date = olText.getAttribute('data-date') || _olCurrentDate;
      const cd = ev.clipboardData || window.clipboardData;
      if (!cd) return;
      const clipText = cd.getData ? cd.getData('text/plain') : '';
      if (!clipText) return;

      // ① 内部マルチクリップボードと一致 → 構造ペースト
      if (_olMultiClipboard && _olMultiClipboard.nodes
          && _olMultiClipboard.nodes.length > 0
          && clipText === _olMultiClipboard.text) {
        ev.preventDefault();
        const nodes = olGetNodes(date);
        const idx = nodes.findIndex(n => n.id === id);
        if (idx >= 0) olSaveTxt(nodes, idx, olText);
        olPasteMultiClipboard(date, id);
        return;
      }

      // ② 外部からの多行テキスト → 2スペース＝1インデントでパースして複数ノード化
      //   - 単一行の場合はネイティブ動作（普通のテキストペースト）に任せる
      //   - 改行を含む場合のみインターセプト
      if (clipText.indexOf('\n') >= 0) {
        ev.preventDefault();
        olPushHistory(date);
        const nodes = olGetNodes(date);
        const idx = nodes.findIndex(n => n.id === id);
        if (idx < 0) return;
        olSaveTxt(nodes, idx, olText);
        const lines = clipText.split(/\r?\n/);
        // 先頭/末尾の完全空行をトリム（ただし中間の空行はノードとして残す）
        while (lines.length && lines[0].length === 0) lines.shift();
        while (lines.length && lines[lines.length - 1].length === 0) lines.pop();
        if (lines.length === 0) return;
        // インデント: 行頭スペース/タブ数から推定。タブは4スペース換算。
        const indents = lines.map(l => {
          const m = l.match(/^[ \t]*/);
          const w = m ? m[0].replace(/\t/g, '    ').length : 0;
          return Math.floor(w / 2);
        });
        const minClipIndent = Math.min(...indents);
        const baseIndent = nodes[idx].indent;
        const newNodes = lines.map((l, i) => ({
          id: olNewId(),
          text: l.replace(/^[ \t]+/, ''),
          html: '',
          indent: baseIndent + (indents[i] - minClipIndent),
          bold: false,
          color: '',
          collapsed: false,
          isTodo: false,
          checked: false,
          tags: [],
          isPrivate: false,
        }));
        const sub = olGetSubtree(nodes, idx);
        const insertAt = idx + sub;
        // 貼付先ノードが空（テキスト無し）なら最初のノードに置き換える方が自然
        if ((nodes[idx].text || '').trim() === '' && !nodes[idx].isTodo && !nodes[idx].html) {
          nodes[idx].text = newNodes[0].text;
          nodes[idx].indent = newNodes[0].indent;
          nodes.splice(insertAt, 0, ...newNodes.slice(1));
        } else {
          nodes.splice(insertAt, 0, ...newNodes);
        }
        _olSelected.clear();
        _olFocusId = newNodes[newNodes.length - 1].id;
        _olFocusAtStart = false;
        saveState();
        olRender('ol-container', date);
        showToast('📋 ' + newNodes.length + ' 行をペーストしました');
        return;
      }
      // 単一行は通常のテキストペースト（preventDefault しない）
    }

    // ノートコンテナのマウスダウン処理（Shift+クリックによる範囲選択）
    function olContainerMouseDown(ev) {
      if (!_olCurrentDate) return;
      if (!ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      // ボタン・トグル等は無視
      if (ev.target.closest('.ol-toggle,.ol-todo-cb,.ol-bullet,.ol-cb-area,.ol-nodelink-bullet,.ol-ss-bullet,.ol-collapsed-mark,.ol-subtask-count,.ol-tag-del,.ol-note-tag-chip,.ol-tag-proj,.ol-backlink-chip')) return;
      const row = ev.target.closest('.ol-row');
      if (!row) return;
      const targetId = row.getAttribute('data-id');
      if (!targetId) return;
      // contenteditable へのキャレット配置を抑止（選択状態を可視化するため）
      ev.preventDefault();
      const nodes = olGetNodes(_olCurrentDate);
      const vis = olGetVisibleForDate(nodes, _olCurrentDate).visible;
      let anchorIdx = vis.findIndex(n => n.id === _olFocusId);
      const targetIdx = vis.findIndex(n => n.id === targetId);
      if (targetIdx < 0) return;
      if (anchorIdx < 0) anchorIdx = targetIdx;
      const start = Math.min(anchorIdx, targetIdx);
      const end = Math.max(anchorIdx, targetIdx);
      _olSelected.clear();
      if (end > start) {
        for (let i = start; i <= end; i++) _olSelected.add(vis[i].id);
      }
      // 選択クリアを onfocus に邪魔されないようフラグを立てる
      _olMouseShift = true;
      _olFocusId = targetId;
      _olFocusAtStart = false;
      olRender('ol-container', _olCurrentDate);
      // 次フレームで解除（onfocus 反映後）
      setTimeout(() => { _olMouseShift = false; }, 0);
    }

    // ノートコンテナのクリック処理
    // - ol-text 上のクリック: ブラウザのネイティブカーソル配置に任せる
    // - ol-row 内（ol-text の右余白）クリック: その行の ol-text へカーソルを移動
    // - 完全な空白エリアクリック: Y座標に最も近い行へカーソルを移動
    function olContainerClick(ev) {
      if (!_olCurrentDate) return;

      // ── ノートエディタ内リンクのクリック処理 ──
      // contenteditable 内の <a> タグはブラウザがカーソル移動に使うため
      // 明示的にインターセプトしてリンクを開く
      const anchor = ev.target.closest('a[href]');
      if (anchor && anchor.closest('.ol-text')) {
        ev.preventDefault();
        const href = anchor.getAttribute('href');
        if (href && href !== '#') {
          const isWF = href.includes('workflowy.com');
          window.open(href, isWF ? 'workflowy-pane' : '_blank', 'noopener');
        }
        return;
      }

      // ol-text 上のクリックはブラウザのカーソル配置に完全に任せる
      if (ev.target.classList.contains('ol-text')) return;
      // トグルボタン・チップ等は無視
      if (ev.target.closest('.ol-toggle,.ol-linked-ref')) return;

      const nodes = olGetNodes(_olCurrentDate);
      const vis = olGetVisibleForDate(nodes, _olCurrentDate).visible;
      if (!vis.length) return;

      let targetOlText = null;

      // ol-row 内クリック → その行の ol-text にカーソルを移動（行末）
      const row = ev.target.closest('.ol-row');
      if (row) {
        targetOlText = row.querySelector('.ol-text');
      }

      // ol-row 外クリック → caretRangeFromPoint で最も近い ol-text を特定
      if (!targetOlText) {
        try {
          if (document.caretRangeFromPoint) {
            const range = document.caretRangeFromPoint(ev.clientX, ev.clientY);
            if (range) {
              let node = range.startContainer;
              while (node && node !== document.body) {
                if (node.nodeType === 1 && node.classList && node.classList.contains('ol-text')) { targetOlText = node; break; }
                node = node.parentNode;
              }
            }
          }
        } catch (e) { }
      }

      // さらに見つからない場合は Y 座標で最も近い ol-text を選択
      if (!targetOlText) {
        const allTexts = [...document.querySelectorAll('#ol-container .ol-text')];
        let best = null, bestDist = Infinity;
        allTexts.forEach(el => {
          const r = el.getBoundingClientRect();
          const dist = Math.abs(ev.clientY - (r.top + r.bottom) / 2);
          if (dist < bestDist) { bestDist = dist; best = el; }
        });
        targetOlText = best || document.querySelector('#ol-container .ol-text:last-of-type');
      }

      if (targetOlText) {
        const id = targetOlText.id.replace('olt-', '');
        if (id) {
          _olFocusId = id;
          targetOlText.focus();
          // カーソルを行末に配置
          try {
            const sel = window.getSelection();
            const r = document.createRange();
            r.selectNodeContents(targetOlText);
            r.collapse(false);
            sel.removeAllRanges(); sel.addRange(r);
          } catch (e) { }
        }
      }
    }

    // 折りたたみトグル
    function olToggle(date, id) {
      const nodes = olGetNodes(date);
      const node = nodes.find(n => n.id === id);
      if (node) { node.collapsed = !node.collapsed; saveState(); olRender('ol-container', date); }
    }

    // searchsummary 結果行のキーボードナビゲーション
    function olSsResultKeyDown(ev, el, date, ssParentId) {
      // 同じ親に属する tabindex 付き結果行を収集
      const container = document.getElementById('ol-container');
      const ssParentRow = container && container.querySelector(`.ol-row-searchsummary[data-id="${ssParentId}"]`);
      const allResults = [];
      if (ssParentRow) {
        let sib = ssParentRow.nextElementSibling;
        while (sib && sib.classList.contains('ol-ss-result')) {
          if (sib.tabIndex === 0) allResults.push(sib);
          sib = sib.nextElementSibling;
        }
      }
      const curIdx = allResults.indexOf(el);

      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (curIdx < allResults.length - 1) {
          allResults[curIdx + 1].focus();
        } else {
          // 最後の結果行 → 次の通常ノードへ
          const nodes = olGetNodes(date);
          const vis = olGetVisibleForDate(nodes, date).visible;
          const vi = vis.findIndex(n => n.id === ssParentId);
          if (vi >= 0 && vi < vis.length - 1) {
            _olFocusId = vis[vi + 1].id;
            olRender('ol-container', date);
          }
        }
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (curIdx > 0) {
          allResults[curIdx - 1].focus();
        } else {
          // 最初の結果行 → 親 searchsummary ノードへ
          _olFocusId = ssParentId;
          olRender('ol-container', date);
        }
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        el.click();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        _olFocusId = ssParentId;
        olRender('ol-container', date);
      } else if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key === 'ArrowUp') {
        // Ctrl+↑ で親 searchsummary を折りたたむ
        ev.preventDefault();
        olToggle(date, ssParentId);
      }
    }

    // 太字ボタン
    function olSetBold(date) {
      if (!_olFocusId) return;
      const nodes = olGetNodes(date);
      const el = document.getElementById('olt-' + _olFocusId);
      const node = nodes.find(n => n.id === _olFocusId);
      const idx = nodes.findIndex(n => n.id === _olFocusId);
      if (el && node && idx >= 0) { olSaveTxt(nodes, idx, el); node.bold = !node.bold; saveState(); olRender('ol-container', date); }
    }

    // カラーボタン（同じ色を再選択するとリセット）
    function olSetColor(date, color) {
      if (!_olFocusId) return;
      const nodes = olGetNodes(date);
      const el = document.getElementById('olt-' + _olFocusId);
      const node = nodes.find(n => n.id === _olFocusId);
      const idx = nodes.findIndex(n => n.id === _olFocusId);
      if (el && node && idx >= 0) { olSaveTxt(nodes, idx, el); node.color = (node.color === color) ? '' : color; saveState(); olRender('ol-container', date); }
    }

    // リンクモード: アウトラインをリンク選択モードで描画
    let _olSlashNodeId = null;
    let _olSlashDate = null;
    let _olSlashTrigger = '';

    // ノードリンク クリップボード: { nodeId, date, text }
    let _olLinkClipboard = null;

    // ノードリンクをクリックしてジャンプ先ノードへ移動
    function olJumpToLinkedNode(nodeId, dateStr) {
      if (!nodeId || !dateStr) { showToast('❌ リンク先情報が不正です', true); return; }
      const found = findNodeById(nodeId);
      if (!found) { showToast('❌ リンク先のノードが見つかりません（削除された可能性があります）', true); return; }
      openNotePanelToDate(dateStr, nodeId);
      showToast('🔖 リンク元へジャンプしました');
    }

    /* ===================================================================
       バックリンク ポップオーバー（このノードへのリンク元一覧）
       チップ「↩ N」クリックで呼ばれ、リンク元（type:'nodelink' で
       linkedNodeId が当該ノードを指すもの）を全件リスト表示する。
       ・各行: 「📅 日付（or 📂 プロジェクト名）／リンク元テキスト」
       ・行クリックで openNotePanelToDate(fromDate, fromId) でジャンプ
       ・外側クリック / Esc / 再度同じチップクリックで閉じる
    =================================================================== */

    /** ノードIDに対するバックリンク配列を一括集計（描画外で都度呼び出し可能）*/
    function _collectBacklinksFor(nodeId) {
      const out = [];
      if (!nodeId || !S.dailyOutline) return out;
      for (const d in S.dailyOutline) {
        const ns = S.dailyOutline[d];
        if (!Array.isArray(ns)) continue;
        for (const nd of ns) {
          if (nd.type === 'nodelink' && nd.linkedNodeId === nodeId) {
            out.push({ fromId: nd.id, fromDate: d, fromText: nd.text || '' });
          }
        }
      }
      return out;
    }

    /** 日付キーを表示用ラベルに整形（"YYYY-M-D" → "M/D（曜）"、"proj:N" → "📂 プロジェクト名"）*/
    function _formatBacklinkDateLabel(dateKey) {
      if (!dateKey) return '';
      if (dateKey.startsWith('proj:')) {
        const pi = parseInt(dateKey.split(':')[1]);
        const pName = (S.projects && S.projects[pi] && S.projects[pi].name) ? S.projects[pi].name : '不明なプロジェクト';
        return '📂 ' + pName;
      }
      const parts = dateKey.split('-').map(Number);
      if (parts.length !== 3) return dateKey;
      const dt = new Date(parts[0], parts[1] - 1, parts[2]);
      const dow = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()];
      const todayStr = todayDateStr();
      const isToday = dateKey === todayStr;
      return `📅 ${parts[1]}/${parts[2]}（${dow}）` + (isToday ? ' ★今日' : '');
    }

    let _olBacklinkPopupNodeId = null;

    /** バックリンクポップオーバー表示 */
    function showBacklinkPopup(nodeId, ev) {
      const pop = $('ol-backlink-popup');
      if (!pop) return;

      // 同じチップを再度クリックしたら閉じる（トグル）
      if (_olBacklinkPopupNodeId === nodeId && pop.style.display !== 'none') {
        hideBacklinkPopup();
        return;
      }

      const items = _collectBacklinksFor(nodeId);
      if (items.length === 0) { hideBacklinkPopup(); return; }

      // 日付の新しい順にソート（プロジェクトノートは末尾）
      items.sort((a, b) => {
        const ap = a.fromDate.startsWith('proj:') ? 1 : 0;
        const bp = b.fromDate.startsWith('proj:') ? 1 : 0;
        if (ap !== bp) return ap - bp;
        // 通常の日付同士は降順
        if (ap === 0) {
          const aPad = a.fromDate.split('-').map(s => s.padStart(4, '0')).join('-');
          const bPad = b.fromDate.split('-').map(s => s.padStart(4, '0')).join('-');
          return bPad.localeCompare(aPad);
        }
        return 0;
      });

      const cntEl = $('ol-bl-pop-count');
      const listEl = $('ol-bl-pop-list');
      if (cntEl) cntEl.textContent = items.length;
      if (listEl) {
        listEl.innerHTML = items.map(bl => {
          const dateLabel = _formatBacklinkDateLabel(bl.fromDate);
          const txt = bl.fromText && bl.fromText.trim() ? bl.fromText : '(無題)';
          return `<div class="ol-bl-pop-item" `
               + `onclick="event.stopPropagation();hideBacklinkPopup();openNotePanelToDate('${escA(bl.fromDate)}','${escA(bl.fromId)}')" `
               + `title="クリックでこのリンク元へジャンプ">`
               + `<div class="ol-bl-pop-date">${esc(dateLabel)}</div>`
               + `<div class="ol-bl-pop-text">${esc(txt)}</div>`
               + `</div>`;
        }).join('');
      }

      // 位置決定: クリック位置の少し下
      pop.style.display = 'block';
      pop.style.visibility = 'hidden'; // サイズ取得用に一旦見えなくする
      const rect = (ev && ev.currentTarget) ? ev.currentTarget.getBoundingClientRect() : null;
      const vw = window.innerWidth, vh = window.innerHeight;
      const popW = pop.offsetWidth || 320;
      const popH = pop.offsetHeight || 200;
      let x = rect ? rect.left : (vw / 2 - popW / 2);
      let y = rect ? rect.bottom + 4 : (vh / 2 - popH / 2);
      // 右端からはみ出さない
      if (x + popW > vw - 8) x = Math.max(8, vw - popW - 8);
      // 下端からはみ出すなら上に出す
      if (y + popH > vh - 8 && rect) {
        y = Math.max(8, rect.top - popH - 4);
      }
      pop.style.left = x + 'px';
      pop.style.top = y + 'px';
      pop.style.visibility = '';
      _olBacklinkPopupNodeId = nodeId;
    }

    /** バックリンクポップオーバーを閉じる */
    function hideBacklinkPopup() {
      const pop = $('ol-backlink-popup');
      if (pop) pop.style.display = 'none';
      _olBacklinkPopupNodeId = null;
    }

    // 外側クリック・Esc で閉じる（capture フェーズで早期にハンドル）
    document.addEventListener('mousedown', function(e) {
      const pop = $('ol-backlink-popup');
      if (!pop || pop.style.display === 'none') return;
      // ポップオーバー内 or バックリンクチップ自体のクリックは閉じない
      if (e.target.closest && (e.target.closest('#ol-backlink-popup') || e.target.closest('.ol-backlink-chip'))) return;
      hideBacklinkPopup();
    }, true);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        const pop = $('ol-backlink-popup');
        if (pop && pop.style.display !== 'none') {
          e.stopPropagation();
          hideBacklinkPopup();
        }
      }
    }, true);

    /* ===================================================================
       最近開いた日 ドロップダウン（_noteNavHistory から抽出）
       ol-nav の「📅 履歴」ボタンクリックで表示。重複除外で直近7件まで。
    =================================================================== */

    /** _noteNavHistory から重複除外で直近 N 件を返す（新しい順） */
    function _getRecentNoteDates(limit) {
      const seen = new Set();
      const out = [];
      // 末尾（新しい）から走査
      for (let i = _noteNavHistory.length - 1; i >= 0; i--) {
        const h = _noteNavHistory[i];
        if (!h || !h.date) continue;
        if (seen.has(h.date)) continue;
        seen.add(h.date);
        out.push(h.date);
        if (out.length >= limit) break;
      }
      // 履歴が少ない場合は、コンテンツがある日付からも補完
      if (out.length < limit && S.dailyOutline) {
        const candidates = [];
        for (const dk in S.dailyOutline) {
          if (dk.startsWith('_') || seen.has(dk)) continue;
          const ns = S.dailyOutline[dk];
          if (!Array.isArray(ns)) continue;
          if (!ns.some(n => n.text && n.text.trim())) continue;
          candidates.push(dk);
        }
        // proj: は後ろに、通常日付は新しい順に
        candidates.sort((a, b) => {
          const ap = a.startsWith('proj:') ? 1 : 0;
          const bp = b.startsWith('proj:') ? 1 : 0;
          if (ap !== bp) return ap - bp;
          if (ap === 0) {
            const aPad = a.split('-').map(s => s.padStart(4, '0')).join('-');
            const bPad = b.split('-').map(s => s.padStart(4, '0')).join('-');
            return bPad.localeCompare(aPad);
          }
          return 0;
        });
        for (const dk of candidates) {
          if (out.length >= limit) break;
          out.push(dk);
        }
      }
      return out;
    }

    /** 最近開いた日ポップオーバーのトグル */
    function toggleRecentNotePopup(ev) {
      const pop = $('ol-recent-popup');
      if (!pop) return;
      if (pop.style.display !== 'none') { closeRecentNotePopup(); return; }

      const dates = _getRecentNoteDates(7);
      const listEl = $('ol-recent-pop-list');
      if (listEl) {
        if (dates.length === 0) {
          listEl.innerHTML = `<div class="ol-recent-pop-empty">— まだ履歴がありません —</div>`;
        } else {
          listEl.innerHTML = dates.map(dk => {
            const label = _formatBacklinkDateLabel(dk);
            return `<div class="ol-recent-pop-item" `
                 + `onclick="event.stopPropagation();closeRecentNotePopup();openNotePanelToDate('${escA(dk)}',null)" `
                 + `title="クリックでこの日付を開く">${esc(label)}</div>`;
          }).join('');
        }
      }

      pop.style.display = 'block';
      pop.style.visibility = 'hidden';
      const rect = (ev && ev.currentTarget) ? ev.currentTarget.getBoundingClientRect() : null;
      const vw = window.innerWidth, vh = window.innerHeight;
      const popW = pop.offsetWidth || 220;
      const popH = pop.offsetHeight || 200;
      let x = rect ? rect.left : (vw / 2 - popW / 2);
      let y = rect ? rect.bottom + 4 : (vh / 2 - popH / 2);
      if (x + popW > vw - 8) x = Math.max(8, vw - popW - 8);
      if (y + popH > vh - 8 && rect) y = Math.max(8, rect.top - popH - 4);
      pop.style.left = x + 'px';
      pop.style.top = y + 'px';
      pop.style.visibility = '';
    }

    function closeRecentNotePopup() {
      const pop = $('ol-recent-popup');
      if (pop) pop.style.display = 'none';
    }

    // 外側クリック・Esc で閉じる
    document.addEventListener('mousedown', function(e) {
      const pop = $('ol-recent-popup');
      if (!pop || pop.style.display === 'none') return;
      if (e.target.closest && (e.target.closest('#ol-recent-popup') || e.target.closest('.ol-nav-recent'))) return;
      closeRecentNotePopup();
    }, true);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        const pop = $('ol-recent-popup');
        if (pop && pop.style.display !== 'none') {
          e.stopPropagation();
          closeRecentNotePopup();
        }
      }
    }, true);

    /* ===================================================================
       ノートペイン内インクリメンタル検索（Ctrl+;）
       現在の日のノードを対象に、入力文字列でフィルタする。
       マッチしないノードは半透明化、マッチノードは強調＋スクロール対象。
       Esc で終了、再度 Ctrl+; でトグル。
    =================================================================== */

    let _olIncSearchActive = false;
    let _olIncSearchQuery = '';

    function toggleIncSearchBar() {
      if (_olIncSearchActive) { closeIncSearchBar(); return; }
      openIncSearchBar();
    }

    function openIncSearchBar() {
      const bar = $('ol-incsearch-bar');
      const inp = $('ol-incsearch-input');
      if (!bar || !inp) return;
      bar.style.display = 'flex';
      _olIncSearchActive = true;
      inp.value = _olIncSearchQuery || '';
      // フォーカスを少し遅延
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
      olIncSearchRun(); // 既存クエリがあれば即フィルタ
    }

    function closeIncSearchBar() {
      const bar = $('ol-incsearch-bar');
      if (bar) bar.style.display = 'none';
      _olIncSearchActive = false;
      _olIncSearchQuery = '';
      _olApplyIncSearchHighlight(''); // ハイライトリセット
      // フォーカスを ol-container 内のフォーカス中ノードに戻す
      if (_olFocusId) {
        const el = document.getElementById('olt-' + _olFocusId);
        if (el) el.focus();
      }
    }

    function olIncSearchRun() {
      const inp = $('ol-incsearch-input');
      if (!inp) return;
      const q = (inp.value || '').trim();
      _olIncSearchQuery = q;
      _olApplyIncSearchHighlight(q);
    }

    function olIncSearchKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeIncSearchBar();
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        // 次マッチへスクロール（簡易実装: 最初の .ol-incsearch-hit にスクロール）
        const first = document.querySelector('#ol-container .ol-incsearch-hit');
        if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    /** クエリでノード行に .ol-incsearch-hit / .ol-incsearch-miss を付与 */
    function _olApplyIncSearchHighlight(q) {
      const container = $('ol-container');
      if (!container) return;
      const rows = container.querySelectorAll('.ol-row');
      const stat = $('ol-incsearch-stat');
      if (!q) {
        // リセット
        rows.forEach(r => { r.classList.remove('ol-incsearch-hit'); r.classList.remove('ol-incsearch-miss'); });
        if (stat) stat.textContent = '';
        return;
      }
      const qLc = q.toLowerCase();
      let hit = 0;
      rows.forEach(r => {
        const tx = r.querySelector('.ol-text');
        const txt = tx ? (tx.textContent || '') : '';
        if (txt.toLowerCase().includes(qLc)) {
          r.classList.add('ol-incsearch-hit');
          r.classList.remove('ol-incsearch-miss');
          hit++;
        } else {
          r.classList.remove('ol-incsearch-hit');
          r.classList.add('ol-incsearch-miss');
        }
      });
      if (stat) stat.textContent = hit > 0 ? `${hit} 件一致` : '一致なし';
    }

    /** olRender 後にハイライトを再適用するためのフック */
    function _olReapplyIncSearch() {
      if (_olIncSearchActive && _olIncSearchQuery) {
        _olApplyIncSearchHighlight(_olIncSearchQuery);
      }
    }

    /* ===================================================================
       プロジェクトノート 自動集約セクション（v1.4.3）
       プロジェクトノート（date = 'proj:N'）を開いたとき、末尾に「他の
       日次/プロジェクトノートでこのプロジェクトに紐付けられたノード」を
       日付ごとにグループ化して表示する。
       ・対象: `n.projTag === proj.name.replace(/\s+/g,'_')` のノード
       ・除外: プロジェクトノート自身、空テキスト、_ で始まるバーチャルキー
       ・各行クリックで openNotePanelToDate(date, id) でジャンプ
       ・折りたたみ状態は _projAggrCollapsed (Set<pi>) でセッション内保持
    =================================================================== */

    const _projAggrCollapsed = new Set();

    function toggleProjAggr(pi) {
      if (_projAggrCollapsed.has(pi)) _projAggrCollapsed.delete(pi);
      else _projAggrCollapsed.add(pi);
      if (_olCurrentDate === 'proj:' + pi) {
        // renderKey スキップ機構を無効化して強制再描画
        // （集約状態は renderKey に含めていないため、これがないとスキップされてしまう）
        _olLastRenderKey = '';
        olRender('ol-container', _olCurrentDate);
      }
    }

    /** ノード1行を集約セクション用 HTML として描画（depth は親からの相対インデント） */
    function _renderAggrItemHtml(dk, n, depth) {
      const txt = (n.text && n.text.trim()) ? n.text : '(無題)';
      let icon = '•';
      if (n.isTodo) icon = n.checked ? '☑' : '☐';
      else if (n.type === 'link') icon = '🔗';
      else if (n.type === 'nodelink') icon = '🔖';
      const doneCls = (n.isTodo && n.checked) ? ' done' : '';
      const depthCls = depth > 0 ? ' is-child' : '';
      const pad = 14 + depth * 16;
      return `<div class="ol-proj-aggr-item${doneCls}${depthCls}" `
           + `style="padding-left:${pad}px" `
           + `onclick="event.stopPropagation();openNotePanelToDate('${escA(dk)}','${escA(n.id)}')" `
           + `title="クリックで元ノードへジャンプ">`
           + `<span class="ol-proj-aggr-icon">${icon}</span>`
           + `<span class="ol-proj-aggr-text">${esc(txt)}</span>`
           + `</div>`;
    }

    function _renderProjectAggregateSection(container, pi) {
      if (!container) return;
      const proj = S.projects && S.projects[pi];
      if (!proj) return;
      const projTag = (proj.name || '').replace(/\s+/g, '_');
      if (!projTag) return;
      const selfKey = 'proj:' + pi;

      // 集約対象を収集（v1.4.4: 親+サブツリーを1グループとして取り込む）
      // - 親ノード: n.projTag === projTag を直接持つもの
      // - 子孫: その親の indent より深い後続ノード（次の同レベル以下まで）
      // - 完了非表示（_hideDone）が ON のとき:
      //     親自身が完了TODOなら、サブツリーごとスキップ（コンテキスト保持のため）
      //     子孫の中に完了TODOがあればその行のみ除外
      const groups = []; // [{date, root, descendants:[node]}]
      let totalRootCount = 0;
      let totalDescCount = 0;

      if (S.dailyOutline) {
        for (const dk in S.dailyOutline) {
          if (!dk || dk.startsWith('_')) continue;
          if (dk === selfKey) continue;
          const ns = S.dailyOutline[dk];
          if (!Array.isArray(ns)) continue;

          for (let i = 0; i < ns.length; i++) {
            const root = ns[i];
            if (!root || root.projTag !== projTag) continue;
            if (!root.text || !root.text.trim()) continue;
            if (_hideDone && root.isTodo && root.checked) continue; // 親自体が除外

            const myInd = root.indent || 0;
            const descendants = [];
            for (let j = i + 1; j < ns.length; j++) {
              const nd = ns[j];
              const ndInd = nd.indent || 0;
              if (ndInd <= myInd) break; // サブツリー終端
              if (!nd.text || !nd.text.trim()) continue;
              if (_hideDone && nd.isTodo && nd.checked) continue;
              descendants.push(nd);
            }
            groups.push({ date: dk, root, descendants });
            totalRootCount++;
            totalDescCount += descendants.length;
          }
        }
      }

      if (groups.length === 0) return;

      // 日付の新しい順にソート（プロジェクト発のものは末尾）
      groups.sort((a, b) => {
        const ap = a.date.startsWith('proj:') ? 1 : 0;
        const bp = b.date.startsWith('proj:') ? 1 : 0;
        if (ap !== bp) return ap - bp;
        if (ap === 0) {
          const aPad = a.date.split('-').map(s => s.padStart(4, '0')).join('-');
          const bPad = b.date.split('-').map(s => s.padStart(4, '0')).join('-');
          return bPad.localeCompare(aPad);
        }
        return a.date.localeCompare(b.date);
      });

      // 日付ごとにグループ化（挿入順を維持）
      const byDate = new Map();
      groups.forEach(g => {
        if (!byDate.has(g.date)) byDate.set(g.date, []);
        byDate.get(g.date).push(g);
      });

      const total = totalRootCount + totalDescCount;
      const collapsed = _projAggrCollapsed.has(pi);
      const countLabel = totalDescCount > 0
        ? `${total}件（親${totalRootCount}+子孫${totalDescCount}）/ ${byDate.size}日`
        : `${total}件 / ${byDate.size}日`;

      let html = `<div class="ol-proj-aggr" data-pi="${pi}">`
               + `<div class="ol-proj-aggr-header" onclick="event.stopPropagation();toggleProjAggr(${pi})" title="折りたたみ / 展開">`
               + `<span class="ol-proj-aggr-arrow">${collapsed ? '▶' : '▼'}</span>`
               + `<span>📥 このプロジェクトに紐付くノード</span>`
               + `<span class="ol-proj-aggr-count">${countLabel}</span>`
               + `</div>`;

      if (!collapsed) {
        html += `<div class="ol-proj-aggr-body">`;
        for (const [dk, gs] of byDate.entries()) {
          const dateLabel = _formatBacklinkDateLabel(dk);
          html += `<div class="ol-proj-aggr-day">`
               + `<div class="ol-proj-aggr-date" onclick="event.stopPropagation();openNotePanelToDate('${escA(dk)}',null)" title="この日付を開く">${esc(dateLabel)}</div>`;
          gs.forEach(g => {
            const baseInd = g.root.indent || 0;
            // 親
            html += _renderAggrItemHtml(dk, g.root, 0);
            // 子孫（親からの相対 depth で表示インデント）
            g.descendants.forEach(c => {
              const rel = Math.max(1, (c.indent || 0) - baseInd);
              html += _renderAggrItemHtml(dk, c, rel);
            });
          });
          html += `</div>`;
        }
        html += `</div>`;
      }

      html += `</div>`;

      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      if (wrap.firstChild) container.appendChild(wrap.firstChild);
    }

    // サブタスク参照行の展開/折りたたみ（フォーカス中ノード限定）
    function olToggleRefRows() {
      _olRefRowsExpanded = !_olRefRowsExpanded;
      if (_olCurrentDate) olRender('ol-container', _olCurrentDate);
    }

    function olToggleTodo(date, id) {
      const nodes = olGetNodes(date);
      const n = nodes.find(x => x.id === id);
      if (n) {
        n.checked = !n.checked;
        saveState();
        olRender('ol-container', date);
        render();
        if (todoOpen) renderTodo();
      }
    }


    function openOlSlashMenuFromBtn(btnEl) {
      if (!_olFocusId || !_olCurrentDate) return;
      const nodes = olGetNodes(_olCurrentDate);
      const idx = nodes.findIndex(n => n.id === _olFocusId);
      if (idx < 0) return;
      const inputEl = document.getElementById('olt-' + _olFocusId);
      if (inputEl) olSaveTxt(nodes, idx, inputEl);

      _olSlashNodeId = _olFocusId;
      _olSlashDate = _olCurrentDate;
      _olSlashTrigger = '';
      // マルチセレクト中ならスナップショットを保持（applyOlSlashCommand で参照）
      _olSlashMulti = (_olSelected.size >= 2) ? new Set(_olSelected) : null;

      const rect = btnEl.getBoundingClientRect();
      showOlSlashMenuAt(rect.left, rect.bottom + 4, rect.top);
    }

    function openOlSlashMenuFromKeyboard(id, date) {
      const nodes = olGetNodes(date);
      const idx = nodes.findIndex(n => n.id === id);
      if (idx < 0) return;
      const inputEl = document.getElementById('olt-' + id);
      if (inputEl) olSaveTxt(nodes, idx, inputEl);

      _olSlashNodeId = id;
      _olSlashDate = date;
      _olSlashTrigger = '';
      // マルチセレクト中ならスナップショットを保持（applyOlSlashCommand で参照）
      _olSlashMulti = (_olSelected.size >= 2) ? new Set(_olSelected) : null;

      // カーソル位置を取得。空ノードだとゼロ矩形になるので elRect にフォールバック
      const sel = window.getSelection();
      let cursorRect = null;
      if (sel && sel.rangeCount > 0) {
        const cr = sel.getRangeAt(0).getBoundingClientRect();
        // left=0 & top=0 はゼロ矩形（空テキスト等）なので無視
        if (cr && (cr.left > 0 || cr.top > 0)) cursorRect = cr;
      }
      if (cursorRect) {
        showOlSlashMenuAt(cursorRect.left, cursorRect.bottom + 4, cursorRect.top);
      } else if (inputEl) {
        const elRect = inputEl.getBoundingClientRect();
        showOlSlashMenuAt(elRect.left + 4, elRect.bottom + 4, elRect.top);
      }
    }

    function showOlSlashMenuAt(x, y, anchorTop) {
      // anchorTop: カーソル上端のY座標（上方向に表示するときに使う）
      const menu = $('ol-slash-menu');
      if (!menu) return;
      // 常にメイン階層からスタート（サイズ確定のため先に表示）
      const main = menu.querySelector('#slash-menu-main');
      const color = menu.querySelector('#slash-menu-color');
      const dateDiv = menu.querySelector('#slash-menu-date');
      if (main) main.style.display = 'block';
      if (color) color.style.display = 'none';
      if (dateDiv) dateDiv.style.display = 'none';
      menu.classList.add('open');

      // メニューの実サイズを取得してビューポートに収まるよう調整
      const mw = menu.offsetWidth || 200;
      const mh = menu.offsetHeight || 260;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const MARGIN = 8;

      // 左右: 右端からはみ出すなら左にずらす
      let finalX = Math.min(x, vw - mw - MARGIN);
      finalX = Math.max(MARGIN, finalX);

      // 上下: 下端からはみ出すなら上に表示（カーソルより上）
      let finalY = y;
      if (y + mh > vh - MARGIN) {
        // 上方向に表示: anchorTop が渡されていればそこから上、なければ y から上
        const topAnchor = (anchorTop !== undefined) ? anchorTop : y;
        finalY = topAnchor - mh - 4;
      }
      finalY = Math.max(MARGIN, finalY);

      menu.style.left = finalX + 'px';
      menu.style.top = finalY + 'px';

      // ペースト待機中のアイテムを表示切り替え
      const pasteItem = $('slash-paste-link-item');
      if (pasteItem) pasteItem.style.display = _olLinkClipboard ? 'flex' : 'none';

      // アクティブ状態をリセット（貼り付けアイテムが表示中ならそちらをアクティブに）
      const items = main ? main.querySelectorAll('.slash-item') : menu.querySelectorAll('.slash-item');
      menu.querySelectorAll('.slash-item').forEach(el => el.classList.remove('active'));
      const visibleItems = Array.from(items).filter(el => el.style.display !== 'none');
      if (visibleItems.length > 0) visibleItems[0].classList.add('active');
    }

    function hideOlSlashMenu() {
      const menu = $('ol-slash-menu');
      if (menu) menu.classList.remove('open');
      // _olSlashNodeId = null; // ここでクリアせず、呼び出し元で制御する
    }

    // ─── インラインURLポップオーバー ───────────────────────────────────
    function _openOlUrlPopup() {
      const popup = $('ol-url-popup');
      const inp = $('ol-url-input-field');
      if (!popup || !inp) return;

      // ノード行の直下に配置
      const nodeEl = document.getElementById('olt-' + _olSlashNodeId);
      if (nodeEl) {
        const rect = nodeEl.closest('.ol-row')?.getBoundingClientRect() || nodeEl.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom + 6;
        // 画面右端からはみ出す場合は左にずらす
        const popupW = 300;
        if (left + popupW > window.innerWidth - 16) left = window.innerWidth - popupW - 16;
        popup.style.left = Math.max(8, left) + 'px';
        popup.style.top = top + 'px';
      } else {
        popup.style.left = '50%'; popup.style.top = '40%';
        popup.style.transform = 'translateX(-50%)';
      }

      // 既存のURLがあれば初期値として設定
      const existingNodes = olGetNodes(_olSlashDate || _olCurrentDate);
      const existingNode = existingNodes.find(x => x.id === _olSlashNodeId);
      inp.value = (existingNode && existingNode.url) || '';
      popup.style.display = 'block';
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
    }

    function _closeOlUrlPopup() {
      const popup = $('ol-url-popup');
      if (popup) { popup.style.display = 'none'; popup.style.transform = ''; }
    }

    function _applyOlUrlInput() {
      const inp = $('ol-url-input-field');
      if (!inp) return;
      let url = inp.value.trim();
      // プロトコルが省略されていれば補完
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      _closeOlUrlPopup();

      if (!_olSlashNodeId || !_olSlashDate) return;
      const nodes = olGetNodes(_olSlashDate);
      const n = nodes.find(x => x.id === _olSlashNodeId);
      if (!n) return;

      if (url) {
        n.type = 'link'; n.isTodo = false; n.url = url;
        if (!n.text) { n.text = url; n.html = esc(url); }
      }
      // URL が空のままEnterした場合はキャンセル扱い（何もしない）
      _olFocusId = _olSlashNodeId;
      saveState();
      olRender('ol-container', _olSlashDate);
      render();
    }

    function _olUrlInputKey(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); _applyOlUrlInput(); }
      if (ev.key === 'Escape') { ev.preventDefault(); _closeOlUrlPopup(); }
    }

    // ポップオーバー外クリックで閉じる
    document.addEventListener('mousedown', ev => {
      const popup = $('ol-url-popup');
      if (popup && popup.style.display !== 'none' && !popup.contains(ev.target)) {
        _closeOlUrlPopup();
      }
      // リンク編集ポップアップ外クリックで閉じる
      const lep = $('ol-link-edit-popup');
      if (lep && lep.style.display !== 'none' && !lep.contains(ev.target)) {
        _olLinkEditClose();
      }
    });

    // Close menu when clicking outside
    document.addEventListener('mousedown', e => {
      const menu = $('ol-slash-menu');
      if (menu && menu.classList.contains('open') && !menu.contains(e.target) && !e.target.closest('.ol-tbtn')) {
        hideOlSlashMenu();
      }
      const pmenu = $('ol-proj-menu');
      if (pmenu && pmenu.classList.contains('open') && !pmenu.contains(e.target) && !e.target.closest('.ol-tbtn')) {
        hideOlProjMenu();
      }
    });

    function applyOlSlashCommand(cmd) {
      // サブ階層の表示切り替え（画面を閉じない）
      if (cmd === 'submenu_color') {
        const menu = $('ol-slash-menu');
        menu.querySelector('#slash-menu-main').style.display = 'none';
        const colorMenu = menu.querySelector('#slash-menu-color');
        colorMenu.style.display = 'block';

        // アクティブをリセットして先頭へ (戻るボタンをアクティブに)
        menu.querySelectorAll('.slash-item').forEach(el => el.classList.remove('active'));
        colorMenu.querySelectorAll('.slash-item')[0].classList.add('active');
        return;
      }
      if (cmd === 'submenu_date') {
        const menu = $('ol-slash-menu');
        menu.querySelector('#slash-menu-main').style.display = 'none';
        menu.querySelector('#slash-menu-color').style.display = 'none';
        const dateDiv = menu.querySelector('#slash-menu-date');
        dateDiv.style.display = 'block';
        // 日付入力に現在のスラッシュノードの日付を初期値としてセット
        const inp = $('slash-date-input');
        if (inp) {
          const srcDate = _olSlashDate || '';
          if (srcDate && !srcDate.startsWith('proj:')) {
            const parts = srcDate.split('-').map(x => x.padStart(2, '0'));
            inp.value = parts.join('-');
          } else {
            const td = new Date();
            inp.value = td.getFullYear() + '-' + String(td.getMonth()+1).padStart(2,'0') + '-' + String(td.getDate()).padStart(2,'0');
          }
          olSlashDateUpdatePreview();
          setTimeout(() => inp.focus(), 50);
        }
        return;
      }
      if (cmd === 'submenu_main') {
        const menu = $('ol-slash-menu');
        menu.querySelector('#slash-menu-main').style.display = 'block';
        menu.querySelector('#slash-menu-color').style.display = 'none';
        const dateDiv = menu.querySelector('#slash-menu-date');
        if (dateDiv) dateDiv.style.display = 'none';

        // アクティブを「色変更メニュー」または「別の日に移動」の場所に戻す
        menu.querySelectorAll('.slash-item').forEach(el => el.classList.remove('active'));
        const items = menu.querySelector('#slash-menu-main').querySelectorAll('.slash-item');
        // "文字色"の項目(6番目、0-based index=6)をアクティブにする
        if (items.length > 6) items[6].classList.add('active');
        return;
      }

      if (!_olSlashNodeId || !_olSlashDate) return;
      const nodes = olGetNodes(_olSlashDate);
      const n = nodes.find(x => x.id === _olSlashNodeId);
      if (!n) return;

      // ── 挿入系: 表 ──────────────────────────────────────────────────
      if (cmd === 'insert_table') {
        hideOlSlashMenu();
        // スラッシュトリガー文字を除去
        if (_olSlashTrigger) {
          const elT = document.getElementById('olt-' + _olSlashNodeId);
          if (elT) {
            const tT = elT.textContent;
            if (tT.endsWith(_olSlashTrigger)) { const ntT = tT.slice(0, -_olSlashTrigger.length); elT.textContent = ntT; n.text = ntT; n.html = ntT; }
          }
        }
        _olFocusId = n.id;
        olInsertTable();
        return;
      }

      // ── 挿入系: 画像 ────────────────────────────────────────────────
      if (cmd === 'insert_image') {
        hideOlSlashMenu();
        if (_olSlashTrigger) {
          const elI = document.getElementById('olt-' + _olSlashNodeId);
          if (elI) {
            const tI = elI.textContent;
            if (tI.endsWith(_olSlashTrigger)) { const ntI = tI.slice(0, -_olSlashTrigger.length); elI.textContent = ntI; n.text = ntI; n.html = ntI; }
          }
        }
        _olFocusId = n.id;
        olInsertImageFile();
        return;
      }

      // ── ノードリンク: 生成 ────────────────────────────────────────────
      if (cmd === 'copy_link') {
        _olLinkClipboard = { nodeId: n.id, date: _olSlashDate, text: n.text };
        hideOlSlashMenu();
        showToast('🔖 リンクをコピーしました。貼り付け先で Ctrl+. →「ここに貼り付け」を選択');
        return;
      }

      // ── ノードリンク: 貼り付け ────────────────────────────────────────
      if (cmd === 'paste_link') {
        if (!_olLinkClipboard) { hideOlSlashMenu(); return; }
        // リンク元テキストを最新化
        const srcFound = findNodeById(_olLinkClipboard.nodeId);
        const srcText = srcFound ? (srcFound.node.text || _olLinkClipboard.text) : _olLinkClipboard.text;
        const newNode = {
          id: olNewId(),
          text: srcText,
          html: '',
          type: 'nodelink',
          linkedNodeId: _olLinkClipboard.nodeId,
          linkedNodeDate: _olLinkClipboard.date,
          indent: n.indent,
          bold: false,
          color: '',
          collapsed: false,
          isTodo: false,
          checked: false,
          tags: [],
          images: []
        };
        const insertAt = nodes.indexOf(n) + 1;
        nodes.splice(insertAt, 0, newNode);
        _olLinkClipboard = null; // 貼り付け後はクリア
        hideOlSlashMenu();
        olPushHistory(_olSlashDate);
        saveState();
        _olFocusId = newNode.id;
        olRender('ol-container', _olSlashDate);
        showToast('📌 ノードリンクを貼り付けました');
        return;
      }

      if (cmd === 'link') {
        // テキストが既にURLなら即変換、そうでなければURLポップオーバーを表示
        const isUrl = /^https?:\/\/.+/.test(n.text.trim());
        if (isUrl) {
          n.type = 'link'; n.isTodo = false; n.url = n.text.trim();
        } else {
          // トリガー文字を除去してからポップオーバーを表示
          if (_olSlashTrigger) {
            const el2 = document.getElementById('olt-' + _olSlashNodeId);
            if (el2) {
              const t2 = el2.textContent;
              if (t2.endsWith(_olSlashTrigger)) { const nt = t2.slice(0, -_olSlashTrigger.length); el2.textContent = nt; n.text = nt; n.html = nt; }
            }
          }
          hideOlSlashMenu();
          saveState();
          _openOlUrlPopup();
          return; // ポップオーバー確定後に type 変更するため、ここでは return
        }
      } else if (cmd === 'unlink') {
        // リンク解除: log に戻し url を空に
        n.type = 'log'; n.isTodo = false; n.url = '';
      } else if (cmd === 'todo') {
        n.isTodo = true;
        n.type = 'todo';
        n.checked = false;
      } else if (cmd === 'bullet') {
        n.isTodo = false;
        n.type = 'log';
        n.url = ''; // リンクからドットに戻す場合もURLをクリア
      } else if (cmd === 'bold') {
        n.bold = !n.bold;
      } else if (cmd === 'private') {
        n.isPrivate = !n.isPrivate;
        showToast(n.isPrivate ? '🔒 プライベートに設定しました' : '🔓 プライベート解除しました');
      } else if (cmd.startsWith('color_')) {
        const hex = cmd.replace('color_', '');
        n.color = hex;
      } else if (cmd.startsWith('move_date_')) {
        // ── 日付移動: ノード＋サブツリーを別の日へ移動 ──
        const targetDateStr = cmd.replace('move_date_', '');
        if (!targetDateStr) return;
        // スラッシュトリガー文字を除去
        if (_olSlashTrigger) {
          const el3 = document.getElementById('olt-' + _olSlashNodeId);
          if (el3) {
            const t3 = el3.textContent;
            if (t3.endsWith(_olSlashTrigger)) { const nt3 = t3.slice(0, -_olSlashTrigger.length); el3.textContent = nt3; n.text = nt3; n.html = nt3; }
          }
        }
        hideOlSlashMenu();
        // マルチセレクトモード時は選択ノード群をまとめて移動
        if (_olSlashMulti && _olSlashMulti.size >= 2) {
          // _olSelected を一時的にスナップショットへ戻す（ユーザーが間に解除した場合に備える）
          _olSelected = new Set(_olSlashMulti);
          _olSlashMulti = null;
          olMoveSelectedToDate(_olSlashDate, targetDateStr);
        } else {
          _olSlashMulti = null;
          olMoveNodeToDate(_olSlashNodeId, _olSlashDate, targetDateStr);
        }
        return; // olMove*ToDate 内で saveState/render 済み
      }

      // 文字列からトリガー (/, ・, ／) を除去
      if (_olSlashTrigger) {
        const el = document.getElementById('olt-' + _olSlashNodeId);
        if (el) {
          const txt = el.textContent;
          if (txt.endsWith(_olSlashTrigger)) {
            const newTxt = txt.slice(0, -_olSlashTrigger.length);
            el.textContent = newTxt;
            n.text = newTxt;
            n.html = newTxt;
          }
        }
      }

      hideOlSlashMenu();
      saveState();
      // まずノート側を再描画
      olRender('ol-container', _olSlashDate);

      // グリッド即時反映（フォーカス維持の仕組みは olInput と同様）
      const focusedEl = document.activeElement;
      let savedRange = null;
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
      } catch (e) { }

      render();

      if (focusedEl) {
        focusedEl.focus();
        if (savedRange) {
          try {
            const sel = window.getSelection();
            sel.removeAllRanges(); sel.addRange(savedRange);
          } catch (e) { }
        }
      }

      // Restore focus to the end (if needed)
      setTimeout(() => {
        const nextEl = document.getElementById('olt-' + _olSlashNodeId);
        if (nextEl) {
          nextEl.focus();
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(nextEl);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (e) { }
        }
      }, 10);
    }

    // ── 日付移動: スラッシュコマンド用ヘルパー ──────────────────────────────────

    // YYYY-M-D (内部形式) を <input type="date"> の YYYY-MM-DD に変換
    function _dateStrToInput(s) {
      if (!s || s.startsWith('proj:')) return '';
      const p = s.split('-');
      if (p.length !== 3) return '';
      return p[0] + '-' + p[1].padStart(2, '0') + '-' + p[2].padStart(2, '0');
    }
    // <input type="date"> の YYYY-MM-DD を内部形式 YYYY-M-D に変換
    function _inputToDateStr(v) {
      if (!v) return '';
      const p = v.split('-').map(Number);
      if (p.length !== 3 || isNaN(p[0])) return '';
      return p[0] + '-' + p[1] + '-' + p[2];
    }
    // 相対日数を基準に quick-set
    function olSlashDateQuick(deltaDays) {
      const inp = $('slash-date-input');
      if (!inp) return;
      const base = _olSlashDate && !_olSlashDate.startsWith('proj:') ? _olSlashDate : null;
      const baseDate = base ? (() => { const p = base.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); })() : new Date();
      const target = new Date(baseDate);
      target.setDate(target.getDate() + deltaDays);
      inp.value = target.getFullYear() + '-' + String(target.getMonth()+1).padStart(2,'0') + '-' + String(target.getDate()).padStart(2,'0');
      olSlashDateUpdatePreview();
    }
    function olSlashDateUpdatePreview() {
      const inp = $('slash-date-input');
      const prev = $('slash-date-preview');
      if (!inp || !prev) return;
      const v = inp.value;
      if (!v) { prev.textContent = ''; return; }
      const p = v.split('-').map(Number);
      if (p.length !== 3 || isNaN(p[0])) { prev.textContent = ''; return; }
      const d = new Date(p[0], p[1]-1, p[2]);
      const days = ['日','月','火','水','木','金','土'];
      const todayStr = todayDateStr();
      const tgt = p[0] + '-' + p[1] + '-' + p[2];
      const suffix = tgt === todayStr ? ' ★今日' : '';
      prev.textContent = p[0] + '年' + p[1] + '月' + p[2] + '日（' + days[d.getDay()] + '）' + suffix;
    }
    function olSlashDateConfirm() {
      const inp = $('slash-date-input');
      if (!inp || !inp.value) return;
      const targetDateStr = _inputToDateStr(inp.value);
      if (!targetDateStr) return;
      applyOlSlashCommand('move_date_' + targetDateStr);
    }

    // ── ノード＋サブツリーを別の日に移動する中心ロジック ──────────────────────
    function olMoveNodeToDate(nodeId, fromDate, toDate) {
      if (!nodeId || !fromDate || !toDate || fromDate === toDate) {
        if (fromDate === toDate) showToast('同じ日です');
        return;
      }
      const fromNodes = S.dailyOutline[fromDate];
      if (!fromNodes) return;
      const idx = fromNodes.findIndex(n => n.id === nodeId);
      if (idx < 0) return;

      const subtreeCount = olGetSubtree(fromNodes, idx);
      const moved = fromNodes.splice(idx, subtreeCount);

      // fromNodes が空になったら空ノードを補完
      if (fromNodes.length === 0) {
        fromNodes.push({ id: olNewId(), text: '', indent: 0, bold: false, color: '', collapsed: false });
      }

      // 移動先ノード配列の末尾に追加（最後の空ノードの前に挿入）
      const toNodes = olGetNodes(toDate);
      const lastIsEmpty = toNodes.length > 0 && toNodes[toNodes.length - 1].text === '' && toNodes[toNodes.length - 1].indent === 0;
      const insertAt = lastIsEmpty ? toNodes.length - 1 : toNodes.length;
      toNodes.splice(insertAt, 0, ...moved);

      // 曜日ラベル生成
      const p = toDate.split('-').map(Number);
      const td = new Date(p[0], p[1]-1, p[2]);
      const dayNames = ['日','月','火','水','木','金','土'];
      const toLabel = p[1] + '月' + p[2] + '日（' + dayNames[td.getDay()] + '）';

      showToast('📅 ' + toLabel + ' に移動しました（' + subtreeCount + '件）');
      saveState();

      // グリッドの週表示を調整: toDate が現在の表示範囲外なら wOff を変更
      if (!toDate.startsWith('proj:')) {
        const targetMonday = getMonday(td);
        const currentWeeks = getWeeks().map(w => wkey(w));
        const targetWk = wkey(td);
        if (!currentWeeks.includes(targetWk)) {
          // toDate が何週先/前かを計算して wOff を調整
          const baseMonday = getMonday(new Date());
          const diffMs = targetMonday.getTime() - baseMonday.getTime();
          const diffWeeks = Math.round(diffMs / (7 * 24 * 3600 * 1000));
          S.wOff = diffWeeks;
        }
      }

      render();

      // ノートパネルを移動先の日付に切り替え
      _olCurrentDate = toDate;
      _olFocusId = nodeId;
      updateOlNav();
      olRender('ol-container', toDate);
      // フォーカスを移動先ノードに復元
      setTimeout(() => {
        const el = document.getElementById('olt-' + nodeId);
        if (el) {
          el.focus();
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (e) { }
        }
      }, 60);
    }

    let _olProjNodeId = null;
    let _olProjDate = null;
    let _olProjTrigger = '';

    function buildOlProjMenu() {
      const menu = $('ol-proj-menu');
      if (!menu) return;
      let html = '';
      if (S.projects.length === 0) {
        html = `<div style="padding:6px;color:var(--tx3);font-size:11px">プロジェクトがありません</div>`;
      } else {
        S.projects.forEach((p, i) => {
          html += `<div class="slash-item ${i === 0 ? 'active' : ''}" onclick="applyOlProjCommand(${i})">
                 <span class="slash-icon">🏷️</span><span>${esc(p.name)}</span>
               </div>`;
        });
      }
      menu.innerHTML = html;
    }

    function showOlProjMenuAt(x, y) {
      const menu = $('ol-proj-menu');
      if (!menu) return;
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      menu.style.display = 'block';
      menu.classList.add('open');
    }

    function hideOlProjMenu() {
      const menu = $('ol-proj-menu');
      if (menu) {
        menu.style.display = 'none';
        menu.classList.remove('open');
      }
      _olProjNodeId = null;
    }

    function applyOlProjCommand(pi) {
      if (!_olProjNodeId || !_olProjDate) return;
      const nodes = olGetNodes(_olProjDate);
      const n = nodes.find(x => x.id === _olProjNodeId);
      const startIdx = nodes.findIndex(x => x.id === _olProjNodeId);
      if (!n) return;

      if (_olProjTrigger) {
        const el = document.getElementById('olt-' + _olProjNodeId);
        if (el) {
          const txt = el.textContent;
          if (txt.endsWith(_olProjTrigger)) {
            const newTxt = txt.slice(0, -_olProjTrigger.length);
            n.html = esc(newTxt);
            n.text = newTxt;
            el.innerHTML = n.html;
          }
        }
      }

      // Set projTag on the node and its child todos
      const projTag = S.projects[pi].name.replace(/\s+/g, '_');
      n.projTag = projTag;
      if (!n.type) n.type = n.isTodo ? 'todo' : 'log';

      const subCount = olGetSubtree(nodes, startIdx);
      let extractedCount = 0;
      for (let i = startIdx + 1; i < startIdx + subCount; i++) {
        if (nodes[i].isTodo) {
          nodes[i].projTag = projTag;
          if (!nodes[i].type) nodes[i].type = 'todo';
          extractedCount++;
        }
      }

      hideOlProjMenu();
      saveState();
      olRender('ol-container', _olProjDate);
      render();

      if (extractedCount > 0) {
        showToast('🏷️ ' + S.projects[pi].name + ' にタグ付け（' + extractedCount + '件のタスクを含む）');
      } else {
        showToast('🏷️ ' + S.projects[pi].name + ' にタグ付けしました');
      }

      setTimeout(() => {
        const nextEl = document.getElementById('olt-' + _olProjNodeId);
        if (nextEl) {
          nextEl.focus();
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(nextEl);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (e) { }
        }
      }, 10);
    }


    // YYYY-M-D → Date（週キーから日付に変換）
    function wkeyToDate(wk) {
      try {
        const m = wk.match(/^(\d+)-(\d+)-(\d+)$/);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3]);
      } catch (e) { return null; }
    }

    // フォーマットツールバーのボタン状態を更新
    function olFmtBold() {
      if (!_olFocusId || !_olCurrentDate) return;
      const nodes = olGetNodes(_olCurrentDate);
      const idx = nodes.findIndex(n => n.id === _olFocusId);
      if (idx < 0) return;
      // テキストを保存してからトグル
      const el = document.getElementById('olt-' + _olFocusId);
      if (el) olSaveTxt(nodes, idx, el);
      nodes[idx].bold = !nodes[idx].bold;
      saveState(); olRender('ol-container', _olCurrentDate);
    }
    function olFmtColor(color) {
      if (!_olFocusId || !_olCurrentDate) return;
      const nodes = olGetNodes(_olCurrentDate);
      const idx = nodes.findIndex(n => n.id === _olFocusId);
      if (idx < 0) return;
      const el = document.getElementById('olt-' + _olFocusId);
      if (el) olSaveTxt(nodes, idx, el);
      nodes[idx].color = color;
      saveState(); olRender('ol-container', _olCurrentDate);
    }

    function updateOlFmt(date) {
      if (!_olFocusId) return;
      const nodes = olGetNodes(date);
      const node = nodes.find(n => n.id === _olFocusId);
      if (!node) return;
      const boldBtn = $('ol-bold-btn');
      if (boldBtn) boldBtn.classList.toggle('ol-active', !!node.bold);
      ['e74c3c', 'e67e22', '27ae60', '2980b9', '8e44ad'].forEach(hex => {
        const btn = document.getElementById('ol-c-' + hex);
        if (btn) btn.style.outline = node.color === ('#' + hex) ? '2px solid var(--tx)' : 'none';
      });
    }

    /* ── リッチテキスト: リンク・表・画像挿入 ── */

    // 現在フォーカスしているノードのhtml/textを保存して saveState
    function olRichSave() {
      if (!_olFocusId || !_olCurrentDate) return;
      const nodes = olGetNodes(_olCurrentDate);
      const idx = nodes.findIndex(n => n.id === _olFocusId);
      if (idx < 0) return;
      const el = document.getElementById('olt-' + _olFocusId);
      if (el) olSaveTxt(nodes, idx, el);
      clearTimeout(_olSaveTimer);
      _olSaveTimer = setTimeout(() => saveState(), 300);
    }

    // リンク挿入（Ctrl+K またはツールバーボタン）
    function olInsertLink() {
      const sel = window.getSelection();
      const selText = sel && sel.rangeCount ? sel.toString() : '';
      // 選択範囲を保存しておく（ポップアップ表示後にフォーカスが移るため）
      let savedRange = null;
      if (sel && sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
      // リンク編集ポップアップを表示（URL + 表示名）
      _olLinkEditOpen(null, null, null, selText, savedRange);
    }

    /* ─────────────────────────────────────────────────────────────
       リンク編集ポップアップ: ノートエディタ内の <a> タグを挿入・編集
    ───────────────────────────────────────────────────────────── */
    let _olLinkEditAnchor = null;   // 編集中の <a> 要素（新規挿入時は null）
    let _olLinkEditRange  = null;   // カーソル位置保存（新規挿入時に使用）
    let _olLinkEditSelText = '';    // 新規挿入時の選択テキスト

    function _olLinkEditOpen(anchor, x, y, selText, savedRange) {
      const popup  = $('ol-link-edit-popup');
      const lblInp = $('ol-link-edit-label');
      const urlInp = $('ol-link-edit-url');
      if (!popup || !lblInp || !urlInp) return;

      _olLinkEditAnchor  = anchor || null;
      _olLinkEditRange   = savedRange || null;
      _olLinkEditSelText = selText || '';

      // 既存リンクの場合は現在値をセット
      if (anchor) {
        lblInp.value = anchor.textContent.trim();
        urlInp.value = anchor.getAttribute('href') || '';
      } else {
        lblInp.value = selText || '';
        urlInp.value = '';
      }

      // 表示位置: 渡された座標 or 画面中央寄り
      if (x != null && y != null) {
        const pw = 316;
        const left = Math.min(Math.max(x, 8), window.innerWidth - pw - 8);
        const top  = Math.min(y + 6, window.innerHeight - 200);
        popup.style.left = left + 'px';
        popup.style.top  = top  + 'px';
      } else {
        popup.style.left = '50%';
        popup.style.top  = '30%';
        popup.style.transform = 'translateX(-50%)';
      }
      popup.style.display = 'block';
      // URL が空なら URL 欄へ、そうでなければ表示名欄へフォーカス
      setTimeout(() => {
        if (!urlInp.value) urlInp.focus();
        else { lblInp.focus(); lblInp.select(); }
      }, 30);
    }

    function _olLinkEditClose() {
      const popup = $('ol-link-edit-popup');
      if (popup) { popup.style.display = 'none'; popup.style.transform = ''; }
      _olLinkEditAnchor  = null;
      _olLinkEditRange   = null;
      _olLinkEditSelText = '';
    }

    function _olLinkEditApply() {
      const lblInp = $('ol-link-edit-label');
      const urlInp = $('ol-link-edit-url');
      if (!lblInp || !urlInp) return;

      let url   = urlInp.value.trim();
      let label = lblInp.value.trim();
      if (!url) { urlInp.focus(); return; }
      // プロトコル補完
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      if (!label) label = url;

      _olLinkEditClose();

      if (_olLinkEditAnchor) {
        // ── 既存リンクの編集 ──
        _olLinkEditAnchor.setAttribute('href', url);
        _olLinkEditAnchor.target = '_blank';
        _olLinkEditAnchor.rel = 'noopener';
        _olLinkEditAnchor.textContent = label;
      } else {
        // ── 新規挿入 ──
        // 保存したカーソル位置を復元
        if (_olLinkEditRange) {
          try {
            const sel2 = window.getSelection();
            sel2.removeAllRanges();
            sel2.addRange(_olLinkEditRange);
          } catch(e) {}
        }
        const html = `<a href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">${label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</a>`;
        if (_olLinkEditRange && _olLinkEditSelText) {
          // 選択テキストがあった場合は createLink で包む
          document.execCommand('createLink', false, url);
          // 新しく作られた <a> に target と label を付与
          const container = document.activeElement;
          if (container) {
            const newA = container.querySelector(`a[href="${CSS.escape(url)}"]`);
            if (newA) { newA.target = '_blank'; newA.rel = 'noopener'; newA.textContent = label; }
          }
        } else {
          document.execCommand('insertHTML', false, html);
        }
      }
      olRichSave();
    }

    function _olLinkEditKey(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); _olLinkEditApply(); }
      if (ev.key === 'Escape') { ev.preventDefault(); _olLinkEditClose(); }
      // Tab で URL ↔ 表示名を切替
      if (ev.key === 'Tab') {
        ev.preventDefault();
        const lblInp = $('ol-link-edit-label');
        const urlInp = $('ol-link-edit-url');
        if (document.activeElement === urlInp) lblInp.focus();
        else urlInp.focus();
      }
    }

    // 表を挿入
    function olInsertTable() {
      const rowsStr = prompt('行数（ヘッダー含む）:', '3');
      if (!rowsStr) return;
      const rows = Math.min(Math.max(parseInt(rowsStr) || 3, 2), 20);
      const colsStr = prompt('列数:', '3');
      if (!colsStr) return;
      const cols = Math.min(Math.max(parseInt(colsStr) || 3, 1), 10);
      const colW = 120;
      let html = `<table style="width:${colW * cols}px;table-layout:fixed">`;
      html += '<colgroup>' + Array.from({ length: cols }, () => `<col style="width:${colW}px">`).join('') + '</colgroup>';
      html += '<tr>' + Array.from({ length: cols }, (_, i) => `<th style="width:${colW}px">列${i + 1}</th>`).join('') + '</tr>';
      for (let r = 1; r < rows; r++) {
        html += '<tr>' + Array.from({ length: cols }, () => '<td><br></td>').join('') + '</tr>';
      }
      html += '</table><p><br></p>';
      document.execCommand('insertHTML', false, html);
      olRichSave();
    }

    /* ================================================================
       表操作 — コンテキストメニュー・列幅リサイズ（右端ドラッグ）・行列追加削除
    ================================================================ */

    let _tblCtx = null;    // 右クリックされたセルのコンテキスト
    let _tblResize = null; // リサイズ中の状態
    let _tblNearEdge = null; // th右端に近接中のセル

    // colgroup を保証して返す
    function _tblEnsureColgroup(table) {
      let cg = table.querySelector('colgroup');
      if (!cg) {
        cg = document.createElement('colgroup');
        const cols = table.rows[0] ? table.rows[0].cells.length : 0;
        for (let i = 0; i < cols; i++) {
          const col = document.createElement('col');
          col.style.width = (table.rows[0].cells[i] ? table.rows[0].cells[i].offsetWidth : 120) + 'px';
          cg.appendChild(col);
        }
        table.prepend(cg);
      }
      return cg;
    }

    // コンテキストメニューを閉じる
    function tblCtxClose() {
      const m = $('tbl-ctx-menu');
      if (m) m.classList.remove('open');
    }

    // 右クリックで表コンテキストメニューを開く
    function tblCtxOpen(ev, cell) {
      ev.preventDefault();
      ev.stopPropagation();
      const table = cell.closest('table');
      if (!table) return;
      const row = cell.closest('tr');
      const rowIdx = Array.from(table.rows).indexOf(row);
      const colIdx = Array.from(row.cells).indexOf(cell);
      _tblCtx = { table, row, cell, rowIdx, colIdx };

      // ヘッダー色ピッカーを現在色に同期
      const firstTh = table.querySelector('th');
      const picker = $('tbl-header-color');
      if (picker && firstTh) {
        const bg = firstTh.style.backgroundColor;
        const m2 = bg && bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (m2) picker.value = '#' + [m2[1],m2[2],m2[3]].map(x=>(+x).toString(16).padStart(2,'0')).join('');
      }

      const menu = $('tbl-ctx-menu');
      menu.classList.add('open');
      const mw = 190, mh = 230;
      let left = ev.clientX, top = ev.clientY;
      if (left + mw > window.innerWidth)  left = window.innerWidth  - mw - 4;
      if (top  + mh > window.innerHeight) top  = window.innerHeight - mh - 4;
      menu.style.left = left + 'px';
      menu.style.top  = top  + 'px';
    }

    // ── 行操作 ──────────────────────────────────────────────
    function tblAddRowAbove() {
      if (!_tblCtx) return;
      const { table, row } = _tblCtx;
      const cols = row.cells.length;
      const newRow = table.insertRow(Array.from(table.rows).indexOf(row));
      for (let i = 0; i < cols; i++) { const td = newRow.insertCell(); td.innerHTML = '<br>'; }
      tblCtxClose(); olRichSave();
    }
    function tblAddRowBelow() {
      if (!_tblCtx) return;
      const { table, row } = _tblCtx;
      const cols = row.cells.length;
      const idx = Array.from(table.rows).indexOf(row) + 1;
      const newRow = table.insertRow(idx);
      for (let i = 0; i < cols; i++) { const td = newRow.insertCell(); td.innerHTML = '<br>'; }
      tblCtxClose(); olRichSave();
    }
    function tblDeleteRow() {
      if (!_tblCtx) return;
      const { table, row } = _tblCtx;
      if (table.rows.length <= 1) { alert('行が1行のみのため削除できません'); return; }
      if (!confirm('この行を削除しますか？')) return;
      row.remove();
      tblCtxClose(); olRichSave();
    }

    // ── 列操作 ──────────────────────────────────────────────
    function tblAddColLeft() {
      if (!_tblCtx) return;
      const { table, colIdx } = _tblCtx;
      const colW = 120;
      const cg = _tblEnsureColgroup(table);
      const existingCols = cg.querySelectorAll('col');
      const newCol = document.createElement('col');
      newCol.style.width = colW + 'px';
      cg.insertBefore(newCol, existingCols[colIdx] || null);
      Array.from(table.rows).forEach((r, ri) => {
        const cell = ri === 0 ? document.createElement('th') : document.createElement('td');
        if (ri === 0) { cell.style.width = colW + 'px'; cell.textContent = '列'; }
        else cell.innerHTML = '<br>';
        r.insertBefore(cell, r.cells[colIdx] || null);
      });
      tblCtxClose(); olRichSave();
    }
    function tblAddColRight() {
      if (!_tblCtx) return;
      const { table, colIdx } = _tblCtx;
      const colW = 120;
      const cg = _tblEnsureColgroup(table);
      const existingCols = cg.querySelectorAll('col');
      const newCol = document.createElement('col');
      newCol.style.width = colW + 'px';
      cg.insertBefore(newCol, existingCols[colIdx + 1] || null);
      Array.from(table.rows).forEach((r, ri) => {
        const insertIdx = colIdx + 1;
        const cell = ri === 0 ? document.createElement('th') : document.createElement('td');
        if (ri === 0) { cell.style.width = colW + 'px'; cell.textContent = '列'; }
        else cell.innerHTML = '<br>';
        r.insertBefore(cell, r.cells[insertIdx] || null);
      });
      tblCtxClose(); olRichSave();
    }
    function tblDeleteCol() {
      if (!_tblCtx) return;
      const { table, colIdx } = _tblCtx;
      if (table.rows[0] && table.rows[0].cells.length <= 1) { alert('列が1列のみのため削除できません'); return; }
      if (!confirm('この列を削除しますか？')) return;
      const cols = table.querySelectorAll('col');
      if (cols[colIdx]) cols[colIdx].remove();
      Array.from(table.rows).forEach(r => { if (r.cells[colIdx]) r.deleteCell(colIdx); });
      tblCtxClose(); olRichSave();
    }

    // ── ヘッダー色変更 ──────────────────────────────────────
    function tblSetHeaderColor(color) {
      if (!_tblCtx) return;
      _tblCtx.table.querySelectorAll('th').forEach(th => { th.style.backgroundColor = color; });
      olRichSave();
    }

    // ── 列幅リサイズ（th右端ドラッグ、HTMLスパン不要） ────────
    document.addEventListener('mousemove', ev => {
      if (_tblResize) {
        // リサイズ中: 幅を更新
        const { th, table, colIdx, startX, startW } = _tblResize;
        const newW = Math.max(40, startW + ev.clientX - startX);
        th.style.width = newW + 'px';
        const col = table.querySelectorAll('col')[colIdx];
        if (col) col.style.width = newW + 'px';
        // table幅 = 全col幅の合計
        const allCols = Array.from(table.querySelectorAll('col'));
        if (allCols.length) {
          const totalW = allCols.reduce((s, c) => s + (parseInt(c.style.width) || 120), 0);
          table.style.width = totalW + 'px';
        }
        return;
      }
      // th 右端6px以内かチェック（カーソル変更）
      const th = ev.target.closest && ev.target.closest('.ol-text th');
      if (th) {
        const rect = th.getBoundingClientRect();
        if (ev.clientX >= rect.right - 6) {
          th.style.cursor = 'col-resize';
          _tblNearEdge = th;
        } else {
          th.style.cursor = '';
          _tblNearEdge = null;
        }
      } else {
        _tblNearEdge = null;
      }
    });

    document.addEventListener('mousedown', ev => {
      // th右端ドラッグ開始
      if (_tblNearEdge && ev.target.closest && ev.target.closest('.ol-text th')) {
        const th = _tblNearEdge;
        const rect = th.getBoundingClientRect();
        if (ev.clientX >= rect.right - 6) {
          ev.preventDefault();
          const table = th.closest('table');
          const row   = th.closest('tr');
          const colIdx = Array.from(row.cells).indexOf(th);
          _tblEnsureColgroup(table);
          _tblResize = { th, table, colIdx, startX: ev.clientX, startW: th.offsetWidth };
          document.body.style.cursor = 'col-resize';
          return;
        }
      }
      // コンテキストメニュー外クリックで閉じる
      if (!ev.target.closest('#tbl-ctx-menu')) tblCtxClose();

      // テーブルセルクリック → フォーカスクラスを付与
      const clickedCell = ev.target.closest && ev.target.closest('.ol-text td, .ol-text th');
      if (clickedCell) {
        document.querySelectorAll('.ol-text .tbl-cell-focus')
          .forEach(c => c.classList.remove('tbl-cell-focus'));
        clickedCell.classList.add('tbl-cell-focus');
      } else if (!ev.target.closest('.ol-text')) {
        // ol-text 外クリック → フォーカスクラスを全解除
        document.querySelectorAll('.ol-text .tbl-cell-focus')
          .forEach(c => c.classList.remove('tbl-cell-focus'));
      }
    });

    document.addEventListener('mouseup', () => {
      if (!_tblResize) return;
      _tblResize = null;
      document.body.style.cursor = '';
      olRichSave(); // 幅をinline styleとして保存
    });

    // テーブルセルクリック → クリック座標にカーソルを正確に配置
    // （user-select:none の th や table-layout:fixed 環境でもカーソルが末尾に飛ばないようにする）
    document.addEventListener('click', ev => {
      const cell = ev.target.closest && ev.target.closest('.ol-text td, .ol-text th');
      if (!cell) return;

      let range = null;
      try {
        // Chrome/Safari: caretRangeFromPoint
        if (document.caretRangeFromPoint) {
          const r = document.caretRangeFromPoint(ev.clientX, ev.clientY);
          if (r && cell.contains(r.startContainer)) range = r;
        }
        // Firefox: caretPositionFromPoint
        if (!range && document.caretPositionFromPoint) {
          const pos = document.caretPositionFromPoint(ev.clientX, ev.clientY);
          if (pos) {
            const r2 = document.createRange();
            r2.setStart(pos.offsetNode, pos.offset);
            r2.collapse(true);
            if (cell.contains(r2.startContainer)) range = r2;
          }
        }
      } catch(e) { range = null; }

      // フォールバック: セルの先頭
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(cell);
        range.collapse(true);
      }

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // 右クリック: 表セルでコンテキストメニュー
    document.addEventListener('contextmenu', ev => {
      // ノートエディタ内の <a> タグ右クリック → リンク編集ポップアップ
      const anchor = ev.target.closest && ev.target.closest('a[href]');
      if (anchor && anchor.closest('.ol-text')) {
        ev.preventDefault();
        _olLinkEditOpen(anchor, ev.clientX, ev.clientY, null, null);
        return;
      }
      const cell = ev.target.closest && ev.target.closest('.ol-text td, .ol-text th');
      if (cell) { tblCtxOpen(ev, cell); return; }
      tblCtxClose();
    });

    // ファイルから画像を挿入 (GitHubアップロード対応)
    async function olInsertImageFile() {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;

        // GitHub設定チェック
        const { token, repo } = ghGetSettings();
        if (!token || !repo) {
          showToast('❌ 画像はGitHubへアップロードされます。設定パネルでGitHubトークンとリポジトリを設定してください。', true);
          return;
        }

        showToast('⏳ GitHubへアップロード中...');
        try {
          const src = await ghUploadImage(file);
          const html = `<span class="ol-img-wrap" contenteditable="false" style="width:300px"><img src="${src}" alt="${file.name.replace(/"/g, '')}"></span><br>`;
          document.execCommand('insertHTML', false, html);
          olRichSave();
          showToast('✓ 画像をGitHubへアップロードしました');
        } catch (err) {
          showToast('❌ アップロード失敗: ' + err.message, true);
        }
      };
      input.click();
    }

    // ノートパネルの画像ペースト処理をセットアップ（常にGitHubへアップロード）
    function olSetupPasteHandler() {
      const container = $('ol-container');
      if (!container || container._pasteListenerSet) return;
      container._pasteListenerSet = true;
      container.addEventListener('paste', async ev => {
        const items = ev.clipboardData && ev.clipboardData.items;
        if (!items) return;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            ev.preventDefault();
            const file = item.getAsFile();
            if (!file) break;

            // GitHub設定チェック
            const { token, repo } = ghGetSettings();
            if (!token || !repo) {
              showToast('❌ 画像はGitHubへアップロードされます。設定パネルでGitHubトークンとリポジトリを設定してください。', true);
              break;
            }

            showToast('⏳ GitHubへアップロード中...');
            try {
              const src = await ghUploadImage(file);
              const html = `<span class="ol-img-wrap" contenteditable="false" style="width:300px"><img src="${src}" alt="ペースト画像"></span><br>`;
              document.execCommand('insertHTML', false, html);
              ghAuthInContainer(container);
              olRichSave();
              showToast('✓ 画像をGitHubへアップロードしました');
            } catch (err) {
              showToast('❌ アップロード失敗: ' + err.message, true);
            }
            break;
          }
        }
      });
    }

    // ── ダブルクリックで詳細パネルを開く ────────────────────────────
    function eitemDblClick(ev, el) {
      if (ev.target.closest('a')) return;
      const pi = +el.dataset.pi;
      const dataWk = el.dataset.originWk || el.dataset.wk; // ミラーは元の週でパネルを開く
      const ei = el.dataset.ei;
      if (pCtx && panelDirty && fkey(pCtx.pi, pCtx.wk, pCtx.ei) !== fkey(pi, dataWk, ei)) {
        if (!confirm('未保存の変更があります。破棄しますか？')) return;
        panelDirty = false;
      }
      openPanel(pi, dataWk, ei);
    }


    /* ── 検索機能 ── */
    let _searchActiveIdx = -1;    // キーボードで選択中の結果インデックス
    let _searchSelectedTags = new Set(); // タグフィルタ（検索）

    function openSearch(q = '') {
      $('search-modal').classList.add('open');
      const inp = $('search-input');
      inp.value = q;
      $('search-input2').value = '';
      _searchActiveIdx = -1;
      _searchSelectedTags.clear();
      _searchUpdateTagRow();
      if (q) _searchRun();
      else { $('search-results').innerHTML = ''; _searchShowFooter(false); }
      inp.focus();
    }
    function closeSearch() {
      $('search-modal').classList.remove('open');
    }

    // タグフィルタ行を更新
    function _searchUpdateTagRow() {
      const row3 = $('search-row3');
      if (!row3) return;
      const allTags = getAllTags();
      if (!allTags || allTags.length === 0) {
        row3.style.display = 'none'; return;
      }
      row3.style.display = 'flex';
      let h = `<span id="search-row3-label">🏷 タグ▼</span>`;
      allTags.slice(0, 30).forEach(t => {
        const sel = _searchSelectedTags.has(t) ? ' selected' : '';
        h += `<span class="search-tag-chip${sel}" onmousedown="event.preventDefault()" onclick="_searchToggleTag('${escA(t)}')">#${esc(t)}</span>`;
      });
      row3.innerHTML = h;
    }

    function _searchToggleTag(tag) {
      if (_searchSelectedTags.has(tag)) _searchSelectedTags.delete(tag);
      else _searchSelectedTags.add(tag);
      _searchUpdateTagRow();
      _searchRun();
    }

    function _searchShowFooter(show) {
      const footer = $('search-footer');
      if (footer) footer.style.display = show ? 'flex' : 'none';
    }

    // 1行目・2行目 oninput から呼ばれる共通エントリ
    function _searchRun() {
      const q1 = ($('search-input').value  || '').trim();
      const q2 = ($('search-input2').value || '').trim();
      _searchActiveIdx = -1;
      doSearch(q1, q2, [..._searchSelectedTags]);
    }

    // ── 純粋検索ロジック（DOM副作用なし）──
    // q1/q2 テキスト AND タグ配列 tagsArr でノードを検索して結果配列を返す
    function _runSearchQuery(q1, q2, tagsArr) {
      q1 = (q1 || '').trim();
      q2 = (q2 || '').trim();
      tagsArr = tagsArr || [];
      const hasText = q1.length >= 2;
      const hasTags = tagsArr.length > 0;
      if (!hasText && !hasTags) return [];

      const low1 = hasText ? q1.toLowerCase() : '';
      const low2 = q2.length >= 2 ? q2.toLowerCase() : '';

      // テキスト条件: hasText なら q1 AND q2 にマッチ; なければ常に true
      const matchesText = (text) => {
        if (!hasText) return true;
        if (!text) return false;
        const lo = text.toLowerCase();
        return lo.includes(low1) && (!low2 || lo.includes(low2));
      };
      // タグ条件: hasTags なら全選択タグを持つ; なければ常に true
      const matchesTags = (nodeTags) => {
        if (!hasTags) return true;
        const nt = nodeTags || [];
        return tagsArr.every(t => nt.includes(t));
      };

      const results = [];

      // プロジェクト名（タグ検索は対象外）
      if (hasText) {
        S.projects.forEach((p, pi) => {
          if (matchesText(p.name)) {
            results.push({ type: 'PROJECT', text: p.name, info: 'プロジェクト名', pi, wk: null, ei: null });
          }
        });
      }

      // プロジェクト紐付きノード
      S.projects.forEach((p, pi) => {
        const projTag = p.name.replace(/\s+/g, '_');
        if (S.dailyOutline) {
          for (const dateKey in S.dailyOutline) {
            const nodes = S.dailyOutline[dateKey];
            if (!Array.isArray(nodes)) continue;
            nodes.forEach(n => {
              if (n.projTag !== projTag) return;
              if (n.type === 'searchsummary') return; // 自己参照を避ける
              const wk = dateKey.startsWith('proj:') ? null
                : (function(){ try { return wkey(new Date(dateKey.replace(/-/g,'/'))); } catch(e) { return null; } })();
              const date = dateKey.startsWith('proj:') ? null : dateKey;
              if (matchesText(n.text) && matchesTags(n.tags)) {
                results.push({ type: 'ENTRY', text: n.text, info: p.name + (wk ? ' (' + wk + ')' : ''), pi, wk, ei: n.id, date, id: n.id });
              }
            });
          }
        }
      });

      // デイリーノート（projTag なしのノード）
      if (S.dailyOutline) {
        for (const dateKey in S.dailyOutline) {
          if (dateKey.startsWith('proj:')) continue;
          const nodes = S.dailyOutline[dateKey];
          if (!Array.isArray(nodes)) continue;
          nodes.forEach(n => {
            if (n.projTag) return;
            if (n.type === 'searchsummary') return; // 検索対象外
            if (matchesText(n.text) && matchesTags(n.tags)) {
              results.push({ type: 'DAILY', text: n.text, info: 'ノート: ' + dateKey, date: dateKey, id: n.id });
            }
          });
        }
      }

      return results;
    }

    // q1/q2/tagsArr で検索 → 結果を描画
    function doSearch(q1, q2, tagsArr) {
      tagsArr = tagsArr || [];
      const hasText = q1 && q1.length >= 2;
      const hasTags = tagsArr.length > 0;
      if (!hasText && !hasTags) {
        $('search-results').innerHTML = '';
        _searchShowFooter(false);
        return;
      }
      const results = _runSearchQuery(q1, q2, tagsArr);
      renderSearchResults(results, q1, q2 || '', tagsArr);
    }

    // ハイライト: 複数クエリに対応（q2 があれば両方ハイライト）
    function _searchHighlight(text, q1, q2) {
      const escRe = s => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      let h = esc(text);
      const queries = [q1, q2].filter(q => q && q.length >= 2);
      queries.forEach(q => {
        h = h.replace(new RegExp('(' + escRe(q) + ')', 'gi'),
          '<span class="search-res-match">$1</span>');
      });
      return h;
    }

    function renderSearchResults(results, q1, q2, tagsArr) {
      tagsArr = tagsArr || [];
      const container = $('search-results');
      if (results.length === 0) {
        container.innerHTML = '<div id="search-no-results">一致する結果が見つかりませんでした</div>';
        _searchShowFooter(false);
        return;
      }
      container.innerHTML = results.slice(0, 80).map((res, idx) => {
        const highlighted = _searchHighlight(res.text, q1, q2);

        // onclick を文字列引数を安全にクォートして生成
        let action = '';
        if (res.type === 'DAILY') {
          action = `openNotePanelToDate('${res.date}','${res.id}');closeSearch();`;
        } else if (res.type === 'ENTRY' || res.type === 'NOTE') {
          if (res.ei) {
            // ノードに直接ジャンプ（グリッドではなくノートパネル）
            // findNodeById で実行時に date を解決 → proj: キーの案件にも対応
            const safeEi = res.ei.replace(/'/g, "\\'");
            action = `(function(){var _f=findNodeById('${safeEi}');if(_f){openNotePanelToDate(_f.date,'${safeEi}');closeSearch();}else{showToast('ノードが見つかりません',true);}})();`;
          }
        } else if (res.type === 'PROJECT') {
          // プロジェクト行にフォーカス（折りたたみ解除）
          action = `(function(){var _p=S.projects[${res.pi}];if(_p&&_p.collapsed){_p.collapsed=false;saveState();render();}var _wks=getWeeks();applyFocus(${res.pi},_wks.length?wkey(_wks[0]):null,null);})();closeSearch();`;
        }

        const typeLabel = ({ PROJECT:'PROJECT', ENTRY:'ENTRY', NOTE:'NOTE', DAILY:'DAILY' })[res.type] || res.type;
        return `<div class="search-res-item" data-sidx="${idx}"
                  onmousedown="event.preventDefault()"
                  onclick="(function(){${action}})()"
                  onmouseenter="_searchSetActive(${idx})">
          <div>
            <span class="search-res-type">${typeLabel}</span>
            <span class="search-res-info">${esc(res.info || '')}</span>
          </div>
          <div class="search-res-text">${highlighted}</div>
        </div>`;
      }).join('');
      // 結果があるとき「保存」フッターを表示
      _searchShowFooter(true);
    }

    // 現在の検索条件で searchsummary ノードを生成
    function _searchSave() {
      const q1 = ($('search-input').value || '').trim();
      const tags = [..._searchSelectedTags];

      // 挿入先: 現在開いているノート（なければ今日のデイリーノートへ）
      if (!_olCurrentDate) {
        _olCurrentDate = todayDateStr();
      }
      if (!_notePanelOpen) {
        // ノートパネルを開く
        openNotePanelToDate(_olCurrentDate, null);
      }

      // ラベル生成
      const parts = [];
      if (q1) parts.push(q1);
      if (q2 && q2.length >= 2) parts.push(q2);
      tags.forEach(t => parts.push('#' + t));
      const label = '検索結果（' + (parts.join(' and ') || '全件') + '）';

      const nodes = olGetNodes(_olCurrentDate);
      const newNode = {
        id: olNewId(), text: label, html: '', type: 'searchsummary',
        savedQuery: { q1, q2, tags },
        indent: 0, bold: false, color: '', collapsed: false,
        isTodo: false, checked: false, tags: [], images: []
      };

      // 現在フォーカス中のノードのサブツリー後ろに挿入
      let insertAt = nodes.length;
      if (_olFocusId) {
        const focusIdx = nodes.findIndex(n => n.id === _olFocusId);
        if (focusIdx >= 0) {
          newNode.indent = nodes[focusIdx].indent;
          let end = focusIdx + 1;
          while (end < nodes.length && nodes[end].indent > nodes[focusIdx].indent) end++;
          insertAt = end;
        }
      }

      nodes.splice(insertAt, 0, newNode);
      olPushHistory(_olCurrentDate);
      saveState();
      _olFocusId = newNode.id;
      olRender('ol-container', _olCurrentDate);
      closeSearch();
      showToast('💾 検索結果ノードを作成しました');
    }

    // マウスオーバーで activeIdx を同期
    function _searchSetActive(idx) {
      _searchActiveIdx = idx;
      document.querySelectorAll('.search-res-item').forEach((el, i) =>
        el.classList.toggle('active', i === idx));
    }

    // ↑↓Enter Esc キーハンドリング（両インプット共通）
    function _searchKeyDown(ev) {
      const items = Array.from(document.querySelectorAll('.search-res-item'));
      if (!items.length && ev.key !== 'Escape') return;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        _searchActiveIdx = Math.min(_searchActiveIdx + 1, items.length - 1);
        _searchUpdateActive(items);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        _searchActiveIdx = Math.max(_searchActiveIdx - 1, 0);
        _searchUpdateActive(items);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (_searchActiveIdx >= 0 && items[_searchActiveIdx]) {
          items[_searchActiveIdx].click();
        }
      } else if (ev.key === 'Escape') {
        closeSearch();
      }
    }

    function _searchUpdateActive(items) {
      items.forEach((el, i) => el.classList.toggle('active', i === _searchActiveIdx));
      if (items[_searchActiveIdx]) {
        items[_searchActiveIdx].scrollIntoView({ block: 'nearest' });
      }
    }

    loadState();
    ensureEntryIds();
    ensureNodeDates(); // Phase 2: 全ノードに date プロパティ付与
    if (!S.projects || !S.projects.length) initSample();
    render();
    doRollover();
    initColumnWidths();
    initSpanObserver(); // Phase 3: スパンバーの ResizeObserver
    updateSaveTimeDisplay();
    if (_loadStateError) { setTimeout(() => alert(_loadStateError), 400); }
    ghSyncLoad(false);

    // ── FSA 初期化（非同期・ノンブロッキング） ──
    // loadState() が localStorage から同期読み込みした後に実行
    // ファイルの方が新しければ自動的に再描画される
    if (_fsaEnabled) {
      fsaInit().then(() => updateFsaStatusUI());
    } else {
      updateFsaStatusUI();
    }

    /* ── 別タブ検知 ──
       別タブでデータが更新されたら警告トースト（自動反映はしない）
    */
    window.addEventListener('storage', ev => {
      if (ev.key !== SK || !ev.newValue || !ev.oldValue) return;
      try {
        const other = JSON.parse(ev.newValue);
        const otherAt = other.savedAt ? new Date(other.savedAt) : new Date(0);
        const localAt = S.savedAt ? new Date(S.savedAt) : new Date(0);
        if (otherAt > localAt) {
          showToast('⚠️ 別のタブで変更されました。ページを再読み込みして最新データを反映してください。');
        }
      } catch (e) { }
    });

    /* ── ブラウザを閉じるときの処理 ──
       GitHub同期が有効かつ未送信データがある場合: 送信確認ダイアログを表示
    */
    window.addEventListener('beforeunload', ev => {
      if (_ghDirty && ghGetSettings().enabled) {
        // 未送信データがある場合に警告（メッセージ内容はブラウザ規定）
        ev.preventDefault();
        ev.returnValue = 'GitHubへのデータ送信が完了していない可能性があります。このまま閉じますか？';
        return ev.returnValue;
      }
    });


    // --- テーマの初期適用 ---
    // --- テーマの初期適用 ---
    applyTheme(localStorage.getItem('pwt_theme') || 'auto');

    // --- PWA Service Worker 登録 ---
    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('ServiceWorker registered:', reg.scope))
          .catch(err => console.warn('ServiceWorker registration failed:', err));
      });
    }
