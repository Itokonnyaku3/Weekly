# 設計: プロジェクト毎ノート（Tracker v2）

- 日付: 2026-06-24
- 対象: v2（`Itokonnyaku3/Weekly` の `v2/`、branch `rebuild/phase1-foundation`＝`main`）
- 位置づけ: ユーザー要望「デイリーではないノート＝プロジェクト毎のノートを作りたい」の**第1サイクル**。後続（文字単位の修飾／表／画像）は別サイクル。

## 1. ゴールと非ゴール

**ゴール**: 各プロジェクトに専用の**自由アウトライン（白紙ノート）ページ**を持たせ、デイリーと同じ操作感で編集できる。専用の「プロジェクト」ビューから一覧→ノートを開く。

**非ゴール（このサイクルでは作らない）**:
- 割り当て済みタスクの自動集約表示（将来のミラー機能）。
- 文字単位の修飾・表・画像（各々別サイクル）。

## 2. データモデル

既存の「日カードは**ルート参照**(`parentRefId=null`)を持ち、その配下がアウトライン」という仕組みをプロジェクトにも適用する。

- プロジェクト本体は従来どおり `kind:'project'` の body（`createProject`）。**変更なし**。
- 新規 `store.ensureProjectPage(projId)`（`ensureDayCard` と対）:
  - その project body に `parentRefId===null` のルート参照が無ければ作成して返す。
  - 返り値 `{ body, ref }`。
- プロジェクトノート = そのルート参照配下の参照ツリー（＝既存の本体＋付箋モデルそのまま）。
- GC・連鎖削除・order などは既存ロジックがそのまま効く。

## 3. ビュー構成（専用ビュー）

`currentView` に `'project'` を追加。ツールバーに3つ目のタブ「**プロジェクト**」。`#view-project` マウントを追加。

プロジェクトビューは app 側に `projState = { projId, rootRef }` を持つ（`listState` と同様）。`projId` 未選択＝ランディング。`rootRef` は現在開いているページのルート参照（ページ内ズームで変わる。タブ切替で復帰用に保持）で、描画時に `daily.js` の `_ctx` に渡す。

### 3.1 ランディング（projId 未選択）
- プロジェクト一覧（`store.listProjects()` 順）。各行: プロジェクト名 ＋ ノート内カード数（ルート配下の子孫数）。クリックでそのノートを開く。
- 「＋ プロジェクト」で新規作成（既存 `createProject`）→ 作成したノートを開く。
- 空状態: 「プロジェクトがありません。＋プロジェクトで作成してください」。

### 3.2 プロジェクトページ（projId 選択中）
- パンくず「**プロジェクト**」（→ ランディングへ戻る）。ページ内でさらにズーム（Alt+↓）した場合は祖先カードを `›` で連ねる。
- タイトル: プロジェクト名（編集可能＝**リネーム**。`updateBody(projId,{content})`）。
- アウトライン: ルート参照配下を既存 `renderChildren` で描画。**デイリーと同じ操作**（Enter分割／Tab・Shift+Tab／↑↓移動・行頭Backspace結合／ドラッグ／折りたたみ／⋯メニュー／@メンション／Ctrl+Enter 等）。
- 「＋ 追加」: ルート直下に memo カードを追加。
- バックリンク: その project body を `⟦id⟧` 参照しているカード一覧（§6 で project を @メンション対象にするため機能する）。

## 4. アーキテクチャ（採用＝専用ビューに一般化）

「1つのルート参照を“ページ”として描画する」処理を `daily.js` から**再利用可能**にし、デイリーのズームとプロジェクトページの両方で使う。鍵は **アクティブなページコンテキスト `_ctx`** を `daily.js` の単一モジュール状態として持つこと。

### 4.1 ページコンテキスト `_ctx`
`daily.js` に `_ctx = { rootRef, container, requestRender, inheritProj, home }` を持つ。

- `rootRef`: 現在のページのルート参照 id。`null` のときは「全 day 表示」。
- `container`: 描画先の要素（`#view-daily` か `#view-project` の中身）。
- `inheritProj`: そのページで新規作成するカードの `proj` 既定値（プロジェクトページのみ）。
- `home`: パンくず先頭の `{label, onClick}`（デイリー＝「全体」→ `rootRef=null`、プロジェクト＝「プロジェクト」→ ランディング）。

各ビューは描画の最初に `_ctx` をセットする（1度に表示されるビューは1つ＝競合しない）。後続のキー操作（onKey）やナビ補助はこの `_ctx` を読む。**これにより `daily.js` から「デイリー固定」前提を除去**する。

### 4.2 ページ描画の抽出
- 既存 `renderZoomed` を `renderPage(store)` に一般化（`_ctx` を参照）: パンくず（`_ctx.home`＋祖先を `rootRef` から辿る）→ タイトル（編集可＝本体名）→ `renderChildren(rootRef)` → 「＋追加」（`_ctx.inheritProj` を付与）→ バックリンク。
- `renderDaily`: `rootRef=null` の `_ctx` をセットして全 day を描画。`rootRef` 有りなら `renderPage`（＝従来のズーム）。
- `renderProjectView`（新規 `project.js`）: 選択中 PJ について `_ctx.rootRef=projのルート参照`・`container=#view-project`・`inheritProj=projId`・`home=ランディング` をセットして `renderPage` を呼ぶ。

### 4.3 ナビ補助の一般化（唯一のリスク箇所）
現在「デイリー領域・デイリー状態」前提のナビを `_ctx` 基準に変える。

- `navEls()`（↑↓対象＝描画順の見出し＋カード）: スコープを `#view-daily` 固定から **`_ctx.container` 内**に変更。
- `visibleFlat()`（←→境界移動・行頭Backspace結合が使用）: `_ctx.rootRef` を基準に平坦化（`null` なら全 day 走査・既存と同値）。
- ページ内ズーム（Alt+↓/↑）: `_ctx.rootRef` を差し替えて再描画。**ズームアウトの下限**＝そのページの最上位（デイリー＝全 day、プロジェクト＝`home`）。`rootRef` が `home` のルートならズームアウトで `home.onClick`。
- 旧 `_focusRef` は `_ctx.rootRef` に統合（デイリーのズームも `_ctx` 経由に）。

> 実装方針: **デイリーの挙動を一切変えない**。`renderDaily` は従来と同じ値（全日＝`rootRef:null`、ズーム＝対象ref）を `_ctx` に渡すだけ。各段で daily の全日/ズーム/↑↓/Backspace/メンションを実機回帰確認。

### 4.3 新規モジュール `project.js`
- `renderProjectView(store, mount, requestRender, projState, onJump)`: §3.1/§3.2 を描画。ページは `daily.js` の `renderPage` を呼ぶ。
- ランディング一覧の描画と「＋プロジェクト」「カード数」を担当。

### 4.4 `app.js` 配線
- `currentView='project'` の描画分岐、タブボタン、`projState` 管理。
- 新規カードの `proj` 既定付与は `renderPage` の `inheritProj` 経由（＝プロジェクトページで作ったカードは `proj=projId`）。

## 5. 挙動の詳細

- **proj 自動付与**: プロジェクトページで新規作成したカード（＋追加／Enter分割／子追加）は `proj=projId` を持つ。これによりリストのそのPJグループにも現れ、一貫する。（Enter分割は既存実装が元カードの `proj` を引き継ぐため自然に伝播。先頭カードは `inheritProj` で付与。）
- **リネーム**: ページタイトル編集で project 名を更新（リストのPJ名・グループ見出しにも反映）。
- **削除済みプロジェクト**: ランディングは `listProjects()` を使うので自動的に消える。開いていた projId が消えたらランディングへフォールバック。
- **リストとの関係**: 既存リストは変更最小。リストのPJ群やPJ名から当該ノートを開く導線は**任意（このサイクルでは必須にしない）**。

## 6. ナビ連携（小さく含める）

- **プロジェクトを @メンション対象に**: `daily.js` の `openMentionSearch` の検索対象に `kind:'project'` を追加（候補ラベルに識別アイコン）。
- **メンション/ジャンプ先**: `app.js` `jumpToMention` で `kind:'project'` の場合は**プロジェクトビューでそのページを開く**（`day`→`gotoDate`／`project`→open page／他→`jumpToCard` の分岐に追加）。
- これにより project ページのバックリンクが意味を持ち、どこからでもプロジェクトノートへリンクできる。

## 7. テスト/検証

- **単体（node）**: `store.ensureProjectPage`（無ければ root ref 作成・既存なら再利用・projId 不正時の安全）を `tests/` に追加。既存スイートは全緑維持。
- **実機（preview_eval）**:
  - プロジェクトタブ→一覧→PJを開く→ページ表示（タイトル＝PJ名）。
  - ページで ＋追加／Enter分割／Tab／↑↓（見出し含む）／行頭Backspace結合／折りたたみ／⋯メニュー が動く。
  - 作成カードに `proj=projId` が付く。タイトル編集でPJ名が変わる。
  - パンくず「プロジェクト」で一覧へ戻る。ページ内 Alt+↓/↑ でズーム。
  - **回帰チェック**: デイリーの全日表示・ズーム・↑↓・Backspace結合・@メンション・リストが従来どおり。
- 既存メモのプレビュー注意（サーバが落ちやすい→都度 `preview_start`、検証は DOM/eval 中心）に従う。

## 8. リスクと緩和

- **唯一の主リスク = ナビ補助（navEls/visibleFlat）の一般化でデイリーに回帰**。緩和: デイリーは「同じ値を渡すだけ」で挙動不変に保つ。実機で daily の ↑↓/Backspace/ズームを必ず回帰確認。小さなコミットに分け、各段で検証。
- スコープ膨張防止: 集約/ミラー・リッチ/表/画像は本サイクル対象外を明記。

## 9. 区切り（コミット計画の目安）

1. `store.ensureProjectPage` ＋単体テスト。
2. `renderPage` 抽出（デイリーのズームを置換、挙動不変を実機確認）。
3. ナビ補助の一般化（可視コンテナ＋ページルート）。
4. `project.js`（ランディング＋ページ）＋ `app.js` 配線＋タブ＋CSS。
5. proj 自動付与・リネーム・パンくず・ページ内ズーム。
6. project を @メンション対象に＋ `jumpToMention` 分岐。
7. CHANGELOG／バージョン／commit＋push（main FF）。

各段で commit＋push（[[workflow-commit-push-set]]）。公開反映は main へFF push。
