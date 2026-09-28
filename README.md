# Hatena Bookmark Companion v0.5

現在のページのはてなブックマーク件数を Chrome のバッジに表示し、Popup で公開コメントとスターを読み、自分のブックマークを登録・編集する非公式 Manifest V3 拡張です。株式会社はてなとは無関係です。

## インストール

Chrome の `chrome://extensions` で Developer mode を有効にし、**Load unpacked** からこのディレクトリを選びます。ツールバーに固定するとバッジを確認しやすくなります。更新時は **`chrome://extensions` → Hatena Bookmark Companion → Reload（再読み込み）** を押してください。拡張の実行に依存パッケージやビルドは不要です。テストには `npm ci` が必要です。

## 読み取り機能

- アクティブな HTTP(S) タブの件数バッジ。赤は自分もブックマーク済み、緑は未ブックマーク、青は OAuth 未接続または状態を判定できない場合です。数字は常にページ全体のブックマーク件数で、0件と取得失敗時は数字を消します。タブ切替、URL 変更、読み込み完了、SPA の History API 更新時に更新します。件数は最長5分、個人の状態は最長2分メモリ上でキャッシュします。
- Popup 上部の総ブックマーク数は service worker の**同じ件数 API 結果**から受け取り、バッジと同期します。Entry JSON の `count` やコメント一覧の長さは総数に使いません。公開コメント数は別に表示します。
- Popup にページタイトル、公開コメント、タグ、日付、スター総数、スターを付けたユニークユーザー数、[はてなのプロフィール画像](https://developer.hatena.ne.jp/ja/documents/hatena/misc/usericon/)を表示します。画像取得失敗時は頭文字へ切り替えます。画像またはユーザー名からプロフィールを新しいタブで開けます。
- スター取得中もコメントを先に表示します。★順、支持人数順、新着順を切り替えられます。Star API の正常な未掲載は `★ 0`、通信・対応付け・データ形式の失敗は `★ —` と表示します。失敗したコメントはスター順・支持人数順の末尾に置きます。カラースターの内訳はスター数のツールチップで確認できます。
- スターの対象 URI は `https://b.hatena.ne.jp/{user}/{YYYYMMDD}#bookmark-{eid}` です。コメント表示用 permalink は Star API に送りません。
- コメントは cache-bust した JSONLite を優先し、公式エントリーページと照合します。不一致や JSONLite 取得失敗時は公式 HTML を解析し、HTML 本文が先頭30件などに限られる場合は公式ページの追加読み込み API を cursor の終端までたどります。公開一覧を取り切っていれば、見出しの集計値と異なっても不足警告を出しません。差はコメント数の ⓘ に表示します。公開一覧の件数を確定できない取得失敗は未検証として警告します。

## Popup から登録・編集する

1. はてな ID で[OAuth 開発者向け設定ページ](https://www.hatena.ne.jp/oauth/develop)を開き、自分用の Consumer を登録します。[公式の登録手順](https://developer.hatena.ne.jp/ja/documents/auth/apis/oauth/consumer/)に従って Consumer key と Consumer secret を取得してください。秘密値は他人に渡さず、リポジトリやスクリーンショットに含めないでください。
2. 登録した Consumer で `read_public`、`write_public`、`read_private`、`write_private` を利用可能にします。これは自分の公開・非公開ブックマークの取得と更新のためです。
3. 拡張の Popup で **設定を開く** を押し、key と secret を入力して **Hatena に接続** を押します。認証画面で許可すると、成功時に接続状態とユーザー名が表示されます。ブラウザー経由の戻りが利用できない場合は **確認コードで接続** を選び、はてなが表示する verifier を一度入力してください。
4. 以後は HTTP(S) ページの Popup でコメント、タグ、非公開設定を入力し、**ブックマークする** または **更新する** を押します。既存ブックマークは background と共有する状態から読み込みます。未登録を示す 404 はエラーになりません。投稿成功時はバッジを即座に赤へ変更し、件数を再取得します。**あとで読む** は同名のタグとして追加・削除します。タグは合計10個までです。

日常の登録・編集は Popup 内で完了します。認証未設定でも件数と公開コメントは利用できます。**はてなの画面で登録・編集** ボタンは常に代替手段として残しています。認証時の画面遷移、キーの保存場所、接続解除、公開配布時の設計は [AUTH_DESIGN.md](AUTH_DESIGN.md) を参照してください。

## 利用 API と権限

- [件数 API](https://developer.hatena.ne.jp/ja/documents/bookmark/apis/getcount/): `bookmark.hatenaapis.com/count/entry`。バッジと Popup の総数の唯一の正本です。
- [エントリー情報 API](https://developer.hatena.ne.jp/ja/documents/bookmark/apis/getinfo/): `b.hatena.ne.jp/entry/jsonlite/`。`_` パラメーターと `cache: no-store` で fresh 取得します。API 自体もキャッシュを使用するため、公式ページのコメント件数で検証します。fallback の追加読み込みには、公式ページが使用する未公開の `/api/entry/{url}/bookmarks` を利用します。ページ構造やこの内部APIが変わった場合は不完全取得として表示します。
- [スター取得 API](https://developer.hatena.ne.jp/ja/documents/star/apis/entry/): `s.hatena.com/entry.json`。20件以内かつ URL 長約3500文字以内でまとめて問い合わせます。API の公式資料は HTTP を例示していますが、本拡張は HTTPS を使います。
- [OAuth 1.0a](https://developer.hatena.ne.jp/ja/documents/auth/apis/oauth/consumer/) と[ブックマーク REST API](https://developer.hatena.ne.jp/ja/documents/bookmark/apis/rest/bookmark/): `www.hatena.com/oauth/*` と `bookmark.hatenaapis.com/rest/1/my/bookmark`

`tabs` はページ URL とタイトル、`webNavigation` は SPA の URL 変更、`storage` は個人用の認証設定、`identity` は OAuth の認証画面と戻り先に使います。ホスト権限は上記 API とプロフィール画像 CDN の Hatena ドメインに限定します。閲覧中のページ URL は件数・エントリー API と認証後の REST API に送られます。スター API には各コメントの公開ブックマーク URI が送られ、画像 CDN にはユーザー ID が送られます。独自サーバー、分析サービス、永続的な閲覧履歴保存はありません。公開 API の取得では Cookie を送信しません。Chrome の内部ページやローカルファイルでは利用できません。公式の「人気コメント」アルゴリズムは再現していません。

## 開発・検証

`npm ci && npm test` で件数 API のバッジ・Popup 共用、JSONLite fresh 取得、HTML parser、完全性判定、fallback、URI 生成、スター集計、ソート、OAuth 署名、投稿パラメータを検証します。`linkedom` はテスト専用です。

実通信を調べるには、拡張 Popup を右クリックして **検証** を開き、Console で `localStorage.setItem('debugHatena', '1')` を実行して Popup を開き直します。`Hatena diagnostics` に activeTabUrl、countApiCount、JSONLite normal/fresh の count・bookmarksLength・publicCommentCount・URL・取得時刻、HTMLの見出し件数と新着・注目欄のraw件数、HTML parser の採用・除外・重複、追加APIの各ページのraw件数と入出力cursor、API parser の採用・除外理由・重複、最終統合前後の件数と重複レコード、commentSource が出ます。debug mode だけ通常JSONLiteも追加取得します。`Generated star URI` と `Star API request` も確認できます。終了後は `localStorage.removeItem('debugHatena')` を実行します。認証後は、Network の REST GET/POST の成否と Popup 内の保存結果を確認してください。認証ヘッダーやトークンは共有しないでください。

`misdo-yamucha` の実測記録は [diagnostics/misdo-yamucha-2026-09-28.json](diagnostics/misdo-yamucha-2026-09-28.json) にあり、取得した公式応答も同じ `diagnostics/` 以下に保存しています。公式ページの見出しは50件ですが、「続きを表示」後の公開一覧、JSONLite、追加APIはいずれも同じ47件です。初期HTMLは新着30件＋注目10件のraw 40件で、HTML内の重複3件を除くと37件です。追加APIは1ページraw 47件、cursorなし、parser除外0件、API内重複0件でした。HTMLとAPIの実在レコードを統合すると84件から47件へ重複排除されます。残る3件の所在や見出しに含まれる理由は公開応答から確認できないため補完しません。Popup は `47 コメント ⓘ` と表示し、ⓘ のツールチップで公式集計50件との差を説明します。取得不完全の赤い警告は表示しません。

2026-09-28 の対象 DPZ ページの最終実測では、通常/fresh JSONLite はともに97 bookmarks・42 comments、件数APIは97、公式HTMLは104 users・44 comments でした。HTML本文の新着コメントは30件で、追加読み込みAPIから44件を取得できました。この応答を実装に通すと `html-fallback` を選び、44件を表示対象にしました。通常/fresh JSONLite の応答ハッシュが同じため、cache-bust だけでは解消していません。どのサーバー側 cache 層に起因するかは特定できていません。Star API の3件の集計は公式ページの表示と一致しました。拡張 Popup・バッジの実機表示、OAuth 認証、実アカウントでの投稿はこの環境では未検証です。

## 構成

- `background.js`: 件数と自分のブックマーク状態を Popup とバッジへ供給、タブ監視、メモリキャッシュ
- `lib/hatena-api.js`, `lib/hatena-entry-parser.js`, `lib/public-comments.js`, `lib/star-api.js`: 公開情報、公式HTML解析、コメント取得判定、スター
- `lib/oauth.js`, `lib/account.js`: OAuth 署名、認証、個人用 REST 操作
- `popup/`, `options/`: Popup と設定画面
- `icons/icon.svg`: 独自アイコンの元画像。各 PNG はここから生成
