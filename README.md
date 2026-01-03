# 🐝 生産力 (Seisanryoku)

チームの工数管理・課題・Wiki・ドライブ・顧客/案件を、ワークスペース単位で安全に統合する次世代SaaSアプリケーション。

## ✨ 特徴

**ブランドコンセプト**
- ブランドカラー: イエロー/アンバー（黄色系）
- ブランドキャラクター: 🐝 蜂
- コンセプト: 蜂のように効率的で、チームの生産性を最大化

## 🚀 機能

- **会社アカウント管理**: オーナーが会社を作成し、会社コードを発行して社員を招待
- **社員アカウント**: メールアドレス認証でセキュアにログイン
- **工数カレンダー**: カレンダー形式で作業時間を記録・可視化
- **工数記録**: カレンダー形式で作業時間を記録
- **カレンダーUI**: 直感的な月表示カレンダー
- **プロジェクト別色分け**: 開発、会議、営業などカテゴリごとに色分け
- **月次サマリ**: プロジェクト別に今月の工数を自動集計・可視化（時間・パーセンテージ表示）
- **予定の追加・編集・削除**: クリック操作で簡単に予定を管理

## 🛠 技術スタック

- **フレームワーク**: Next.js 16 (App Router)
- **認証・データベース**: Firebase Authentication, Firestore
- **スタイリング**: Tailwind CSS
- **言語**: TypeScript

## 📁 ページ構成

### 共通ページ
- `/` - ランディングページ（LP）：CVR重視の訴求ページ
- `/signup` - サインアップページ（管理者・社員共通）

### 管理者用
- `/login` - 管理者ログインページ
- `/dashboard` - 管理者ダッシュボード：各機能へのハブ
  - **役割チェック**: 会社オーナーのみアクセス可能。社員は自動的に `/employee-dashboard` にリダイレクト
- `/employees` - 社員管理：社員の追加・編集・削除

### 社員用
- `/employee-login` - 社員ログインページ
- `/employee-dashboard` - 社員ダッシュボード：プロフィールと工数管理
  - **役割チェック**: 社員のみアクセス可能。管理者は自動的に `/dashboard` にリダイレクト
- `/calendar` - カレンダー：工数記録と可視化（管理者・社員共通）

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Firebase設定

Firebaseコンソールでプロジェクトを作成し、Webアプリを追加します。

`env.example` をコピーして `.env.local` ファイルを作成し、以下の環境変数を設定してください：

```bash
cp env.example .env.local
```

```env
# Firebase Client SDK用（フロントエンド）
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

### 3. Firebase Authentication設定

Firebaseコンソールで以下を設定：

1. **Authentication** → **Sign-in method** で「メール/パスワード」を有効化
2. **Authentication** → **Sign-in method** → **Google** を有効化
   - プロジェクトのサポートメールを設定
   - プロジェクト名（公開）を設定
   - 「保存」をクリック
3. **Authentication** → **Settings** → **Authorized domains** で以下を追加:
   - `localhost` (開発用)
   - 本番環境のドメイン（デプロイ後）
4. **Firestore Database** を作成（本番環境モードまたはテストモード）

### 4. Firestoreセキュリティルール（必須）

**重要**: Firestoreのセキュリティルールを設定しないと、データベースへのアクセスが拒否されます。

#### 開発環境の場合

1. Firebaseコンソール → Firestore Database → ルール タブ
2. `firestore.dev.rules` の内容をコピー＆ペースト
3. 「公開」をクリック

#### 本番環境の場合

1. Firebaseコンソール → Firestore Database → ルール タブ
2. `firestore.rules` の内容をコピー＆ペースト
3. 「公開」をクリック

**セキュリティルールファイル:**
- `firestore.rules` - 本番環境用（詳細な権限管理）
- `firestore.dev.rules` - 開発環境用（認証済みなら全アクセス可能）

⚠️ **本番環境では必ず `firestore.rules` を使用してください。**

### 5. Firestoreインデックス（必須）

**重要**: カレンダー機能を使用するには、以下の複合インデックスが必要です。

#### インデックスの作成方法

**方法1: エラーメッセージのリンクから作成（推奨）**

1. カレンダーページにアクセスすると、コンソールに以下のようなエラーが表示されます:
   ```
   FirebaseError: The query requires an index. You can create it here: https://console.firebase.google.com/...
   ```
2. エラーメッセージに含まれるリンクをクリック
3. Firebaseコンソールが開き、必要なインデックス設定が自動入力される
4. 「インデックスを作成」ボタンをクリック
5. 数分待つとインデックスが作成される

**方法2: 手動で作成**

1. [Firebaseコンソール](https://console.firebase.google.com/) → プロジェクトを選択
2. Firestore Database → インデックス タブ
3. 「複合」タブ → 「インデックスを作成」
4. 以下を設定:
   - **コレクション**: `timeEntries`
   - **フィールド1**: `uid` (昇順)
   - **フィールド2**: `start` (昇順)
5. 「作成」をクリック
6. ステータスが「作成中」→「有効」になるまで待つ（数分）

#### 必要なインデックス一覧

```
コレクション: timeEntries
- uid (昇順)
- start (昇順)
```

⚠️ **インデックスが作成されるまでカレンダー機能は使用できません。**

### 6. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いて確認してください。

## 使い方

### 管理者（会社作成者）

1. **アカウント作成**
   - LPから「無料で始める」または「管理者ログイン」→「新規登録」
   - 名前、社名、メールアドレス、パスワードを入力してサインアップ

2. **会社の作成**
   - ダッシュボードから「会社設定」
   - 「会社を作成（オーナー）」で会社名を入力して作成
   - 表示された会社コードをメモ

3. **社員の追加**
   - 「社員管理」ページへ移動
   - 「+ 社員を追加」ボタンをクリック
   - 社員情報（名前、メールアドレス、雇用形態、入社日）を入力
   - 自動的にFirebase Authenticationにアカウントが作成されます
   - ランダムパスワードが生成され、モーダルで表示される
   - メールアドレスとパスワードを社員に共有（メール、チャットなど）

### 社員

1. **ログイン**
   - 管理者から受け取ったメールアドレスとパスワードを準備
   - LPから「社員ログイン」ページへアクセス
   - 受け取ったメールアドレスとパスワードでログイン
   - 社員用ダッシュボードにリダイレクトされる

2. **ダッシュボード**
   - プロフィール情報の確認
   - カレンダーへのクイックアクセス
   - カレンダー連携状況の確認

3. **工数管理**
   - カレンダーで工数を記録
   - カレンダー形式で工数を記録
   - プロジェクト別に時間を集計

## ビルド

```bash
npm run build
npm start
```

## デプロイ

Vercelへのデプロイが最も簡単です：

1. [Vercel](https://vercel.com) にアカウントを作成
2. GitHubリポジトリを接続
3. 環境変数を設定
4. デプロイ

詳細は [Next.js デプロイメントドキュメント](https://nextjs.org/docs/app/building-your-application/deploying) を参照してください。

## 注意事項

- **役割ベースのアクセス制御**: 会社のオーナー（作成者）は管理者、それ以外は社員として扱われます
  - 管理者が `/employee-dashboard` にアクセスすると自動的に `/dashboard` にリダイレクト
  - 社員が `/dashboard` にアクセスすると自動的に `/employee-dashboard` にリダイレクト
※ Googleカレンダー連携は一旦停止しています
- 社員アカウントは管理者が作成すると、自動的にFirebase Authenticationに登録されます（Firebase Admin SDK不要）
- 社員は管理者から受け取ったメールアドレスとパスワードで直接ログインできます
- 本番環境では必ずFirestoreセキュリティルールを設定してください

## ライセンス

このプロジェクトは個人利用・学習目的で作成されています。
