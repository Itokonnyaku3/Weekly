# 設計書: Tracker v2 追加機能 5件（中項目候補絞込・mid継承・リスト追加・D&D・リンク保持コピー）

作成日: 2026-07-03
対象: `v2/`（ESモジュール構成の本体アプリ）

## 背景・目的

Tracker v2 に、日々の運用で挙がった以下の要望を追加する。いずれも独立性が高いため、
デグレ回避を最優先に**既存関数への局所的追加**として実装し、軽い順に一括計画で進める。

当初6件の要望のうち「#6 他のノードへのリンク」は既存の @メンション（`⟦id⟧` チップ・
クリックでジャンプ・バックリンク表示）で充足済みのため**今回の対象外**とする。

実装順（軽い順）: #5 → #2 → #4 → #1 → #3。

## データモデル（前提・変更なし）

- **body**（内容）: `kind`(`memo`/`task`/`day`/`project`/`table`/`image`)、`content`、`proj`(所属PJのbody id)、
  `mid`(中項目=自由入力文字列)、`due`、`prio`、`done`/`doneAt`、`url`/`bold`/`color`(カード単位書式) など。
- **ref**（ツリー上の位置）: `bodyId`、`parentRefId`、`order`、`collapsed` など。1つのbodyを複数refで参照＝ミラー。
- 本設計で**新フィールドは追加しない**。既存の `body.mid` を活用し、#3ではクリップボードJSONに `url` 等を載せるのみ。

---

## #5 中項目の候補をそのプロジェクト内だけに限定

### 現状
中項目 `mid` のサジェストは全タスク横断で作る単一 `datalist#pwt2-mids`（`list.js` 254行付近）を、
フィルタ入力（426行付近）と詳細ポップアップの中項目欄（793行付近）が共用している。

### 変更
- 新ヘルパ `midsForProject(store, projId)` を追加: 指定PJ（`body.proj === projId`）のタスクの `mid` を
  重複排除・ソートして返す。`projId` が空（未所属）のときは `proj` 未設定タスクの `mid` を返す。
- 詳細ポップアップの `buildDetailFields(store, body)`（`list.js` 785行付近）で、
  `midsForProject(store, body.proj)` から**そのタスクと同じPJの中項目だけ**のローカル `<datalist>`（一意id）を生成し、
  中項目入力欄の `list` 属性をそれに向ける。グローバルな `pwt2-mids` には依存しない。

### 対象外
- フィルタ入力（426行付近）は横断のまま（別PJ横断で絞りたい用途があるため）。#5は「割り当て時の選択肢」を対象とする。

### エッジケース
- 同一PJに中項目が無い場合は候補ゼロ（自由入力は可能）。
- `body.proj` 未設定タスクは未所属タスク群の中項目を候補にする。

### テスト
- 単体: `midsForProject` が指定PJのmidのみを重複排除・ソートで返すこと／別PJのmidを含めないこと／未所属の扱い。

---

## #2 メモ直下に作ったタスクの中項目を親メモ名に（作成時のみ・追従しない）

### 変更
- `store.createCard`（`store.js` 73行付近）に中項目継承を**一元化**する。
  条件: 呼び出しに**明示の `mid` 指定が無く**、`parentRefId` が指す body が `kind:'memo'` かつ
  `content` が非空のとき、`mid = 親メモの content`（trim）を**作成時に一度だけ**設定する。
- 以後の中項目の編集・別中項目への移動・親メモのリネームは**この値に影響しない**（一回限りのスナップショット）。

### カバーされる経路（すべて `createCard` を通る）
- ズームした親メモ配下の「＋追加」（`daily.js` 590行付近）。
- メモ配下のカードで Enter して兄弟生成（`daily.js` 698行付近、`parentRefId: ref.parentRefId` が親メモ）。
- 貼り付け `insertNodes`（`clipboard.js` 129行付近）でメモ配下に貼った子。**←貼り付けも対象（承認済み）**。

### 継承しない条件
- 親が `day` / `project` の直下（デイリー当日直下、PJノートページ直下）。
- 呼び出しが明示的に `mid` を渡している場合（その値を尊重）。
- 親メモの content が空。

### エッジケース
- Tab によるインデント（既存refの `parentRefId` 付け替え）は `createCard` を通らないため**継承しない**
  ＝「作成時のみ」という要件に合致（インデントは「作成」ではない）。
- 深い貼り付けでは各階層で親メモ content が子の mid になる（メモは既定 `kind:'memo'` なので list 表示に出るのはタスク化後のみ）。

### テスト
- 単体: メモ配下で `createCard`→mid=親content／day配下・project配下→mid未設定／明示mid指定→尊重／親メモ空→未設定／
  作成後に親メモをリネームしてもタスクmidは不変。

---

## #4 リストからタスクを追加（今日の日付に作成）

### 変更
- 新ヘルパ `addTaskToday(store, { proj, mid })` を追加: `store.ensureDayCard(今日のISO日付)` の day ref 直下に
  `kind:'task'`・`content:''`・`proj`・`mid`（空なら未設定）でカードを作成し、`{ body, ref }` を返す。
- リストのツリー（PJ並べ替え=grouped）表示で、各グループ（PJ／中項目）末尾に「＋ タスク追加」行を表示。
  クリックで `addTaskToday` を**そのグループの `proj`/`mid` を継承**して呼び、新規行のタイトルを即編集フォーカス。
- 非grouped（他の並べ替え）表示では、リスト上部に単一の「＋ タスク追加」（今日・proj/mid未設定、詳細で後付け）。

### エッジケース
- アクティブな絞り込み条件により、新タスク（期限なし・未完）が表示条件から外れる可能性がある。
  追加後に当該行が描画されない場合はトーストで通知（「タスクを追加しました（現在の絞り込みでは非表示）」）。
  既定のPJツリー表示では常に表示されるため実用上の主経路では問題なし。
- 今日の day カードが無ければ `ensureDayCard` が生成する（既存挙動）。

### テスト
- 単体: `addTaskToday` が今日の day ref 直下に `kind:'task'` を作り、`proj`/`mid` を継承すること／
  同日に複数追加しても同じ day カード配下に並ぶこと。

---

## #1 リストでタスクをドラッグ＆ドロップして中項目を移動（同一PJ内のみ）

### 変更
- ツリー（grouped）表示のタスク行 `tr` を `draggable=true` にし、`dataset.task`/`dataset.proj`/`dataset.mid` を保持（既存）。
- ドラッグ開始で対象 taskId と proj を記録。ドロップ先は**同じ proj 内**の中項目見出し行（`midRow`）または
  タスク行のみ許可。別PJ上では `dropEffect='none'`（不可表示）。
- ドロップで目標グループの中項目に付け替え: `store.updateBody(taskId, { mid: 目標mid || undefined })` → 再描画。
- ガード関数 `canDropTask(store, taskId, targetProj)` を切り出し（`targetProj` が対象タスクの `proj` と一致する場合のみ true）。

### 範囲
- 本機能は**中項目の付け替えのみ**。同一グループ内での並べ替え（`order`）は対象外。
- 「（中項目なし）」見出しへのドロップ＝ `mid` をクリア（undefined）。同一midへのドロップは no-op。

### エッジケース
- 別PJのグループへドロップ→拒否（proj は変えない＝#1の確定仕様）。
- ドラッグ中の視覚フィードバック（許可グループのハイライト）を付与。

### テスト
- 単体: `canDropTask` が同PJのみ true／別PJで false。D&Dの結線とハイライト・実際の付け替えは実機evalで確認。

---

## #3 リンクを保ったコピー（標準 Ctrl+C 拡張・カード＋子ツリー全体）

### 現状の問題
- `writeClip`（`clipboard.js` 167行付近）が書き込む `text/html` は、プレーンテキストを `<br>` で並べた
  `<div data-pwt2-clip="…">…</div>` のみ（27行 `encodeClipHtml`）で、**実リンク（`<a href>`）を含まない**。
- `serializeSubtree`（12行付近）が収集するノードに `url` が**含まれない**ため、コピー経路でカードのリンクが失われる。

### 変更
1. `serializeSubtree` のノードに `url`（および `bold`/`color`）を含める。
2. `encodeClipHtml(nodes, plain)` を、**階層を保った入れ子HTML**（`<ul><li>` のネスト）で生成するよう刷新:
   - 各ノードのテキストを `<li>` に出力。`url` を持つノードは内容を `<a href="url">…</a>` で包む。
   - 子（`depth`）を入れ子 `<ul>` として表現。
   - 従来の `data-pwt2-clip="base64(JSON)"` マーカーはコンテナ要素に**残す**ことで、アプリ内貼り付けの構造復元を維持
     （メール側は `<a>`/階層を解釈、アプリ側はマーカーJSONで完全復元）。
   - 本文中の `⟦id⟧` メンションは**表示名に解決**（参照先bodyの content 先頭・day はその日付）して出力。
     生の `⟦id⟧` はJSONマーカー内の `content` にのみ保持し、往復で消えないようにする。
3. `plain`（text/plain）側もメンションを表示名に解決したテキストにする。
4. `insertNodes`（129行付近）で `n.url`（あれば `bold`/`color`）を `createCard` の属性に反映＝アプリ内貼付でもリンク保持。

### 範囲
- コピー対象は**選択中カード（またはフォーカス中カード）＋その子ツリー全体**（既存 `targetRoots` の挙動を踏襲）。
- 文字選択中の Ctrl+C は従来どおりブラウザ標準（テキスト）に委譲（既存 `copy` ハンドラのガードを維持）。

### エッジケース
- `url` の無いノードはテキストのみ。
- メンション解決先が存在しない（削除済み）場合は `@?` などのフォールバック表示。
- 空 content のノードは空 `<li>`。

### テスト
- 単体:
  - `serializeSubtree` がノードに `url` を含む。
  - `encodeClipHtml` が `url` ノードを `<a href>` 化し、階層を入れ子 `<ul>` で表現し、`data-pwt2-clip` を保持。
  - メンション `⟦id⟧` がHTML/plainで表示名に解決される。
  - `decodeClipHtml` → `insertNodes` の往復で `url` が保持される。
- 実機: 実際のメール（Outlook等）へ貼り付けてリンクがクリック可能・階層が保たれることを確認。

---

## 影響範囲まとめ（ファイル別）

- `store.js`: `createCard` に mid 継承（#2）。
- `list.js`: `midsForProject`＋詳細ポップアップ datalist 差し替え（#5）、`addTaskToday`＋グループ末尾「＋追加」行（#4）、
  タスク行 D&D＋`canDropTask`（#1）。
- `clipboard.js`: `serializeSubtree`/`encodeClipHtml`/`insertNodes` 拡張＋メンション解決（#3）。
- `style.css`: 「＋追加」行（#4）、D&Dハイライト（#1）の見た目。
- テスト: `tests/` に #5/#2/#4/#1/#3 の単体を追加。

## 非機能・デグレ回避

- 既存の描画・永続・履歴（undo/redo）経路に乗せる（すべて `store` の既存API経由）。
- D&D・「＋追加」は grouped 表示に限定し、既存の行選択・キーボード操作と競合しないようガード。
- 各機能は独立コミット可能（単体テスト緑＋実機eval）。
