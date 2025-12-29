# ビルドエラーにならないためのガイドライン（Next.js App Router + Firebase）

このドキュメントは「開発中は動いていたのに、`next build` や本番で落ちる」事故を防ぐためのルール集です。  
READMEとは役割を分け、**具体的なNG例 / OK例 / チェックリスト / 典型エラー**を中心にまとめます。

---

## 1. まず押さえる前提（このリポジトリの構成）

- **Next.js App Router**（`app/` 配下でルーティング）
- **Client Component** はファイル先頭に `"use client";` が必要
- **Firebase Auth / Firestore** をフロントから直接利用（`lib/firebase`）

---

## 2. Client / Server Component の鉄則

### 2.1 ブラウザAPIを使うなら必ず Client Component

**NG（Server ComponentでブラウザAPI）**

- `window` / `document` / `navigator.clipboard`
- `localStorage` / `sessionStorage`
- `alert` / `confirm`
- `signInWithPopup`（ポップアップ）

**OK**

- 該当ファイル先頭に `"use client";`
- または Client Component に切り出して呼ぶ

### 2.2 `useRouter` / `useSearchParams` / `usePathname` も Client Component

これらは `next/navigation` のクライアントフックなので、**Server Componentでは使えません**。

---

## 3. Hooks（useEffect/useState/useCallback）で死なないためのルール

### 3.1 Hookは条件分岐の中で呼ばない

**NG**

- `if (...) { useEffect(...) }`
- `for (...) { useState(...) }`

**OK**

- Hookは常にトップレベルで呼び、条件分岐はHookの中に入れる

### 3.2 useEffect内で「同期的にsetState連打」しない

ビルド時の静的解析/ESLintルールや、実行時のレンダーループの原因になります。

**避けたいパターン**

- `useEffect(() => { setX(...); }, [something])` が `something` の更新と絡んでループ

**OK**

- 初期値は `useState(() => initial)` の関数初期化で作る
- `useEffect` 内の更新は「本当に必要な時だけ」行う
- 非同期処理は `void (async () => { ... })()` の形で書き、例外を握りつぶさず `try/catch`

### 3.3 依存配列（deps）を「都合で消さない」

**NG**

- `// eslint-disable-next-line react-hooks/exhaustive-deps`

**OK**

- `useCallback` / `useMemo` で依存を安定化
- 依存に入れるべきものを入れる（ループするなら設計を見直す）

---

## 4. Firebase（Auth/Firestore）で落とし穴を踏まない

### 4.1 Authは `onAuthStateChanged` を単一の入口にする

- ログイン状態の決定は `onAuthStateChanged` を基準にする
- 画面遷移（`router.push`）は **ログイン確定後**に行う

### 4.2 Firestoreクエリと「インデックス要求」

Firestoreは以下で **複合インデックス**を要求しがちです：

- `where("A","==",...)` + `where("B",">=",...)` のような複数条件
- `orderBy` と範囲条件の組み合わせ

**方針（どちらかを選ぶ）**

- **本番向け**: Firebase Consoleで複合インデックスを作る（パフォーマンスも良い）
- **回避策**: クエリ条件を減らして取得し、残りはクライアント側でフィルタ（データ量が小さい間だけ）

> 重要：回避策は「データが増えると遅くなる」ので、運用が乗ったらインデックスへ戻す。

### 4.3 `where("in", ...)` は最大10件

- 11件以上は **10件ずつ分割して複数回取得**し、結果をマージする
- 取得結果の重複は `id` で排除する

### 4.4 `Timestamp` と `string date` を混ぜない

Firestoreの日時を扱うならどちらかに統一：

- 文字列（ISO）で統一するなら `start/end: string`（ISO）
- Timestampで統一するなら `start/end: Timestamp`

混在すると、ソート/範囲比較で壊れやすいです。

---

## 5. TypeScriptでビルドを壊さないコツ

### 5.1 `any` を増やさない（`unknown` から絞る）

**OK**

- `catch (e: unknown) { const err = e as { code?: string; message?: string } }`
- `instanceof Error` で判定して扱う

### 5.2 `as Type` の多用は事故る（境界でだけ使う）

**推奨**

- Firestore `doc.data()` の直後だけ `as` し、それ以外は型安全に扱う
- 必須フィールドは `zod` などでバリデーション（必要になったら導入）

### 5.3 Null/undefined を甘く見ない

**危険**

- `user.email!` の乱用

**OK**

- `if (!user?.email) { ... }` を明示

---

## 6. Next.jsでありがちなビルド落ちパターン

### 6.1 `export default function ...` を消してしまう

編集の途中で関数宣言が消えると、`Parsing error: Declaration or statement expected` が出ます。

**対策**

- 大きいファイルは一度に大改造しない
- 置換（search/replace）は範囲を狭めて行う

### 6.2 同じ変数名を二重宣言

例：`const router = useRouter();` を2回書くと

- `the name router is defined multiple times`

**対策**

- hooks/参照は上部にまとめる
- コピペ時は二重定義を必ず確認

### 6.3 Server/Client import の混線

**NG**

- Server Componentで `firebase/auth` を直接importして実行

**OK**

- 認証が必要な画面は `"use client";` を付ける

---

## 7. UIイベントと日付時刻でズレないための注意

### 7.1 Dateの「ローカル時間 vs ISO」を意識

`toISOString()` はUTCになるため、画面で選んだ日時がズレる原因になります。

**ルール**

- 画面内の表示はローカル `Date`
- Firestore保存は ISO（UTC）に寄せるなら、保存時/表示時で変換責務を明確化

---

## 8. コーディング規約（このプロジェクトで推奨）

- **非同期**: `await` は `try/catch` で囲み、失敗時はUI状態を必ず戻す
- **console.log**: デバッグ後は削除（残すなら `if (process.env.NODE_ENV !== "production")` でガード）
- **巨大ファイル**: 500行超えたらコンポーネント分割を検討（UIとデータ処理を分ける）

---

## 9. 変更前のチェックリスト（PR前に必ず）

- [ ] 追加した画面/機能は `"use client";` の要否が正しい
- [ ] `useEffect` の依存配列が破綻していない（無効化していない）
- [ ] `router` / `auth` / `db` の二重定義がない
- [ ] Firestoreクエリでインデックスが必要になりそうな組み合わせを作っていない
- [ ] `where("in")` が10件を超えていない
- [ ] `catch (e)` が `unknown` で扱われ、`any` を増やしていない
- [ ] `user.email` 等のnull安全を担保している

---

## 10. よく出るエラー文と原因

### 10.1 `The query requires an index`

- **原因**: Firestoreの複合クエリ（複数where/orderBy）
- **対策**: インデックス作成 or クエリを単純化してクライアント側でフィルタ

### 10.2 `Missing or insufficient permissions`

- **原因**: Firestore Rules
- **対策**: 必要なread権限があるか確認（manager/employeeの想定に合わせる）

### 10.3 `Ecmascript file had an error` / `Parsing error`

- **原因**: 構文崩れ（関数宣言消失、括弧の閉じ忘れ等）
- **対策**: 直前の編集差分を最小化して戻す、関数/JSXの対応を確認

---

## 11. 補足：インデックスを作るべきタイミング

「回避策（クライアントフィルタ）」は小規模では便利ですが、データが増えると遅くなります。  
以下に当てはまったら **Firestoreの複合インデックスを作ってサーバー側絞り込み**に戻すのが推奨です。

- `timeEntries` が数千件を超え始めた
- 月表示/週表示でロードが重い
- モバイルで体感が悪い


