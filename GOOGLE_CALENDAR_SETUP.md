# Googleカレンダー連携セットアップガイド

このドキュメントでは、生産力アプリでGoogleカレンダーと連携するための設定手順を説明します。

## 目次

1. [概要](#概要)
2. [Google Cloud Consoleでの設定](#google-cloud-consoleでの設定)
3. [Firebase Authenticationでの設定](#firebase-authenticationでの設定)
4. [アプリケーション側の実装](#アプリケーション側の実装)
5. [使用方法](#使用方法)
6. [トラブルシューティング](#トラブルシューティング)
7. [参考資料](#参考資料)

---

## 概要

Googleカレンダー連携機能により、社員は自分のGoogleカレンダーと生産力アプリを連携し、以下のことが可能になります：

- Googleカレンダーのイベントを生産力アプリで表示
- 生産力アプリで作成した工数エントリをGoogleカレンダーに同期
- カレンダーデータの双方向同期

### 認証フロー

1. 社員が「Googleカレンダーと連携」ボタンをクリック
2. Googleの同意画面が表示される（ポップアップ）
3. ユーザーがGoogleアカウントを選択し、権限を承認
4. アクセストークンが取得され、Firestoreに保存される
5. 連携完了

---

## Google Cloud Consoleでの設定

### 1. Google Calendar APIを有効化する

1. [Google Cloud Console](https://console.cloud.google.com/)にアクセス
2. プロジェクトを選択（または新規作成）
3. 検索窓で「**Google Calendar API**」を検索
4. 「**Google Calendar API**」をクリック
5. 「**有効にする**」ボタンをクリック

### 2. OAuth同意画面を設定する

1. 検索窓で「**API とサービス**」を検索
2. 左メニューから「**OAuth同意画面**」を選択
3. 「**外部**」を選択して「**作成**」をクリック

#### アプリ情報の入力

- **アプリ名**: 例）「生産力」
- **ユーザーサポートメール**: 管理者のメールアドレス
- **アプリのロゴ**: 任意（推奨）
- **アプリのホームページ**: アプリのURL（例：`https://your-app.com`）
- **アプリのプライバシーポリシーのリンク**: プライバシーポリシーのURL
- **アプリの利用規約のリンク**: 利用規約のURL（任意）

#### スコープの設定

「**スコープを追加または削除**」をクリックし、以下のスコープを追加：

- `https://www.googleapis.com/auth/calendar.events` - カレンダーイベントの読み書き
- `https://www.googleapis.com/auth/calendar.readonly` - カレンダーの読み取り専用

または、検索窓で「**calendar**」と検索して、必要なスコープを選択します。

#### テストユーザーの追加（開発中のみ）

アプリが「**テスト中**」の状態の場合、以下の手順でテストユーザーを追加：

1. 「**テストユーザー**」セクションで「**+ ADD USERS**」をクリック
2. 連携を許可するGoogleアカウントのメールアドレスを入力
3. 「**追加**」をクリック

⚠️ **重要**: テストユーザー以外のアカウントでは連携できません。本番環境では、アプリを「**公開**」する必要があります。

### 3. OAuth 2.0 クライアントIDを作成する

1. 左メニューから「**認証情報**」を選択
2. 「**+ 認証情報を作成**」をクリック
3. 「**OAuth クライアント ID**」を選択

#### アプリケーションの種類を選択

- **アプリケーションの種類**: 「**ウェブアプリケーション**」を選択
- **名前**: 例）「生産力 - Web Client」

#### 承認済みのリダイレクトURIを設定

Firebase Authenticationを使用する場合、以下のURIを追加：

```
https://<YOUR-PROJECT-ID>.firebaseapp.com/__/auth/handler
```

`<YOUR-PROJECT-ID>`は、FirebaseプロジェクトIDに置き換えてください。

例：
```
https://seisanryoku.firebaseapp.com/__/auth/handler
```

#### クライアントIDとシークレットの取得

1. 「**作成**」をクリック
2. **Client ID**と**Client Secret**が表示される
3. これらを安全に保管してください（後でFirebaseで使用します）

---

## Firebase Authenticationでの設定

### 1. Google認証プロバイダーを有効化

1. [Firebase Console](https://console.firebase.google.com/)にアクセス
2. プロジェクトを選択
3. 左メニューから「**Authentication**」を選択
4. 「**Sign-in method**」タブを開く
5. 「**Google**」プロバイダーをクリック
6. 「**有効にする**」トグルをONにする

### 2. OAuth 2.0 クライアントIDを設定

1. Google Cloud Consoleで作成した**Client ID**と**Client Secret**を入力
2. 「**保存**」をクリック

### 3. 承認済みドメインを設定

1. 「**Settings**」タブを開く
2. 「**Authorized domains**」セクションを確認
3. 以下のドメインが追加されていることを確認：
   - `localhost`（開発用）
   - 本番環境のドメイン（例：`your-app.com`）

ドメインが追加されていない場合は、「**ドメインを追加**」をクリックして追加します。

---

## アプリケーション側の実装

### 現在の実装

アプリケーションでは、Firebase Authenticationの`signInWithPopup`を使用してGoogle認証を行っています。

#### 実装箇所

- **ファイル**: `app/employee-dashboard/page.tsx`
- **関数**: `linkCalendar()`

#### コードの説明

```typescript
const linkCalendar = async () => {
  // Googleプロバイダーの設定
  const provider = new GoogleAuthProvider();
  
  // カレンダーのスコープを追加
  provider.addScope("https://www.googleapis.com/auth/calendar.events");
  provider.addScope("https://www.googleapis.com/auth/calendar.readonly");
  
  // 常に承認画面を表示
  provider.setCustomParameters({
    prompt: "consent",
  });
  
  // ポップアップでGoogle認証
  const result = await signInWithPopup(auth, provider);
  
  // アクセストークンを取得
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken;
  
  // トークンをFirestoreに保存
  await setDoc(
    doc(db, "profiles", user.uid),
    { 
      calendarLinked: true,
      googleAccessToken: token,
    },
    { merge: true }
  );
};
```

### スコープの説明

- `calendar.events`: カレンダーイベントの作成、更新、削除が可能
- `calendar.readonly`: カレンダーの読み取りのみ可能（推奨：読み取り専用の場合はこちら）

### アクセストークンの保存

現在の実装では、アクセストークンをFirestoreの`profiles`コレクションに保存しています。

⚠️ **セキュリティ注意**: アクセストークンは機密情報です。本番環境では、以下の対策を検討してください：

- トークンの暗号化
- サーバーサイドでのトークン管理
- トークンの有効期限管理とリフレッシュ

---

## 使用方法

### 管理者側

1. `/employees`ページにアクセス
2. 社員を作成または編集
3. 「**📅 Googleカレンダー連携を許可**」チェックボックスをONにする
4. 保存

### 社員側

1. `/employee-dashboard`にログイン
2. 「**プロフィール**」カード内の「**Googleカレンダーと連携**」ボタンをクリック
3. ポップアップでGoogleの同意画面が表示される
4. 使用するGoogleアカウントを選択
5. 「**許可**」をクリック
6. 連携完了

### 連携状態の確認

- **連携済み**: 緑色のチェックマーク（✓）が表示される
- **未連携**: グレーの「-」が表示される
- **許可されていない**: 🔒アイコンと「管理者により無効化されています」というメッセージが表示される

---

## トラブルシューティング

### 問題1: 「firebaseapp.co」というモーダルが表示される

これは**正常な動作**です。Firebase Authenticationの認証画面です。

**解決方法**:
- Firebase ConsoleでGoogle認証プロバイダーが正しく設定されているか確認
- 承認済みドメインに`localhost`が追加されているか確認

### 問題2: 「このドメインは許可されていません」というエラー

**原因**: 承認済みドメインに現在のドメインが追加されていない

**解決方法**:
1. Firebase Console → Authentication → Settings
2. 「Authorized domains」に現在のドメインを追加

### 問題3: ポップアップがブロックされる

**原因**: ブラウザのポップアップブロッカーが有効

**解決方法**:
- ブラウザの設定でポップアップを許可
- または、別のブラウザで試す

### 問題4: 「連携に失敗しました」というエラー

**原因**: 複数の可能性があります

**確認項目**:
1. Google Cloud ConsoleでGoogle Calendar APIが有効になっているか
2. OAuth同意画面で必要なスコープが追加されているか
3. テストユーザーに追加されているか（アプリが「テスト中」の場合）
4. Firebase ConsoleでGoogle認証プロバイダーが有効になっているか
5. Client IDとClient Secretが正しく設定されているか

### 問題5: アクセストークンが取得できない

**原因**: スコープが正しく設定されていない可能性

**解決方法**:
1. Google Cloud Console → OAuth同意画面 → スコープを確認
2. 必要なスコープ（`calendar.events`、`calendar.readonly`）が追加されているか確認

### 問題6: 社員が連携ボタンを押しても反応しない

**原因**: 管理者が連携を許可していない

**解決方法**:
1. 管理者に連絡
2. `/employees`ページで該当社員の「Googleカレンダー連携を許可」をONにする

---

## 参考資料

### 公式ドキュメント

- [Google Calendar API ドキュメント](https://developers.google.com/calendar/api)
- [Firebase Authentication - Google](https://firebase.google.com/docs/auth/web/google-signin)
- [Google OAuth 2.0 認証](https://developers.google.com/identity/protocols/oauth2)

### 参考記事

- [【トークン取得編】ユーザのGoogleカレンダー情報を取得できる、よく見る同意画面を実装する方法](https://blog.toru-takagi.dev/article/45/)

### スコープ一覧

Google Calendar APIで使用可能なスコープ：

- `https://www.googleapis.com/auth/calendar` - フルアクセス（読み書き）
- `https://www.googleapis.com/auth/calendar.events` - イベントの読み書き
- `https://www.googleapis.com/auth/calendar.readonly` - 読み取り専用
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly` - カレンダーリストの読み取り

---

## 次のステップ

連携が完了したら、以下の機能を実装できます：

1. **Googleカレンダーからのイベント取得**
   - Google Calendar APIを使用してイベントを取得
   - 生産力アプリのカレンダーに表示

2. **生産力アプリからGoogleカレンダーへの同期**
   - 工数エントリをGoogleカレンダーのイベントとして作成
   - 更新・削除の同期

3. **トークンのリフレッシュ**
   - アクセストークンの有効期限が切れた場合の自動リフレッシュ
   - リフレッシュトークンの管理

4. **エラーハンドリング**
   - ネットワークエラー時の再試行
   - トークン失効時の再認証フロー

---

## サポート

問題が解決しない場合は、以下を確認してください：

1. ブラウザのコンソール（F12）でエラーメッセージを確認
2. Firebase Consoleのログを確認
3. Google Cloud ConsoleのAPI使用状況を確認

---

**最終更新**: 2024年

