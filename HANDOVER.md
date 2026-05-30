# 引継ぎメモ (HANDOVER)

このファイルは AI（Claude）が別チャットや別セッションで作業を継続するための引継ぎ情報です。
作業を再開するときは、まずこのファイルと `CHANGELOG.md`・`PROJECT_KNOWLEDGE.md`・`ARCHITECTURE.md` を読んでください。

最終更新: 2026-05-30 / 担当バージョン: v1.10.0-05301915-clip-p2

---

## 1. プロジェクト概要

- **何**: 週次プロジェクト管理ツール（メモツール）
- **思想**: Workflowy のような操作感 + Excel のような俯瞰でのプロジェクト管理を同時実現
- **構成**: 単一ページ Web アプリ（Vanilla JS）
  - `project-weekly-tracker.html` — UI 骨格・モーダル群
  - `app.js` — ロジック全部（〜8500行）
  - `style.css` — スタイル全部（〜3800行）
  - `data.json` — ユーザーデータ（File System Access API + GitHub 同期 + localStorage）
  - `sw.js` — PWA Service Worker
  - `manifest.json` — PWA 設定

- **GitHub**: `Itokonnyaku3/Weekly`
- **公開URL**: https://itokonnyaku3.github.io/Weekly/project-weekly-tracker.html
- **コミット**: `push.bat` をダブルクリック（CRLF形式で作成済み）

---

## 2. 直近の作業状況（v1.0.3）

### 完了したこと
| バージョン | 内容 |
|---|---|
| v1.0.1 | 案A: スパン同名レーン整列（`computeSpanLanesForProject`） |
| v1.0.2 | オーバーレイ描画（`renderSpanBars`）を廃止しインライン一本化 |
| v1.0.3 | スパンバーに編集アイコン✏を追加（案②） |
| v1.0.4 | バー本体クリックで元ノード（ノートパネル）へジャンプ追加 |
| v1.1.0 | デイリーノート: 複数行選択を本格対応（Shift+Click/Alt+Shift+↑↓/Delete/Ctrl+./Ctrl+X/Ctrl+Shift+V）|
| v1.1.1 | Ctrl+V でも構造ペーストを発火。`olContainerPaste` を新設し外部多行テキストも 2sp=1indent で取込 |
| v1.3.0 | タグ→phase 正規化／Phase・Link 予約セクション／プロジェクト名クリック導線 |
| v1.3.1 | Phase/Link 列ヘッダ色／Phase 列を indent=1 のみ／ノート→グリッド即時同期 |
| v1.4.0 | **ツリービュー（年/月/日階層）完全撤去** ／ 「📝 デイリーノート」見出し＋ツールバー4ボタン削除 ／ Ctrl+. メニューに「表(H)」「画像(I)」を追加。約930行のデッドコード削減 |
| v1.4.1 | **バックリンク本格化**: チップを「↩ N」1個に集約、クリックでポップオーバーに全件リスト表示（日付＋テキスト・スクロール対応・トグル開閉） |
| v1.4.2 | **📅 最近開いた日ドロップダウン** + **ノートペイン内インクリメンタル検索 Ctrl+;**: 日付ナビ右に「📅 履歴」/ 🔍 ボタン。検索バーはマッチ行を強調・非マッチを半透明化、`olRender` 後も検索状態を維持 |
| v1.4.3 | **プロジェクトノート 自動集約セクション**: プロジェクトノートを開くと末尾に「📥 このプロジェクトに紐付くノード [N件/M日]」を自動表示。日付ごとグループ化、クリックで元ノードへジャンプ、折りたたみ可能 |
| v1.4.3a | バグ修正: 集約セクションの折りたたみが効かない問題（`_olLastRenderKey` クリア）／「完了非表示」が集約に連動しない問題（`_hideDone` フィルタを追加） |
| v1.4.4 | **集約セクションに子孫包含**: `projTag` を持つ親ノード + サブツリーを1セットで取り込み、子孫は親からの相対インデントでネスト表示。カウントは「N件（親M+子孫K）/ D日」 |
| v1.4.5 | **集約フィルタUI**: 集約ヘッダ下に `[すべて / ☐ 未完 / 📅 直近2週]` トグル。Map<pi, mode>でセッション内保持。フィルタ後ゼロ件は「該当なし」表示 |
| v1.4.6 | **インクリメンタル検索の全データ横断モード**: 検索バーに `[📄 このノート / 🌐 全データ]` トグル、`Ctrl+Shift+;` で直接起動。全データ時は結果ドロップダウン（日付＋プレビュー＋クリックジャンプ）。**マッチ単語に `<mark>` ハイライト**（フォーカス中スキップ、保存対象から除外） |
| v1.4.7 | **段階的折り畳み・展開（Ctrl+↑/↓）**: 1回で全開/全閉ではなく1階層ずつ。最深→最上位の順で畳み、最浅→最下層の順で展開。collapsed 親配下はスキップ（視覚と一致） |
| v1.4.7a | バグ修正: ズーム中（フォーカスモード）のパンくず行で Ctrl+↓ が「最初の子へ移動」として捕捉されていた問題（`_olFocusMode` 分岐に Ctrl/Meta ガードを追加） |
| v1.4.8 | **インデントガイド線**: 各ノード行に indent 数分の縦線を `position:absolute` で挿入。深い階層で親子関係を視覚化。フォーカス中はアクセントカラーで強調 |
| v1.4.9 | **全データ検索ドロップダウンの↑↓ナビ**: Ctrl+Shift+; の結果リストを ↑/↓ で移動・Enter で確定。`.active` クラスで強調＋スクロール追従＋マウスホバー連動 |
| v1.5.0 | **Phase列廃止＋キーボード操作5種**: ①Phase 列を撤去しプロジェクト名直下に全件表示（`.proj-phase-list`）②グリッド親アイテムに ▼/▶ 折り畳みトグル＋子件数バッジ（`gridCollapsed`）③N3 `Ctrl+Enter`=ノートTODOトグル ④N6 `Ctrl+Shift+↑/↓`=兄弟ノード移動 ⑤G5 `Space`=セルTODOトグル ⑥G8 `Ctrl+↑/↓`=行一括折り畳み ⑦G9 `Alt+←/→`=表示週スクロール。集約セクションの入れ子 projTag 重複除外（`claimedIdx`）。`console.debug` 2件除去 |
| v1.6.0 | **フォーカス系3課題**: ①`Alt+Shift+N`閉じる時に`refocusGrid()`で記憶位置へ復元＋`Alt+Shift+G`新設（ノート維持でグリッドへ）②全データ検索ドロップダウンの`onmouseenter`を`_olGsrHover`化し`body.kb-nav`中はホバー選択を無視（キー操作がマウス位置に奪われない）③入力ボックス↓で次PJの**先頭**アイテムを選択（旧: 最下段）。既存`focusKey`/`refocusGrid`/`kb-nav`の再利用で局所修正 |
| v1.10.0 | **コピペ Phase2: リッチHTML貼付**: 外部HTMLをサニタイズ(`olSanitizeFragment`/`olFilterStyle`・ホワイトリスト・script/img/on*/javascript:除去)してノード化(`olParseHtmlToNodes`・ul/ol入れ子→indent・h→strong・インライン装飾はnode.html保持)。`olContainerPaste`に①.5追加(リッチかつ複数/構造のみ介入・単一インラインはネイティブ委譲)。外部imgは除去(P4)・表TSVはP3。実機検証済 |
| v1.9.0 | **コピペ堅牢化 Phase1**: システムクリップボード＋独自マーカー`data-pwt-clip`(text/htmlにノードJSON)方式へ。完全一致依存を解消し「貼れない」事象をなくす。Ctrl+C/X単体対応・Ctrl+A全選択・olContainerPaste統合(画像/マーカー/テキスト)・olSetupPasteHandler no-op化(二重リスナー解消)・構造ペーストでparentId保持。仕様書=`仕様書_コピペ貼付機能.md`。残: P2リッチ(HTML・要サニタイズ)/P3表/P4画像 |
| v1.8.0 | **課題6: ノート作成日とグリッド週の分離（gridWk）**: `node.gridWk`(表示週オーバーライド)追加。`getGridItems`/`getMirrorItems`を実効週(`gridWk||wkey(date)`)ベースに。`eDrop`/`eDropOnItem`は日付移動せず`setGridWkSubtree`で親子まとめてgridWk設定/解除(本来週で解除)。`quickAdd`/`savePanel`新規は現在週以外で作成日=今日+gridWk。後方互換。制限: 混在セルの厳密並べ替えは非保証 |
| v1.7.1 | **projTag孤立バグ修正**: プロジェクト名リネームで既存ノードのprojTagが旧名のまま孤立→グリッド消失（本番179件）。`startRename`を改名時にprojTag一括更新するよう修正＋`data.json`の孤立タグをリマップ（HACCP→PJ.HACCP 108・管理・全般→０．管理・全般 73）。残: 店舗DXサポート/AI_ビーコン(計8・改名先不明)、`_mv`キー653ノード(無効キー滞留・別途) |
| v1.7.0 | **グリッド視認性（案C）**: ①`.eitem`をカード→密アウトライン化（枠/影/余白削減・`.wcell`/`.elist`圧縮）②`projColor(pi)`+`PROJ_PALETTE`で各PJ2行に`--pc`付与→サマリーバンド色・左色帯・アイテムセル淡色着色（`color-mix`）③週列に白い縦区切り線。ユーザー反映でPJ名チップ撤去・バンド高さ圧縮。`color-mix`依存（要対応ブラウザ） |

詳細は `CHANGELOG.md` 参照。

### 進行中バッチ（2026-05-30 米山さん依頼の6課題）
v1.6.0 **課題1・2・5（フォーカス系）完了** → v1.7.0 **課題3（視認性・案C）完了** → v1.7.1 **割り込みバグ（projTag孤立）修正** → v1.8.0 **課題6（gridWk）完了**。残り:
- **課題4 3日分バックアップ**（低優先・最後）: ユーザー希望は「Git上にデータがあるのでそこに」。既存の `ghSyncSave` / push.bat の自動コミット履歴が土台。
- 追加課題（左セル横スクロール）は上記「残課題」セクション参照。
- **追加課題（コピペ/複数選択の同等化）**: **Phase1完了=v1.9.0**（マーカー方式・Ctrl+A/単体C/X・ハンドラ統合・parentId保持）、**Phase2完了=v1.10.0**（リッチHTML貼付・サニタイズ・入れ子/見出し/装飾保持）。残り **P3表(TSV/HTML表→表ノード・コピー出力)→P4画像往復(コピー時に画像保持/外部img)**。画像はGitHub必須維持。**仕様書: `仕様書_コピペ貼付機能.md`**。次セッションはP3から。

### 残課題（次セッションで検討するもの）
- **大文字小文字の区別 / 正規表現モード**: 上級者向けのオプション切替。
- **Phase 4: 真の Gantt 化（案③）**: スパンを `colspan` を使った本物のテーブルセルに昇格させる。これによりバー＝ノード本体となり編集UXがネイティブ化する。但し描画ロジックの大改修が必要。
- **AIパネルの再統合**: Phase 3 の途中で取り残されている。
- **C. app.js のモジュール分割**: 9500行を超えているので、`outline.js` / `grid.js` / `tags.js` のような分割を検討。デグレリスクが大きいので慎重に。
- **Phase列廃止の後始末（v1.5.0 メモ）**: `_phaseColWidth` 変数・`startColResize` の 'phase' 分岐・`.col-phase` 系 CSS・localStorage `pwt_phase_col_w` が無害なデッドコードとして残置。実害はないが、次回掃除の候補。
- **追加課題（2026-05-30 米山さん）: キーボードで左セルへ移動時の横スクロール**: 矢印キーで左の週セルへフォーカス移動した際、固定列（col-proj/col-link）の裏に隠れてセルが見えないことがある。`applyFocusToElement` は `scrollIntoView({inline:'nearest'})`＋`_scrollClearSticky` を呼ぶが、左方向で固定列ぶんのオフセットが効かないケースがある。左移動時に固定列幅を考慮した水平スクロール補正が必要。
- **孤立 projTag 残り（v1.7.1）**: `店舗DXサポート`(5)・`AI_ビーコン用アンテナ撤去`(3) は改名先不明で未処理。`dailyOutline["_mv"]` に653ノード（projTag付き139）が無効キーで滞留（旧ツリービュー残骸推測）→別途クリーンアップ要。

### v1.5.0 で解消した残課題
- ~~入れ子の `projTag` 持ち親への対応~~ → `claimedIdx` セットで上位サブツリーに含まれる子の独立ルート化を除外（解決）。
- ~~デバッグログの完全除去~~ → `console.debug` 2件を除去。`window.onerror` のエラーバナー・各 `console.error`/`console.warn`・`[Diag]`・SW登録ログは正規機能として保持（実質完了）。
- ~~インクリメンタル検索の発展案~~ → v1.4.6/v1.4.9 で全データ横断・`<mark>` ハイライト・↑↓ナビを実装済み。残るは「大文字小文字/正規表現」のみ（上記参照）。

---

## 3. 現在のグリッド・スパン仕様（v1.0.3 時点）

### スパンノードとは
- `node.startDate` と `node.endDate` を持つノード = "スパン"
- 開始週〜終了週の各セルの上部に `.span-inline-bar` として表示される

### レーン割当（`computeSpanLanesForProject`）
- プロジェクト pi 内の全スパンを集める
- `startDate` 昇順 → `text` 昇順で安定ソート
- `node.text.trim()` をキーとして、初出順にレーン番号を付与（同名は同レーン）
- 戻り値: `{ laneMap: Map<key, laneIdx>, maxLane }`

### 描画の流れ（`_renderImpl` 内）
1. プロジェクトの直前で `spanLanes = computeSpanLanesForProject(pi)` を呼ぶ。
2. 各週セルで:
   - その週をカバーするスパンノード（`weekSpans`）を集める。
   - レーン番号 → スパン の Map (`lanedSpans`) を作る。
   - レーン 0 〜 maxLane を順に走査して、該当スパンが無ければ `visibility:hidden` のプレースホルダを置く（縦位置維持）。
   - 該当スパンがあれば `.span-inline-bar` を出力。バー右端に `.span-bar-edit`（✏）を付ける。
3. 全バーを出した後、子タスク（`parentId === sn.id`）をレーン順にまとめて出力。
4. スパンに属さない通常タスクを出力。
5. 今週なら「継続中（前週より）」のミラーアイテムを出力。

### バーのクリック挙動（v1.0.4）
- **バー本体（.span-inline-bar）クリック** → `openNotePanelToDate(originDate, sn.id)` でノートパネルを開き、元ノードにフォーカスする。
- **✏アイコン（.span-bar-edit）クリック** → `openPanel(pi, originWk, sn.id)` で詳細パネルを開く。
- どちらも `event.stopPropagation()` で wcell のクリックを抑止。
- `originDate` = `sn.date || sn.startDate`、`originWk` = `wkey(originDate)`、なければフォールバックで現在週 `k`。
- バーは cursor:pointer + hover で brightness(1.1)。プレースホルダ（visibility:hidden）はクリック対象外。

---

## 4. 重要なコーディングルール

### CLAUDE.md ルール（絶対遵守）
1. **3世代バックアップ**: コード更新前に `BKP/` へバックアップ（命名: `<file>.bak3_YYYYMMDD_HHMMSS_<reason>`）。
2. **既存機能の担保確認**: 変更後は既存機能が壊れていないか必ず確認。
3. **懸念があれば確認**: 不明点・リスクは必ずユーザーに確認してから実行。

### 大ファイル編集の注意（重要）
- **app.js は約8500行・390KB の巨大ファイル**。Edit ツールで編集すると **末尾が欠落することがある**。
- 編集後は必ず:
  ```
  wc -l app.js          # 行数確認
  tail -3 app.js        # 末尾完結確認
  node --check app.js   # 構文確認
  ```
- 末尾が欠けていたら、バックアップから `head + tail` でマージ復元する手順は既に確立済み（`/tmp/head.js` + `/tmp/tail.js` → `cat > /tmp/merged.js`）。

### バージョン管理
- `app.js` 冒頭の `const APP_VERSION = 'vX.Y.Z-MMDDHHMM';` を更新。
- ヘッダー右上にバージョン表示が出る。
- コミット前に `push.bat` でリポジトリへ反映。

### HTML/JS 整合性チェック
- HTML 修正後: `<script src="app.js"></script>` と `</body>` の存在を grep で確認。
- コード削除前: 範囲内の全 function/let/const を grep で事前確認（無関係な関数を巻き込まないため）。

---

## 5. 関連ドキュメントの位置付け

| ファイル | 用途 |
|---|---|
| `CLAUDE.md` | プロジェクトの基本方針（短い）|
| `PROJECT_KNOWLEDGE.md` | デザインこだわり・過去の修正経緯・将来構想（ノード統合等）|
| `ARCHITECTURE.md` | アーキテクチャ図・主要関数の解説 |
| `CHANGELOG.md` | バージョンごとの変更履歴 |
| `HANDOVER.md` | このファイル。引継ぎ用スナップショット |
| `仕様書_テスト項目_WeeklyTracker.docx` | 仕様書 |

---

## 6. 開発フロー（チェックリスト）

新しい変更を入れるときの推奨手順:

- [ ] 変更内容をユーザーと合意
- [ ] `BKP/` にバックアップ（`<file>.bak3_YYYYMMDD_HHMMSS_<reason>`）
- [ ] 編集
- [ ] **検証**: `wc -l` / `tail -3` / `node --check` で末尾欠損チェック
- [ ] バージョン番号を更新
- [ ] `CHANGELOG.md` に追記
- [ ] ブラウザで動作確認（Ctrl+Shift+R で強制リロード）
- [ ] `push.bat` でコミット
- [ ] このファイル `HANDOVER.md` の「直近の作業状況」を更新

---

## 7. 連絡事項

- ユーザー: 米山さん（ベイシア デジタル推進部 マネージャー）
- メール: yoneyama@beisia.co.jp
- AIへの期待: 軽快な操作感の維持、スパゲッティコード回避、デグレ防止
