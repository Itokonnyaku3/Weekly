# 変更履歴 (CHANGELOG)

このプロジェクトのバージョンごとの変更点を記録します。バージョンは `app.js` の `APP_VERSION` 定数と一致します。

形式: `vX.Y.Z-MMDDHHMM`（X=メジャー, Y=機能追加, Z=修正/微調整）

---

## v1.10.0-05301915-clip-p2 (2026-05-30)
### 機能追加 — コピペ Phase 2: リッチHTML貼付（サニタイズ付き）

外部（Word / Google Docs / Web / Notion 等）からの `text/html` 貼付を**サニタイズしてノード化**。箇条書きの入れ子・見出し・インライン装飾（太字/リンク/色）を保持。

#### 新規ヘルパ
- `olFilterStyle`: インラインstyleを許可プロパティ（color / background-color / font-weight / text-decoration / text-align / width）のみに制限。`url()`/`expression`/`javascript:` を除去。
- `olSanitizeFragment`: `DOMParser` で解析→ ①危険要素(`script/style/iframe/img/input`…)を内容ごと除去 ②属性サニタイズ（`on*`除去・`href`は`http(s)/mailto/#`のみ・`style`はフィルタ・`class/id/src`等は除去）③許可外タグはアンラップ（中身保持）。ホワイトリスト `OL_ALLOWED_TAGS`。
- `olHtmlIsRich`: 構造/装飾タグを含むかの簡易判定（プレーン多行はテキスト経路へ）。
- `olParseHtmlToNodes`: サニタイズ済みDOMを走査しノード配列化。`ul/ol`の入れ子→indent（`walkList`再帰）、`h1-6`→`<strong>`、`p/div`→行、`table`→1ノード(html)、インライン装飾はnode.htmlに保持。戻り値 `{nodes, hadBlock}`。

#### olContainerPaste にブランチ①.5を追加
- マーカー無の `text/html` がリッチ かつ（複数ノード or 構造あり）の場合のみ介入し `olStructuredPaste` で挿入。**単一インライン装飾はネイティブ貼付に委譲**（行内書式を保持・回帰回避）。プレーン多行は従来のテキスト経路（2sp=1段）を維持。

#### スコープ外（後続）
- 外部 `<img>` は除去（Phase 4 で貼付画像blob→GitHubアップロードを強化）。
- Excel/Sheets の TSV→表、表のコピー出力は Phase 3。

#### 検証（ブラウザ実機）
- サニタイズ: `script/img/onerror/onclick/javascript:/url()` 除去・`color`/`font-weight`/`https`リンク保持。
- 入れ子リスト3階層（A@0/A1@1/A1a@2/A2@1/B@0）・見出し→`<strong>`・太字/リンク保持・段落+リスト混在。
- olHtmlIsRich がプレーンdivを除外→テキスト経路（2sp=1段）に回る回帰なし。
- コンソールエラーなし・`node --check` OK（8499行）。

---

## v1.9.0-05301615-clip-p1 (2026-05-30)
### 機能改善 — コピペ/複数選択 堅牢化（Phase 1）／仕様書 `仕様書_コピペ貼付機能.md`

「貼れたり貼れなかったり」の主因＝内部クリップボードの**完全一致依存**を解消。システムクリップボードに `text/plain` ＋ `text/html`（独自マーカー `data-pwt-clip` にノードJSONをbase64格納）を書き出す方式へ。

#### 新規ヘルパ
- `olEncodeClip`/`olDecodeClip`（UTF-8対応base64）、`olBuildVisibleList`（入れ子`<ul>`）、`olBuildClipHtml`（マーカー埋込html生成）、`olReadClipMarker`（html→ノード配列）、`olWriteClipboard`（`ClipboardItem`で text/plain＋text/html 書込・不可環境はwriteText/execCommandへフォールバック）、`olCopyBlocks`（コピー共通化）、`olStructuredPaste`（新ID採番＋**内部 parentId 再マップ**＝親子保持、外部参照は解除）。

#### 変更
- **Ctrl+C**: 複数選択 or カーソルのみ（行内テキスト未選択）で現在ノードのサブツリーをコピー。`olCopyBlocks` で text＋マーカーhtml をシステムクリップボードへ。
- **Ctrl+X**: 同様に**単体カット対応**（旧: 2件以上のみ）。行内テキスト範囲選択時はネイティブのテキストカットに委譲。
- **Ctrl+A**: アウトライン全選択を新設（1回目=可視ノード全選択／既に全選択ならネイティブ）。
- **olContainerPaste を統合ハンドラ化**: ⓪画像（GitHubアップロード。旧 `olSetupPasteHandler` を集約）→①`text/html`マーカー→構造復元→①'内部クリップボード一致（フォールバック）→②多行テキスト2sp=1段。`olSetupPasteHandler` は no-op 化し**paste リスナー二重登録を解消**。
- **構造ペーストで `parentId` を保持**（旧 `olPasteMultiClipboard` は `delete parentId` していた）。

#### 検証（ブラウザ実機・実データ）
- マーカー encode/decode 往復が無損失（text/parentId/checked/html）。
- 構造ペーストで内部親子を再マップ・外部参照は解除・インデント保持。
- Ctrl+A 全選択／Ctrl+C 生成（親子保持）／統合ペースト（TODO/親子保持）／Ctrl+X 単体（ノード＋サブツリー）／外部多行テキスト貼付（回帰なし）。
- `pasteListenerSet=false`（重複リスナー無）・コンソールエラーなし・`node --check` OK（8396行）。

#### 残（次フェーズ）
- Phase 2 リッチ貼付（`text/html`→ノード化・**サニタイズ必須**）／Phase 3 表（TSV/HTML表）／Phase 4 画像往復強化。

---

## v1.8.0-05301450-gridwk (2026-05-30)
### 機能追加 — ノート作成日とグリッド表示週の分離（`gridWk`）／課題6

ノート＝タスクを**作成した日**、グリッド＝**作業すべき週**として独立。グリッドでドラッグして週を変えても、ノート上の作成日（`dailyOutline` のキー）は動かさない。

#### データモデル
- ノードに任意フィールド **`node.gridWk`**（週キー＝月曜 `"YYYY-M-D"`）。未設定なら従来どおり作成日から週導出（**完全後方互換**）。

#### 読み取り側
- `getGridItems`（[app.js](app.js)）: `実効週 = node.gridWk || wkey(date)` で所属週を判定。早期 `dateWk !== wk` スキップを廃しノード単位で判定。
- `getMirrorItems`: 過去週の列挙を**実効週ベース**に変更。週比較を文字列でなく `wkeyToDate().getTime()` に（ゼロ埋め無し週キーの誤比較も解消）。`gridWk`=今週なら直接表示しミラー二重表示を防止。

#### 書き込み側
- `setGridWkSubtree(rootId, wk|null)` 新設: ノード＋子孫(`parentId`連鎖)に `gridWk` を一括設定/解除（親子をまとめて週移動）。
- `eDrop`/`eDropOnItem`: 週セルへのドロップは**作成日を移動せず `gridWk` のみ変更**。本来の週へ戻すと解除。`proj` 列へのドロップ（プロジェクトノート添付）は従来どおり移動＋`gridWk`解除。projTag更新は維持。
- `quickAdd`／`savePanel`(新規): 現在週以外のセルで作成時は**作成日=今日＋`gridWk`=その週**に統一。

#### 検証（実データ／修復済みdata.json）
- ドラッグで週移動→ノート作成日不変・親子3件もまとめて移動・元へ戻すと`gridWk`解除・移動後は旧週に出ない（二重表示なし）。
- quickAdd将来週→作成日=今日＋gridWk=対象週で対象週にのみ表示。
- 過去未完TODOのミラー表示維持＋gridWk=今週で直接表示・ミラー重複なし。
- 全20プロジェクト実データでレンダリング・コンソールエラーなし・`node --check` OK（8320行）。

#### 既知の制限（合意済み）
- 1セルに「作成日由来」と「gridWk由来」が混在する場合、**異なる出自アイテム間の厳密な並べ替えは非保証**（同一日内の並べ替えは従来どおり可）。

---

## v1.7.1-05301425-rename-projtag (2026-05-30)
### バグ修正 — プロジェクト名リネームによる projTag 孤立（グリッドからタスク消失）

#### 事象
ノートには表示されるのにグリッドから消えるタスクが多数（本番データで179件）。

#### 根本原因（体系的デバッグで特定・実データで実証）
`getGridItems` は `n.projTag === proj.name.replace(/\s+/g,'_')` で照合する（[app.js:4762](app.js:4762)）。`startRename`（旧 [app.js:3064](app.js:3064)）が**プロジェクト名のみ変更し既存ノードの projTag を更新しなかった**ため、`HACCP`→`PJ.HACCP`・`管理・全般`→`０．管理・全般` のリネームで全タグが旧名のまま孤立し、どのプロジェクトにも紐づかず非表示に。ノート日付/グリッド週の連結や v1.7.0 とは無関係（[ARCHITECTURE.md](ARCHITECTURE.md) §8-3 の既知リスク）。

#### 修正（再発防止・コード）
- `startRename` を改修。名称変更時に旧 projTag→新 projTag を全 `S.dailyOutline` ノードに一括適用。更新件数をトースト表示。`proj:{pi}` ノートキーは index 基準のため影響なし。

#### 修正（既存データ修復）
- `data.json` の孤立 projTag を一括リマップ: `HACCP`→`PJ.HACCP`（108件）/ `管理・全般`→`０．管理・全般`（73件）。JSON 検証後に書き戻し。`BKP/data.json.bak3_20260530_142052_projtag-repair` にバックアップ。
- 消えていたタスク（富士通オフライン調査・東村山壬生温度センサー稟議 等）がグリッドに復活することを実機確認。

#### 別件（未対応・要相談）
- 孤立タグ `店舗DXサポート`(5)・`AI_ビーコン用アンテナ撤去`(3): 改名先不明のため未処理（大半は旧/完了/`_mv`）。
- `dailyOutline["_mv"]` に 653 ノード（projTag付き139）が無効キーで滞留（旧ツリービュー撤去の残骸と推測）。無効キーのため projTag 修復では表示されず。別途クリーンアップ提案予定。

---

## v1.7.0-05301010-grid-visibility (2026-05-30)
### 機能追加 — グリッド視認性向上（案C：密度アップ＋プロジェクト色分け）

OneNote 版に比べた視認性低下を解消。カード状の各アイテムを密なアウトライン行に変え、プロジェクトごとに色を付けて行の見通しを改善。モックを提示し方向を合意の上で実装。

#### 密度アップ（カード→アウトライン化）
- `.eitem` の枠線・影・余白・角丸を削減（`border:1px solid transparent` / `box-shadow:none` / `margin-bottom:0` / `padding:1px 6px 1px 8px` / `line-height:1.36`）。階層は既存の子の左罫（`.e-child`/`.eitem-child-wrap`）・ミラーの左罫で表現を継続。
- `.elist` の gap を 2px→1px、`.wcell` の padding を 8px→`4px 6px`・gap 4px→2px・min-height 80→68px に圧縮。
- `.eitem:hover` はリフト/影をやめ `accent-soft` の背景のみに。`.eitem.kfocus` は `bg-info`＋1px リングで選択を明示（キーボードナビの視認性維持）。

#### プロジェクト自動カラー（index 順パレット）
- `projColor(pi)`＋`PROJ_PALETTE`（10色）を追加。各プロジェクトの2行（`proj-hdr-row`／詳細行）に `style="--pc:..."` を付与。
- サマリーバンド（`proj-hdr-row`）の背景を `var(--pc)`、`pcell-hdr` を `color-mix` で濃色化。バンドの高さも圧縮（`proj-hdr-name` padding 5→2px、`proj-hdr-badge` min-height 28→20px）。OneNote 風の色付き行ヘッダに。
- 詳細行: プロジェクト名セルの左に色帯（`border-left:4px solid var(--pc)`）。**アイテムのあるセル自体**を `color-mix(var(--pc) 11%, var(--bg))` で薄く着色（今週セルは `--bg-cur` とブレンドしインセットリングで現在週を維持）。
- 週列に**白い縦区切り線**（`td.col-week { border-right:2px solid var(--bg) }`）。色付きセルを明確に分離。
- ダークモードも `color-mix` で自動追従。`color-mix` 対応はブラウザで確認済み。

#### 検証
- ブラウザ実機で配色・密度・区切り線・`kfocus` を確認。`color-mix` サポート確認・コンソールエラーなし・`node --check` OK（8268行）。
- ユーザーフィードバックを反映: プロジェクト名の淡色チップを撤去（左色帯のみ残置）／タイトル行の高さをさらに圧縮／アイテムセルの着色を全週セルに適用。

---

## v1.6.0-05300945-focus-group (2026-05-30)
### 機能追加/修正 — ノート⇄グリッドのフォーカス連携・検索ホバー誤動作・下セル移動の選択位置

「マウスを使わずに書き続ける/俯瞰する」体験のフォーカス周りを強化。既存インフラ（`focusKey` / `refocusGrid` / `body.kb-nav`）を再利用し、デグレリスクを抑えた局所修正。

#### 課題1 — ノート開閉時のグリッドフォーカス連携
- **`Alt+Shift+N` で閉じる**時、`refocusGrid()` を呼び、記憶済み位置（`focusKey`）へグリッドのキーボード選択（`.kfocus`）を復元（[app.js](app.js) Alt+Shift+N 分岐）。
- **`Alt+Shift+G` を新設**: ノートを開いたままグリッドへフォーカス移動（`refocusGrid()`）。未使用キーで既存ショートカットと非衝突。
- 「フォーカス位置の常時記憶」は既存の `focusKey` が全レンダ跨ぎで保持するため新規実装なし。

#### 課題2 — 検索結果選択がマウスカーソル位置へ飛ぶ
- 全データ検索ドロップダウン各項目の `onmouseenter` をラッパ `_olGsrHover(idx)` に変更。`body.kb-nav`（矢印キーで付与・mousemoveで解除）の間は `_olSetGlobalActiveItem` を無視。
- これにより `↑/↓/Enter` のキー操作中、`scrollIntoView` で項目がマウス下に来ても選択が奪われない。マウスを実際に動かした時だけホバー選択が復活する既存設計と一貫。

#### 課題5 — 入力ボックスから↓で次プロジェクトへ移ると最下段が選択される
- `qainpKeyDown` の `ArrowDown` 分岐（[app.js](app.js)）を修正。`applyFocus(pi+1, wk, 0)`（`0` がID不一致でフォールバック→最下段）をやめ、**次PJの視覚上の先頭 `.eitem`** を `applyFocusToElement` で選択。空セルは従来通り入力ボックスへ。
- 共有フォールバック（`applyFocus` 内 `all[all.length-1]`）は上方向ナビで正しく機能しているため変更せず、局所修正に留めた。

#### 検証
- ブラウザ（python http.server）で全項目を実機確認: Alt+Shift+N 閉じ復元 / Alt+Shift+G 維持＋復元 / 検索キー操作のマウス非干渉（ガード有効・解除後ホバー復活）/ 入力ボックス↓で次PJ先頭選択。`node --check` 構文OK・末尾欠損なし（8262行）。

---

## v1.5.0-05300200-phase-kbd (2026-05-30)
### 機能追加 — Phase列廃止（名前直下表示）＋ キーボード操作5種 ＋ 集約重複除外

グリッドの省スペース化と「マウスを使わずに書き続ける/俯瞰する」体験の強化。独立した Phase 列を廃し、選定したキーボードショートカット（ノート2件・グリッド3件）を実装。

#### タスクA — Phase列の廃止とプロジェクト名直下への全件表示
- グリッドの独立 **Phase 列を撤去**（colgroup / thead / proj-hdr-row / 詳細行 / colspan / `applyWeekColWidths` を更新）。列数は `WEEKS + 2`（プロジェクト＋リンク＋週）に。
- Phase はプロジェクト名セルの直下に **全件**リスト表示（`.proj-phase-list` / `.proj-phase-item`）。`getProjPhaseNodes(pi)`（`type==='phase' && indent===1`）を利用。完了は `✔`＋取り消し線、未完 TODO は `□`、その他は `•`。クリックで該当ノードのノートを開く。
- スティッキー列の左位置を修正（`.col-link` / `thead th.col-link` の `left` から `--phase-col-w` を除去）。
- 補足: `_phaseColWidth` 変数・`startColResize` の 'phase' 分岐・`.col-phase` 系 CSS は null ガード下の無害なデッドコードとして残置（gc-phase 要素は存在しない）。

#### タスクB — グリッドアイテムのボックス内 子展開/折り畳み（視覚インジケータ）
- 親アイテムに **▼/▶ トグル**（`.e-collapse-toggle`）を表示。クリックで `toggleParentCollapse(pi, wk, nodeId)`。折り畳み中は **子件数バッジ**（`.e-child-count`）を表示。
- 折り畳み状態はノートの `collapsed` とは独立した `gridCollapsed` プロパティで保持（既存実装を活用）。`Ctrl+↑`=折り畳み / `Ctrl+↓`=展開 と同期。

#### ノートのキーボード操作
- **N3** `Ctrl+Enter`: TODO ノード上ではチェック完了/未完をトグル（マウス無しで消し込み）。TODO 以外では従来のサブタスク参照行の展開/折り畳みにフォールバック。
- **N6** `Ctrl+Shift+↑/↓`: 同階層の兄弟ノードへカーソル移動（子孫をスキップ。親の外には出ない）。端では `⤒/⤓` ヒント表示。

#### グリッドのキーボード操作
- **G5** `Space`: グリッドセル内 TODO のチェックをトグル（既存実装を確認）。
- **G8** `Ctrl+↑/↓`（プロジェクト行ヘッダ）: 行の一括折り畳み/展開（`_compactExpanded`）。コンパクトモード（Alt+H）下で動作。
- **G9** `Alt+←/→`（ノートペイン非表示時）: 表示週を前後にスクロール（`prevW()` / `nextW()`）。

#### バグ修正/堅牢化
- **集約セクションの入れ子 projTag 重複除外**: `_renderProjectAggregateSection` に `claimedIdx` セットを追加。上位ルートのサブツリーに含まれる同一 `projTag` の子ノードを、独立ルートとして二重表示しないよう除外。

#### 整理
- デバッグログ除去: `ghAuthInContainer` / `ghLoadAndSetBlob` の `console.debug` 2件を削除。`window.onerror`（ユーザー向けエラーバナー）・各 `console.error`/`console.warn`（正規のエラーハンドリング）・`[Diag]` 接続診断・ServiceWorker 登録ログは保持。

### サイズ変化
- app.js: 9455 → 9518（Phase列ロジック削減と各ハンドラ追加の差し引き）
- `node --check` OK。主要関数マーカー（olKeyDown / renderEntry / projHdrKeyDown / _renderProjectAggregateSection 等）の重複なしを確認。

---

## v1.4.9-05300020-gsr-kbd-nav (2026-05-30)
### 機能追加 — 全データ検索ドロップダウンのキーボードナビ

全データモード（`Ctrl+Shift+;`）で検索結果に対してマウス不要で操作できるよう、↑↓ ナビゲーションと Enter 確定を実装。

- **検索バー入力中の ↑/↓** で `#ol-incsearch-global-results` 内の項目を上下移動。
  - 先頭/末尾で stay-at-edge（wrap-around しない）
  - `_olSetGlobalActiveItem(idx, scrollIntoView)` で `.active` クラスを排他切替＆スクロール（`scrollIntoView({ block: 'nearest' })`）
- **Enter で確定**: アクティブ項目（既定は先頭）を `click()` してジャンプ。検索バーが閉じてノートが開く。
- **マウスホバー連動**: `onmouseenter` でアクティブ項目を切替（キーボードとマウスの状態を一致）。
- **検索結果が更新されたら自動リセット**: `_olRenderGlobalSearchResults` の末尾で `_olGlobalActiveIdx = 0` に戻し、先頭を `.active` で初期化。
- **現ノートモードは無変更**: スコープが `current` のときは ↑↓ ナビを発動しないので、既存のフィルタ動作・テキスト入力のキャレット移動を阻害しない。

#### 視覚効果
- `.ol-gsr-item.active`: `accent-soft` 背景＋アクセントカラーの内側 box-shadow ＋テキストもアクセントカラーで太字。hover との明確な区別をつけつつ、両者がほぼ同じ「次に飛ぶ候補」を意味するように設計。

### 新規 / 変更
- JS: `_olGlobalActiveIdx` 状態変数、`_olSetGlobalActiveItem(idx, scrollIntoView)`、`olIncSearchKey` に ↑/↓/Enter 拡張、結果要素に `data-gsr-idx` / `onmouseenter` 追加。
- CSS: `.ol-gsr-item.active` / `.ol-gsr-item.active .ol-gsr-text`。

### サイズ変化
- app.js: 9421 → 9455 (+34行) ／ CSS: 4079 → 4086 (+7行)
- `node --check` OK。

---

## v1.4.8-05300010-indent-guides (2026-05-30)
### 機能追加 — インデントガイド線（Workflowy 風）

深い階層のアウトラインで「どの行がどの親に属するか」が一目でわかるよう、各ノード行にインデント階層分の縦ガイド線を表示。

- **描画**: ノード描画時に `n.indent` 個の `<span class="ol-indent-guide">` を `.ol-row` 内に挿入。各 span は `left = g*22 + 19` 付近（親階層の bullet 中央付近）に `position: absolute` で配置。
- **インタラクション**:
  - 通常時は `opacity: 0.45` で控えめに
  - 行ホバー時は `opacity: 0.7` でやや強調
  - **行フォーカス時（`:focus-within`）はアクセントカラーで描画** — 現在編集中のノードが「どの親系列に属するか」を瞬時に把握できる
- **アクセシビリティ**: `aria-hidden="true"` で読み上げから除外、`pointer-events: none` でクリック影響なし
- **無影響**: contenteditable 領域や bullet・ハンドラには触れていない（既存挙動は完全に維持）

#### 副次的な改善
- `.ol-row` に `position: relative` を追加（ガイド線の絶対配置基準）。他の要素は元から flex で配置されているため影響なし。

### 新規 CSS
- `.ol-row { position: relative; }`
- `.ol-indent-guide` / `.ol-row:hover .ol-indent-guide` / `.ol-row:focus-within .ol-indent-guide`

### サイズ変化
- app.js: 9408 → 9421 (+13行) ／ CSS: 4059 → 4079 (+20行)
- `node --check` OK。

---

## v1.4.7a-05292240-progressive-fix (2026-05-29)
### バグ修正（v1.4.7 のフォローアップ）
- **ズーム中（フォーカスモード）でパンくず行にカーソルがあるとき、Ctrl+↓ が段階展開ではなく「最初の子へ移動」として捕捉されていた問題を修正**
  - 原因: `olKeyDown` の `_olFocusMode` パンくず処理で `ev.key === 'ArrowDown'` を Ctrl 修飾子の有無に関わらず捕まえていた。Ctrl+Enter（サブタスク展開）も同様に意図せず捕捉されていた可能性あり。
  - 修正: `!ev.ctrlKey && !ev.metaKey` を分岐条件に追加。Ctrl 系修飾子付きは後段の専用ハンドラへ譲るようにした。
  - 影響範囲: ズーム中（タイトル編集行）での Ctrl+↑/Ctrl+↓/Ctrl+Enter のみ挙動が変化（本来期待される動作に修正）。修飾子なしの ↓/Enter/Tab は従来通り「最初の子へ移動」。

---

## v1.4.7-05292200-progressive-collapse (2026-05-29)
### 機能拡張 — 段階的な階層折り畳み・展開（Ctrl+↑ / Ctrl+↓）

複雑なネスト構造のアウトラインで、情報量を段階的にコントロールできるよう、Ctrl+↑/↓ の挙動を「1回で全閉/全開」から「1階層ずつ進める」方式へ進化させた。

#### Ctrl+↑（段階的折り畳み）
- 対象の親ノードにフォーカスがある状態で実行：
  - 配下のサブツリーで現在「展開中（`collapsed=false`）かつ子を持つ」**最深 indent** の階層を探し、その階層のノード群を一気に折りたたむ
  - 連続操作で「下位 → 上位」の順に1階層ずつ畳まれ、最終的に親ノード自身が `collapsed=true` になる
- 例外: 子がない／親自身が既に collapsed → **何もしない**（描画スキップ）

#### Ctrl+↓（段階的展開）
- 親ノードにフォーカスがある状態で：
  - 親自身が collapsed なら、まず親を1段階展開
  - そうでなければサブツリー内で「`collapsed` かつ子を持つ」**最浅 indent** を探し、その階層を一気に展開
- 連続操作で「上位 → 下位」の順に1階層ずつ開かれ、最終的に最下層まで全展開
- 例外: 完全展開済み／子なし → **何もしない**

#### 設計詳細
- 新規関数: `olProgressiveCollapse(nodes, rootIdx)` / `olProgressiveExpand(nodes, rootIdx)`
- 両関数とも boolean を返し、変化なしなら呼び出し側で `olRender` をスキップ → 不要な再描画を防ぐ
- **`collapsed` 親の配下スキップ**: `skipDepth` 変数で「画面に見えていないノード」を走査対象外に。ユーザーの視覚と一致するロジック
- 既存挙動との互換:
  - 子が1階層しかない場合: 新旧の結果は同一（1回で全閉/全開）
  - searchsummary 行（仮想行・子なし）: `olHasChildren` で弾かれ既存挙動を維持

#### 検証ケース（3階層 root→A→A-1→leaf、root→B→B-1→leaf）
| 操作 | 結果 |
|---|---|
| Ctrl+↑ ① | A-1 / B-1 が collapsed（3階層目が隠れる） |
| Ctrl+↑ ② | A / B が collapsed（2階層目が隠れる） |
| Ctrl+↑ ③ | root が collapsed（完全折り畳み） |
| Ctrl+↑ ④ | 何もしない |
| Ctrl+↓ ① | root が展開（A, B が見える） |
| Ctrl+↓ ② | A / B が展開（A-1, B-1 が見える） |
| Ctrl+↓ ③ | A-1 / B-1 が展開（leaf まで全展開） |
| Ctrl+↓ ④ | 何もしない |

### サイズ変化
- app.js: 9302 → 9408 (+106行)
- `node --check` OK。

---

## v1.4.6-05290940-incsearch-global (2026-05-29)
### 機能拡張 — インクリメンタル検索の全データ横断モード + マッチ単語ハイライト

v1.4.2 で導入した「Ctrl+;」のインクリメンタル検索を二段構えに拡張。「今開いている日」だけでなく「全データ」も同じUIでシームレスに検索できるようにし、さらにマッチした単語自体を視覚的にハイライトする。

#### 1. スコープ切替（このノート ⇄ 全データ）
- 検索バーに「📄 このノート」/「🌐 全データ」のトグルボタンを追加。クリックで両モード切替。
- **新ショートカット**: `Ctrl+Shift+;` で「全データモード」を直接起動 / 検索バーが開いていれば全データへスコープ切替。
- 各モードのプレースホルダーも切替（「このノート内を絞り込み...」/「全データから検索...」）。
- 状態 `_olIncSearchScope = 'current' | 'all'` で管理。

#### 2. 全データモードの結果ドロップダウン
- 全データモード時は、検索バーの直下に `#ol-incsearch-global-results` を表示。
- 各結果行: 上段に `📅 M/D（曜）` / `📂 プロジェクト名`、下段にアイコン＋テキストプレビュー（マッチ前後24/36文字 + 中央 `<mark>` ハイライト）。
- 日付の新しい順、最大200件（保護上限）。
- 行クリックで `closeIncSearchBar()` → `openNotePanelToDate(date, id)` でジャンプ。
- Enter で最初の結果にフォーカスジャンプ。

#### 3. マッチ単語ハイライト（<mark class="ol-incmark">）
- 現ノートモードでも、マッチした単語自体に `<mark>` を挿入して可読性を強化。
- **DOM編集の安全策**:
  - `TreeWalker` で `.ol-text` のテキストノードのみを走査（既存の HTML 構造を壊さない）
  - **フォーカス中ノードはスキップ** — カーソル位置が飛ぶことを防ぐ
  - `_olStripIncMarks(rootEl)` で再描画前にすべての `<mark.ol-incmark>` を解除（フォーカス中は維持）
- **データに混入しない**: `olSaveTxt` で `<mark class="ol-incmark">…</mark>` を保存対象から除去する正規表現を追加。何かの拍子に保存されても次回ロード時には消える。

#### 新規 / 変更
- JS: `_olIncSearchScope` ／ `_updateIncSearchScopeUI()` ／ `olIncSearchToggleScope()` ／ `_olStripIncMarks(rootEl)` ／ `_olWrapMarksInElement(el, qLc)` ／ `_olRenderGlobalSearchResults(q)` ／ `toggleIncSearchBar(forceScope)` 引数追加。
- DOM: `#ol-incsearch-scope-btn` ／ `#ol-incsearch-global-results` ／ `mark.ol-incmark`。
- CSS: `mark.ol-incmark`（ダークモード対応分岐込み）／ `.ol-incsearch-scope` / `.active` ／ `#ol-incsearch-global-results` ／ `.ol-gsr-item` / `.ol-gsr-date` / `.ol-gsr-body` / `.ol-gsr-icon` / `.ol-gsr-text` / `.ol-gsr-item.done` / `.ol-gsr-empty`。
- ショートカット拡張: `Ctrl+Shift+;` を追加（`Ctrl+;` は据置）。

### サイズ変化
- app.js: 9086 → 9302 (+216行) ／ HTML: 516 → 520 (+4行) ／ CSS: 3957 → 4059 (+102行)
- `node --check` OK。

---

## v1.4.5-05290910-aggr-filter (2026-05-29)
### 機能追加 — 集約セクションにフィルタUI

プロジェクトノート末尾の自動集約セクションに、3モードのフィルタトグルを追加。プロジェクトに紐付くノードが増えてきたときの「未完だけ確認」「直近の動きだけ確認」といったユースケースを支援。

- **3モードのフィルタボタン**: ヘッダー直下に `[すべて | ☐ 未完 | 📅 直近2週]` を表示。
  - **すべて**（デフォルト）: 従来通り全件
  - **未完**: 親または子孫のいずれかに `isTodo && !checked` を含むグループのみ。コンテキスト保持のため、未完を1件でも含めばサブツリー全体を表示。
  - **直近2週**: グループの日付が今日含む14日以内のものだけ。プロジェクトノート発（`proj:N`）のグループは時系列を持たないため常に含める。
- **同じボタン再クリックで解除**: `すべて` 以外の同じモードを再度クリックすると `すべて` に戻る（トグル動作）。
- **カウント表示の連動**: 「N件（親M+子孫K）/ D日」のカウントはフィルタ後の値。フィルタ適用中の実体を直接把握できる。
- **空メッセージ**: フィルタ結果がゼロ件のときは「— 現在のフィルタでは該当なし —」を表示してフィルタ操作に戻れることを示す。
- **状態管理**: `_projAggrFilter = Map<pi, 'all'|'todo'|'recent'>` でセッション内保持。プロジェクトごとに独立して切替可能。

### 新規関数 / CSS
- JS: `setProjAggrFilter(pi, mode)` ／ 状態変数 `_projAggrFilter`
- CSS: `.ol-proj-aggr-filter` ／ `.ol-aggr-fbtn` ／ `.ol-aggr-fbtn:hover` ／ `.ol-aggr-fbtn.active` ／ `.ol-proj-aggr-empty`

### サイズ変化
- app.js: 9023 → 9086 (+63行) ／ CSS: 3916 → 3957 (+41行)

---

## v1.4.4-05282250-aggr-descendants (2026-05-28)
### 機能拡張 — プロジェクトノート自動集約に「子孫ノード」を包含

要件原文「タグを付与したノード**及びその配下**はカードとして関連するプロジェクトグリッドに表示される」と整合させるため、集約セクションを「親ノード + サブツリー」のセット単位で取り込むよう拡張。

- **収集ロジックの変更**: `_renderProjectAggregateSection` を「`projTag` を持つ親ノード（ルート）+ その直後の indent がより深い後続ノード（子孫）」のまとまりで取り込むよう改修。`getGridItems` の親子継承挙動と整合。
- **表示**: 親はそのまま、子孫は親からの相対インデントを `padding-left` でネスト表現。`.ol-proj-aggr-item.is-child` クラスを付与してフォントを 11px に・色を `--tx2` に控えめ化。
- **カウント表記の詳細化**: 「N件（親M+子孫K）/ D日」と内訳表示（子孫が無い場合は従来通り「N件 / D日」）。
- **完了非表示との連動**:
  - 親自体が完了TODOで除外される場合は、サブツリーごとスキップ（文脈が見えなくなるのを防ぐ）
  - 子孫の中の完了TODOは行単位で除外
- **新関数**: `_renderAggrItemHtml(dk, n, depth)` を切り出し、ルート行・子孫行を共通化。
- **新CSS**: `.ol-proj-aggr-item.is-child` / `.ol-proj-aggr-item.is-child:hover` / `.ol-proj-aggr-item.is-child .ol-proj-aggr-text` / `.ol-proj-aggr-item.is-child .ol-proj-aggr-icon`。

### 設計判断
- **「次の同レベル以下まで」をサブツリーとして判定**: 配列を線形走査して `indent > 親.indent` の間を子孫として取り込む。`getTreeOrderedItems` と同じ前提。
- **入れ子の `projTag` 持ち親への対応**: 子孫の中に別の `projTag` を持つノードがあっても、外側のループでも独立して検出されるため、重複表示は発生しない（外側ループは内側親までも root として拾うが、内側親は別グループとして子孫を持つ）。**ただし** これは現状の挙動として許容：同一ノードが「外側親のサブツリー」としても「自身のルート」としても出る可能性あり。実用上の問題が出れば次バージョンで重複除去を検討。

### サイズ変化
- app.js: 8984 → 9023 (+39行) ／ CSS: 3902 → 3916 (+14行)
- `node --check` OK。

---

## v1.4.3a-05282215-aggregate-fix (2026-05-28)
### バグ修正（v1.4.3 のフォローアップ）
- **集約セクションの折りたたみ（▼/▶）が効かない問題を修正**: `toggleProjAggr(pi)` で `_olLastRenderKey = ''` を行ってから `olRender()` を呼ぶように変更。これがないと `renderKey` が変わらないため再描画がスキップされてしまい、UI が更新されなかった。集約状態を `renderKey` に含めるよりも、トグル箇所でキャッシュをクリアする方が侵襲が小さい。
- **「完了非表示」が集約セクションに連動しない問題を修正**:
  - `_renderProjectAggregateSection` 内で `_hideDone && n.isTodo && n.checked` のノードを集約対象から除外。「N件」のカウントも実際の表示と一致するようになった。
  - 加えて `toggleHideDone()` 自体も `_olLastRenderKey = ''` で強制再描画するように変更（本体に完了タスクが無く、集約だけに存在するケースで再描画スキップされていた）。

---

## v1.4.3-05282150-project-aggregate (2026-05-28)
### 機能追加 — プロジェクトノートに「自動集約セクション」

要件「プロジェクトごとのアウトラインに、デイリーのアウトラインで紐づけられた議事録やメモが集約される」を実装。

- **集約セクションの自動表示**: プロジェクトノート（`date = 'proj:N'`）を開くと、通常ノードの描画後に末尾セクション `<div class="ol-proj-aggr">` が自動的に追加される。
- **集約対象**: 全 `S.dailyOutline` を走査し、`n.projTag === proj.name.replace(/\s+/g,'_')` でテキスト内容のあるノードを抽出。プロジェクトノート自身（`proj:N`）と空ノードは除外。
- **表示形式**:
  - ヘッダー: 「📥 このプロジェクトに紐付くノード [N件 / M日]」（折りたたみ可能・▼/▶）
  - 日付ごとにグループ化（新しい順、プロジェクト発は末尾）
  - 各日付見出し: `📅 M/D（曜）★今日` / `📂 プロジェクト名` — クリックでその日付ノートへジャンプ
  - 各ノード行: アイコン（☑/☐/🔗/🔖/•）＋テキスト省略形 — クリックで元ノードへジャンプ
  - ToDo完了は半透明＋取り消し線
- **折りたたみ状態**: `_projAggrCollapsed = Set<pi>` でセッション内保持。プロジェクトごとに独立。`toggleProjAggr(pi)` で切替＆再描画。
- **編集不可（表示専用）**: 集約セクション内の項目はクリックでジャンプするのみ。実体は元の `S.dailyOutline[fromDate]` にあり、二重編集や同期問題は発生しない。

### 新規関数 / DOM / CSS
- JS: `_renderProjectAggregateSection(container, pi)` / `toggleProjAggr(pi)` / 状態変数 `_projAggrCollapsed`
- DOM: 動的生成（`olRender` 末尾で `container.appendChild`）
- CSS: `.ol-proj-aggr` / `.ol-proj-aggr-header` / `.ol-proj-aggr-arrow` / `.ol-proj-aggr-count` / `.ol-proj-aggr-body` / `.ol-proj-aggr-day` / `.ol-proj-aggr-date` / `.ol-proj-aggr-item` / `.ol-proj-aggr-item.done` / `.ol-proj-aggr-icon` / `.ol-proj-aggr-text`

### 設計判断
- **集約はビューのみ・データ二重化なし**: ミラーアイテム機構と同じ思想。`projTag` を変更すれば集約も追従、ノードを編集すれば即時反映（次回 olRender 時）。
- **子ノードの取扱い**: 親が `projTag` を持つだけで子も同プロジェクト扱いになる現状ロジック（`getGridItems`）と整合させるため、今版では「直接 `projTag` を持つノードのみ」を集約対象とする最小実装。将来的に「親が `projTag` なら配下も集約」拡張可能。
- **位置**: プロジェクトノート本体の下に区切り線（border-top）付きで挿入。本体のスクロールを邪魔しない。

### サイズ変化
- app.js: 8860 → 8973 (+113行) ／ CSS: 3810 → 3902 (+92行) ／ HTML: 変化なし
- `node --check` 構文OK、`</body></html>` 末尾完結を確認済み。

---

## v1.4.2-05282130-recent-and-incsearch (2026-05-28)
### 機能追加（操作感の改善）

#### E. 「📅 履歴」最近開いた日ドロップダウン
- ノートペインの日付ナビ右側に「📅 履歴」ボタンを追加。クリックで `#ol-recent-popup` を表示し、直近の閲覧履歴から重複除外で最大7日まで一覧表示。
- 表示ラベル: `📅 M/D（曜）★今日` 形式 ／ プロジェクトノートは `📂 プロジェクト名`。
- 行クリックで `openNotePanelToDate(dateKey, null)` でその日付へ即ジャンプ。
- 履歴が少ない場合は、`S.dailyOutline` から「中身のある日付」を新しい順に補完して7件を満たす。
- 外側クリック・`Esc`・再クリックでトグル開閉。位置は画面端で自動調整。
- ツリービュー撤去（v1.4.0）の代替導線として、過去日への素早いアクセスを提供。

#### D. ノートペイン内インクリメンタル検索（`Ctrl+;`）
- ノートペインがフォーカス中に `Ctrl+;` または右側の 🔍 ボタンで `#ol-incsearch-bar` を起動。
- 入力に応じて現在の日のノード行を逐次フィルタ：
  - マッチ行: `.ol-incsearch-hit`（黄色背景＋左罫線で強調）
  - 非マッチ行: `.ol-incsearch-miss`（半透明・hover で可読化）
- ステータス表示：「N 件一致」「一致なし」をバー右端に。
- `Enter` で最初のマッチへスクロール、`Esc` で終了、再 `Ctrl+;` でトグル。
- グローバル検索（`Ctrl+F`）とは別実装。狭いスコープで素早く絞り込み。
- `olRender` 後に `_olReapplyIncSearch()` でハイライトを自動復元（編集や折りたたみで再描画されても検索状態が維持される）。

### 新規関数 / DOM / CSS
- JS: `_getRecentNoteDates(limit)` / `toggleRecentNotePopup(ev)` / `closeRecentNotePopup()` / `toggleIncSearchBar()` / `openIncSearchBar()` / `closeIncSearchBar()` / `olIncSearchRun()` / `olIncSearchKey(ev)` / `_olApplyIncSearchHighlight(q)` / `_olReapplyIncSearch()`
- DOM: `#ol-recent-popup` / `#ol-incsearch-bar` / `#ol-incsearch-input` / `#ol-incsearch-stat`
- CSS: `.ol-recent-pop-*` / `#ol-incsearch-bar` / `.ol-incsearch-icon` / `.ol-incsearch-close` / `.ol-row.ol-incsearch-hit` / `.ol-row.ol-incsearch-miss`

### サイズ変化
- app.js: 8644 → 8860 (+216行) ／ HTML: 501 → 516 (+15行) ／ CSS: 3706 → 3810 (+104行)
- `node --check` 構文OK、`</body></html>` 末尾完結を確認済み。

---

## v1.4.1-05232035-backlink-popup (2026-05-23)
### 機能追加 — ノード間バックリンクの本格化
- **バックリンクチップを件数バッジ1個に集約**: 従来は「↩ リンク元」チップが最大5件横並び（6件目以降は `+N` でクリック不可・全件の情報が見えない）だったのを、「↩ N」の1チップに集約。N はそのノードへ向けて貼られているノードリンク総件数。
- **クリックでポップオーバー一覧表示**: チップをクリックすると `#ol-backlink-popup` がフローティング表示され、各リンク元を以下のように1行ずつ列挙する。
  - 上段: `📅 M/D（曜）` または `📂 プロジェクト名`（リンク元がプロジェクトノートの場合）
  - 下段: リンク元ノードのテキスト本文（省略形・はみ出しは ellipsis）
  - 行クリックで `openNotePanelToDate(fromDate, fromId)` を呼び出し、そのリンク元へジャンプ
- **ソート規則**: 日付の新しい順に並び、プロジェクトノート発のリンク元は末尾にまとめる。
- **インタラクション**:
  - ポップオーバーは画面端で位置自動調整（右端/下端のはみ出しを避ける）
  - 外側クリック・`Esc`・同じチップ再クリックで閉じる（トグル）
  - スクロール対応で件数が多くても全件アクセス可能（max-height: 290px）
- **新規関数**: `_collectBacklinksFor(nodeId)` / `_formatBacklinkDateLabel(dateKey)` / `showBacklinkPopup(nodeId, ev)` / `hideBacklinkPopup()`
- **新規DOM**: `#ol-backlink-popup` / `.ol-bl-pop-header` / `#ol-bl-pop-list` / `.ol-bl-pop-item` / `.ol-bl-pop-date` / `.ol-bl-pop-text`
- **削除**: 使われなくなった `.ol-backlink-bar` クラス。`.ol-backlink-chip` のスタイルは見直し（margin-left を追加してインライン配置を整え、hover の発色を強化）。

### 注意事項
- バックリンクの集計は `S.dailyOutline` 全走査だが、対象は `type:'nodelink'` のノードのみ。プロジェクト数・日数が多くなっても十分軽量。
- `olRender` 内の `_backlinkMap` 集計はバッジ件数取得に維持。ポップオーバー表示時は `_collectBacklinksFor` で再計算（最新状態を保証）。

---

## v1.4.0-05202245-trim-tree-and-header (2026-05-20)
### 削除（UIスリム化）
- **ツリービュー（🌳 全ノート / 年・月ビュー）を完全撤去**: ルート > 年 > 月 > 日 階層を廃止し、各日付ノート・プロジェクトノートは独立したアウトラインとして扱う。`Ctrl+←/→` の日付遷移は維持。
  - 削除関数: `olToggleTreeMode` / `_applyTreeModeUI` / `olZoomToDate` / `olRenderTree` / `olBuildFullView` / `olBuildMvView` / `olShowMonthView` / `_updateZoomBreadcrumb` / `olZoomOut` / `olZoomIn` / `olRenderMonthView` / `olRenderYearView` / `_mvKeyDown` / `_yrKeyDown` / `olMvOpenNode` / `_mvCollapseDay` / `_treeToggle`（デッドコード）／`_DOW_JA` / `_parseDateKey`。
  - 削除状態変数: `_olZoomLevel` / `_olZoomYear` / `_olZoomMonth` / `_olTreeMode` / `_mvCollapsed`。
  - 削除キー: `Alt+Shift+T`（ツリー切替）、`Alt+↑`（ズームアウト）、`Alt+↓`（ズームイン）、`Esc`（ズームアウト）、コマンドパレットの `tree-view` 項目。
  - 削除DOM: `#ol-tree-toggle-btn` / `#ol-tree-container` / `S.dailyOutline['_mv']` バーチャル配列、`olRender` / `olToggle` / `olKeyDown` 内の `_mv` 分岐、`type:'_date_header'` 描画ロジック。
  - 削除CSS: `.tree-hidden` / `.tree-toggle-btn` / `.tree-year*` / `.tree-month*` / `.tree-date*` / `.tree-node-preview` / `.tree-more-hint` / `.tree-proj*` / `.tree-zoom-*` / `.ol-mv-*` / `.ol-date-sep*`。

- **「📝 デイリーノート」見出し・ツールバー4ボタン・ヒント文を完全撤去**: ノートペイン上部から `#today-ol-hd` 全体を削除。日付ナビ＋ノート本体だけのミニマル構成に。
  - 削除関数: `olUpdatePrivateBtn`（参照先 `#ol-private-btn` が消えたため）。
  - 削除CSS: `#today-ol-hd` / `.ol-toolbar` / `.ol-tbtn` / `.ol-tbtn-c` / `.ol-hint`。

### 追加（補完）
- **Ctrl+. スラッシュメニューに「⊞ 表を挿入 (H)」「🖼 画像を挿入 (I)」を追加**: ツールバー削除に伴うアクセス手段確保。既存 `olInsertTable` / `olInsertImageFile` を呼び出し、トリガー文字の自動除去とフォーカス保持を実装。

### 削減サマリ
- app.js: 9170 → 8514 (-656行) ／ HTML: 511 → 495 (-16行) ／ CSS: 3911 → 3651 (-260行)。合計 **約930行のデッドコード削減**。`node --check app.js` 構文OK、`</body></html>` 末尾完結を確認済み。

---

## v1.3.1-05170900-phase-ui-fixes (2026-05-19)
### 修正（v1.3.0 のユーザー指摘3件）
- **Fix1: Phase/リンク列のヘッダ色を他列と合わせる**: `proj-hdr-row td.col-phase` `td.col-link` の背景を `var(--bg2)`（灰色）から `#3b4468`（紺・PJ列のサマリーヘッダと同じ）に変更し、文字色を `#f0f2fa`（白）に。ダークモードでは `#2a3050` を継承。
- **Fix2: Phase列は直下（indent=1）のみ表示**: `getProjPhaseNodes(pi)` の絞り込み条件を `n.type === 'phase' && n.indent === 1` に変更。サブフェーズ（indent>=2）はノート内では表示されるがグリッドには出ない。リンクは現状維持（既存 indent=0 type='link' との互換のため）。
- **Fix3: ノート上の新規ノードが即時グリッドに反映されない**: `olRender('ol-container', 'proj:N')` の末尾で `setTimeout(() => render(), 80)` によりグリッドの Phase列・リンク列を非同期同期。`_projGridSyncTimer` でデバウンスして連続入力時の負荷を抑制。

### 末尾欠落
- Edit 1回で発生 → applyTheme(localStorage...) で切れ → バックアップから補完して 9170 行で完結。

---

## v1.3.0-05170830-tag-phase-normalize (2026-05-17)
### 機能追加（Step 3 + Step 4）
- **Step 3: タグ→phase 自動正規化（両対応）**:
  - `node.tags` の中から、当該プロジェクトの「Phase」見出し直下のノード名と一致するタグがあれば `node.phase` に自動格納。
  - 既存タグ機構を温存し、`tags` も削除しない（両対応）。
  - 実装関数: `getProjPhaseChildrenNames(pi)` / `normalizeNodePhase(node)`。
  - フック1か所: `_renderImpl()` の冒頭で全 projTag 持ちノードを走査して正規化。renderごとに最新 Phase 名と同期される。
  - 効果: ユーザーが「Phase見出しの下に『RFP』を追加」→「タスクに `#RFP` タグを付ける」だけで、グリッドの週セル内でフェーズ別グルーピングの素地ができる（描画分岐は今後）。

- **Step 4: 自動期限ロジック = 既存挙動で達成済み**:
  - `getGridItems()` は「ノードの保存日（`dailyOutline` の日付キー）の wkey」 と セルの `wk` を照合してフィルタリング。
  - `due` を明示的に設定しなくても、書いた日の週セルに自動表示される = ユーザーの「書いた日のその日が期限」要件と等価。
  - 明示的に `due` を設定したノードは `getMirrorItems()` のミラー機構で対象週に表示。
  - 結論: コード変更不要、ドキュメントのみ更新。

### 残り
- Step 6: Git push (`push.bat`) はユーザー指示待ち。
- Step 3-β（将来）: テキスト中の `#XXX` を自動的に `node.tags` に追加するパース機能（現状は @-style UIで追加する必要あり）。

### 末尾欠落
- Edit 1回で発生→バックアップから storage+PWA Service Worker ブロックを補完→正常化。引き続き Edit ごとに即時検証。

---

## v1.2.3-05170800-phase-link-preamble (2026-05-17)
### 機能追加（Step 5 + 利便性向上）
- **プロジェクトノートの予約セクション自動生成（Step 5）**:
  - proj:{pi} ノートを開くと、先頭に「Phase」「Link」見出し（type='phase-root' / 'link-root'）が無ければ自動挿入。
  - 「Phase」見出しの indent>=1 配下に追加されたノードは自動的に `type='phase'` となり、グリッドの Phase列に集約表示。
  - 「Link」見出しの indent>=1 配下に追加されたノードは自動的に `type='link'` となり、グリッドのリンク列に集約表示。
  - 既存の indent=0 type='link' ノード（マイグレ前データ）はそのまま残し、引き続きリンク列に集約される（破壊的変更なし）。
  - 既存の type='todo' などは尊重し、自動上書きしない（条件分岐: 既存 type が空・'phase'・'link' のみ書き換え対象）。
  - 実装関数: `ensureProjNotePreambles(pi)` / `applyProjAutoTypes(pi)`。
  - フック: `toggleNotePanel('proj:N')` 時に予約セクション生成・自動 type 付与（saveState 付き）。 `olRender('ol-container','proj:N')` の前にも `applyProjAutoTypes` を毎回呼ぶ（タブで indent を変えた瞬間に同期）。
- **プロジェクト名クリックでノートへジャンプ**:
  - span.nm に `onclick=projNameClick` / `ondblclick=projNameDblClick` を追加。
  - シングルクリック=ノートを開く（200ms 遅延）、ダブルクリック=リネーム（遅延 click をキャンセル）。
  - 📄 ボタンは互換のため残置。

### 既知の挙動
- 見出しノード（Phase / Link）は通常のノードと見た目同じ。ユーザーが誤って削除した場合、次回ノート再オープンで自動再生成される（idempotent）。
- 見出し自体のリネームは可能（type='phase-root' は維持される）。

### 経緯メモ（オペミス記録）
- 大ファイル編集による末尾欠落が3回連続発生（最大~100行欠落、NULL バイト混入も）。毎回バックアップ＋`head`＋`sed` で復元。**今後 app.js を Edit する場合、編集ごとに即時 `wc -l` + `node --check` を実施し、欠落即復元の方針を徹底**。

---

## v1.2.2-05170720-remove-old-pj-entries (2026-05-17)
### 機能整理（リンク列への統合に伴う旧UI削除）
- **プロジェクト名直下の旧表示エリアを削除**: Phase列・リンク列が正規になったため、PJ列内に出ていた以下の表示を撤去:
  - `proj-entries-toggle`（▼/▶ 折り畳み + 件数 + ＋追加ボタン）
  - `proj-entries-body`（type='link'/'log'/'todo' ノードの一覧）
  - `proj.links` ハードコード版（.plinks/.plink）
- 削除対象は app.js 行 1090-1112 付近の HTML 生成コード。関連関数 `toggleProjEntries()` / `getProjItems()` / CSS の `.proj-entries-toggle` `.plinks` などは互換性のためデッドコードとして残置（次の掃除ステップで除去予定）。
- 既存ユーザーデータ（`proj.projEntriesOpen` `proj.links`）は破壊しないため、表示を戻したい場合はコード復元のみで復活可能。

### 経緯メモ（オペミス記録）
- 編集後 `wc -l = 9011` だが末尾に NULL バイト (`^@`) の長い行が混入し V8 で `Invalid or unexpected token`。`head -9010` で末尾の不正バイト行を切り捨てて修復（9010行・末尾完結）。

---

## v1.2.1-05170700-phase-link-fixes (2026-05-17)
### 修正（v1.2.0 のユーザー指摘2件）
- **Bug1: ノート側削除がグリッドに反映されない**: `Ctrl+Shift+Delete` のサブツリー削除パス（行 6364 付近）で `render()` 呼び出しが抜けていた。`setTimeout(() => render(), 10)` を追加。これで proj:{pi} ノートの type='link' / 'phase' ノードを Ctrl+Shift+Delete で削除した時に、グリッドの Phase列・リンク列が即時に同期される。
- **Bug2: Phase列・リンク列にリサイズハンドルがない**:
  - 状態変数 `_phaseColWidth` / `_linkColWidth` を追加し、localStorage `pwt_phase_col_w` / `pwt_link_col_w` から復元。
  - `startColResize(e, type, colKey)` に `'phase'` / `'link'` 分岐を追加。最小幅は60px。
  - `applyWeekColWidths()` / `initColumnWidths()` で Phase/リンク列の幅も適用するように拡張。
  - thead の Phase列・リンク列 th に `<div class="col-resizer" onmousedown="startColResize(event, 'phase')">` / `'link'` を追加。

### 残課題
- 他にも「ノードのtypeを後から変更した場合のグリッド同期」など同種のレース条件が残る可能性。気付いたら随時対応。

### 経緯メモ（オペミス記録）
- v1.2.1 リリース直後、ブラウザで `Uncaught SyntaxError: Unexpected token '}'` at line 9030 が発生。バックアップ復元時に末尾の `    }`（ServiceWorker 登録 if ブロックの閉じ）を重複追加していた。`head -9029` で末尾1行を切って修復。ブラウザは `node --check` より厳しい場合があるので、編集後はブラウザ実機での確認が必要。

---

## v1.2.0-05170630-phase-link (2026-05-17)
### 機能追加（xlsx「グリッド表示」仕様への整合：Step 1〜2）
- **データモデル拡張**: `Node` に `phase: string`（フェーズ名）を追加。`type` に `'phase'` を許容。
  - 後方互換: 既存ノードには `phase` フィールドが無くても `n.phase || ''` で安全に動作。
- **グリッドに Phase列・リンク列を追加**: プロジェクト列の右に2列を sticky で固定（横スクロール時も常時表示）。
  - `--phase-col-w: 140px` / `--link-col-w: 160px` を CSS 変数に追加。
  - `proj:{pi}` ノートの `type='phase'` ノードを Phase列に集約、`type='link'` ノードをリンク列に集約。
  - 各項目クリックで `openNotePanelToDate('proj:{pi}', nodeId)` により該当ノードへジャンプ。
  - 空セルには「＋Phaseを追加」「＋リンクを追加」のプレースホルダ（クリックでプロジェクトノートを開く）。
- **ヘルパー関数追加**: `getProjPhaseNodes(pi)` / `getProjLinkNodes(pi)`（行 758 付近）。
- **colspan 調整**: 「プロジェクト追加」行の colspan を `WEEKS + 1` → `WEEKS + 3` に変更。
- `proj-hdr-row`（プロジェクトヘッダ行）にも Phase/リンク列セルを追加（件数バッジ表示）。

### バックアップ
- `BKP/*.bak3_20260517_062217_phase-link-refactor` に4ファイル退避済み（app.js / project-weekly-tracker.html / style.css / data.json）。

### 残課題（次セッション）
- **Step 3**: タスクのフェーズ自動正規化（タグ `#RFP` → `node.phase='RFP'` への両対応）。
- **Step 4**: 自動期限ロジック（書いた日＝仮想期限）の明示実装（現状の挙動と実質等価のためドキュメント整理のみ予定）。
- **Step 5**: プロジェクトノートに「Phase」「リンク」の予約セクションUIを追加し、ノードに `type` を自動付与。
- **既存 type='link'**: HACCP等のプロジェクトに既に `type='link'` ノードがあるためリンク列にはすぐ反映される。Phase列は新規追加待ち。

### 検証
- `node --check app.js` OK / `wc -l app.js` = 9002 行（バックアップ8927行 + 拡張75行）。
- 大ファイル編集による末尾欠落（105行）が発生したが `head + tail_restore` で完全復元済み。

---

## v1.1.1-05110130 (2026-05-11)
### 修正
- **Ctrl+V で構造ペースト**: 「色々消えてしまう」問題を解消。
  - `paste` イベントを `#ol-container` でフックする `olContainerPaste(ev)` を新設。
  - `ev.clipboardData.getData('text/plain')` が `_olMultiClipboard.text` と一致したら `preventDefault()` して構造ペーストを実行。一致しなければネイティブのテキストペースト。
  - これにより通常の Ctrl+V でも、コピー元のインデント・ToDo・色・タグ・projTag 等のメタが保たれる。
- **外部多行テキストもインデント解釈**:
  - クリップボードに改行が含まれていれば、`2スペース=1インデント`（タブは4スペース換算）でパースして複数ノードに分割。
  - 単一行ペーストはネイティブ動作のまま維持し、編集を阻害しない。
  - 貼付先ノードがテキスト空なら最初の行をそのノードに反映し、残りを直後に挿入。
- トーストメッセージを `Ctrl+V でそのまま貼り付けられます` に更新。
- `Ctrl+Shift+V` のキーボードショートカットも引き続き機能（バックアップ経路）。

### 注意
- 大ファイル編集で末尾欠損が再発。`head+tail` マージで 8927 行に復元、`node --check` OK。

---

## v1.1.0-05110026 (2026-05-11)
### 追加（デイリーノート: 複数行選択を本格対応）
- **Shift+クリックで範囲選択**: 現在フォーカス行から目的の行までを一括選択。
  - `olContainerMouseDown(ev)` を新設し `#ol-container` の `onmousedown` にバインド。
  - contenteditable のキャレット移動を `ev.preventDefault()` で抑止し選択状態を可視化。
  - `_olMouseShift` フラグで `ol-text` の `onfocus` 時の自動選択解除を抑制。
- **連続範囲の Alt+Shift+↑↓ ブロック移動**: 複数選択中は選択ブロックごと上下移動。
  - `olGetContiguousSelectionRange(nodes)` を新設し、サブツリーを含む union が連続かを判定。
  - 非連続選択時は「⚠️ 選択範囲が連続していないため移動できません」とトースト表示。
- **Delete キー単独で一括削除**: 2件以上選択中の Delete は選択ノードと各サブツリーを削除。
  - 単一/未選択時はネイティブ動作（テキスト削除）を維持。
  - 既存の Ctrl+Shift+Delete もそのまま動作。
- **Ctrl+. → 「別の日へ移動」を選択ノード群に対応**: マルチセレクト中に Ctrl+. を押した時点の選択を `_olSlashMulti` にスナップショット。確定時に `olMoveSelectedToDate(fromDate, toDate)` で一括移動。
  - トップレベル選択ノードのサブツリーを保ったまま移動。順序は維持。
  - 移動先が表示週外なら `S.wOff` を自動調整（単一移動と同じ挙動）。
- **コピー/カット/構造ペースト**:
  - Ctrl+C: 既存のテキストコピーに加え、`_olMultiClipboard` に深いコピーを保存（Ctrl+Shift+V 用）。
  - Ctrl+X: マルチセレクト中はコピー＋削除でカット。
  - Ctrl+Shift+V: `_olMultiClipboard` の構造を現在フォーカス行の直後に挿入。インデントは貼付先の `indent` を基準に正規化、新ID付与、`parentId` はクリア。
  - 通常の Ctrl+V はネイティブのプレーンテキスト動作のまま（既存挙動を破壊しない）。
- **選択中の視覚フィードバック改善**:
  - `.ol-row.ol-selected` に `box-shadow: inset 3px 0 0 var(--accent)` で左側の強調線を追加。
  - 選択行内の `.ol-text` は `caret-color: transparent` でキャレットを非表示にし「選択モード」を明示。
- **Escape で選択解除**: 選択中の Escape は最初に選択クリア → 次回押下でフォーカスモード終了の優先順位。

### 内部実装
- `_olSelected` の状態を `renderKey` に含めることでマルチセレクト変化時の描画スキップを防止。
- `olCollectSelectionBlocks(nodes)` で「先祖が選択されていないトップレベル選択ノード」を抽出。子孫として既に含まれるノードは自動除外。
- 新規ヘルパー: `olCollectSelectionBlocks`, `olGetContiguousSelectionRange`, `olMoveSelectedToDate`, `olPasteMultiClipboard`, `olContainerMouseDown`。
- HTML 側の操作ヒントに `Shift+Click・Shift+↑↓:複数選択` を追記。

### 既存動作の保護
- 単一選択時の Alt+Shift+↑↓ / Delete / Ctrl+C / Ctrl+X / Ctrl+V は従来通り。
- マルチセレクト発火条件は `_olSelected.size >= 2`（または該当ショートカット）に限定し、通常編集を阻害しない。

### 注意
- 大ファイル編集中に末尾欠損が発生（既知の課題）。`head + tail` マージで 8839 行に復元、`node --check` で構文 OK 確認済み。

---

## v1.0.4-04300103 (2026-04-30)
### 追加
- スパンバー本体クリックで「元ノード（デイリーノート）へジャンプ」する導線を追加。
  - バー本体クリック → `openNotePanelToDate(originDate, sn.id)` でノートパネルを開いて元ノードにフォーカス。
  - ✏アイコンクリック → 従来通り `openPanel` で詳細パネル。
- `.span-inline-bar` の cursor を `pointer` に変更し、ホバー時に `filter: brightness(1.1)` で明るくなるようにした。
- title 属性に「クリック: 元ノードへ移動 ／ ✏: 詳細パネル」を表示してUIヒントを改善。

### 経緯
- v1.0.3 で✏アイコンによる詳細パネル導線は追加したが、ユーザーから「元ノードへの導線がない」との指摘。
- バー＝ノードへのリンク、✏=詳細パネル、と役割を分担させて両方アクセス可能に。

---

## v1.0.3-04300047 (2026-04-30)
### 追加
- スパンバー（`.span-inline-bar`）に編集アイコン✏を追加（案②採用）。
  - バー右端の✏をクリック → `openPanel(pi, originWk, sn.id)` でそのスパンノードの詳細パネルが開く。
  - `originWk` は `sn.date || sn.startDate` から `wkey()` で算出。
  - バー本体は従来通り `event.stopPropagation()` のみで誤爆防止。
- `style.css` に `.span-bar-text` / `.span-bar-edit` / `.span-bar-edit:hover` を追加。

### 経緯
- ユーザー指摘: 「複数週にまたがるスパンノードはバー（装飾）とカード（実体）の二重存在で、バーをクリックしても編集できず不便」
- 検討した3案のうち、リスク最小の案②（編集アイコン追加）を採用。
- 将来的には案③（colspan で本物のセル化＝Phase 4 構想）へ進化予定。

---

## v1.0.2-04251135 (2026-04-25)
### 削除
- スパンバーのオーバーレイ描画（`renderSpanBars()` の `.span-overlay-layer`）を廃止。
  - 関数本体は早期 return の no-op 化（既存オーバーレイ層が残っていれば除去のみ実施）。
  - 旧コードはコメント `eslint-disable-next-line no-unreachable` の下に残置。

### 経緯
- インライン描画とオーバーレイの二重描画で「同名スパンが色違いの2本に見える」問題が発生。
- ユーザー判断: オーバーレイは廃止し、インライン描画に一本化。

---

## v1.0.1-04251059 (2026-04-25)
### 追加
- `computeSpanLanesForProject(pi)`: プロジェクト内のスパンを `node.text` 単位でレーン番号に割り当てる関数を追加。
- 同名スパンは常に同じレーン（W4/20の出張メモ と W4/27の出張メモ が縦位置揃う）。
- 欠けレーンには `visibility:hidden` のプレースホルダを置いて全列でバー位置を維持。
- バー色も `laneIdx` ベースで安定（同名スパンは常に同色）。

### 経緯
- ユーザー指摘: 「複数のスパンに分かれている大項目」のレーン位置がズレる。
- 提案した3案（A: 名前束ね / B: 週横断レーン割当 / C: rowspan化）のうち案A採用。

---

## v1.0.0-04241534 (2026-04-24)
### Phase 3 完了
- ダークモード配色刷新（#1c1e22 ウォームスレート）
- 週マタギ スパンバー `renderSpanBars()` 実装（オーバーレイ方式）
- ショートカット追加（Alt+0〜3, Alt+D）
- ノートビューを `olRender` に統一（月/年/全ノート）
- `_mv` バーチャルノード方式
- 全ビューで ↑/↓・Ctrl+↑/↓・Enter・Alt+T 統一
- プロジェクトノートも全ノートビューに表示

---

## Phase 2 (v0.9.7)
- `getAllNodes()` / `ensureNodeDates()` 統合データ層
- WorkFlowyツリービュー（🌳ボタン）

## Phase 1 (v0.9.6)
- File System Access API（IndexedDB でハンドル永続化）
- Node に `startDate` / `endDate` フィールド追加

## Phase 0 (v0.9.5)
- ファイル分割: HTML(491行) + style.css + app.js
- マスコット削除、旧 entries 除去

---

## メンテナンス・ルール
- バージョン更新時は必ず `app.js` の `APP_VERSION` も更新する。
- 大きな変更（>5000行のEdit）の後は必ず `wc -l` + `tail` + `node --check` で末尾欠損を検証する。
- バックアップは `BKP/` 配下に `<filename>.bak3_YYYYMMDD_HHMMSS_<reason>` 形式で残す（最低3世代）。
- コミットは `push.bat` をダブルクリックで実行。
