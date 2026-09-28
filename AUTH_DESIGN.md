# 認証・投稿の設計（v0.3）

## Personal mode

各利用者が自分の Hatena OAuth Consumer を作り、Consumer key と secret を Options に入力する。共通の secret は拡張に埋め込まない。Consumer の作成場所は[はてな OAuth 開発者向け設定](https://www.hatena.ne.jp/oauth/develop)、手順は[公式資料](https://developer.hatena.ne.jp/ja/documents/auth/apis/oauth/consumer/)にある。

OAuth 1.0a の request token 取得時に `read_public,write_public,read_private,write_private` を要求する。これは自分の既存ブックマークの公開・非公開の取得、および公開・非公開の追加・更新に対応する[公式 scope](https://developer.hatena.ne.jp/ja/documents/auth/apis/oauth/scopes/)である。認可はまず Chrome の `identity.getRedirectURL('hatena')` と `identity.launchWebAuthFlow()` を使い、戻り先の origin/path、request token、verifier を照合する。はてなの callback が利用できない場合は `oauth_callback=oob` で verifier を手入力する。いずれも一度だけ認証画面を開く。Request token と secret は設定画面のメモリに一時保持する。

Consumer credentials、access token、access token secret、ユーザー名は `chrome.storage.local` に保存する。Options は storage のアクセスを trusted contexts に制限する。接続解除は access token と secret、ユーザー名をローカルから削除し、Consumer credentials は残す。**保存した設定をすべて削除** は Consumer credentials も消す。ローカル削除は Hatena 側の認可取消しを意味しない。利用者は共有端末を避け、必要なら Hatena 側でも認可を解除する。拡張に独自バックエンド、テレメトリー、Cookie ベースの認証はない。

Popup は署名付き `GET /rest/1/my/bookmark?url=...` で既存ブックマークを読み、404 は未登録として扱う。署名付き `POST /rest/1/my/bookmark` に `url`、`comment`、複数の `tags`、`private` を送って追加・更新する。日常の登録操作では Hatena の登録画面に遷移しない。REST の[公式仕様](https://developer.hatena.ne.jp/ja/documents/bookmark/apis/rest/bookmark/)に従い、POST 本文は `application/x-www-form-urlencoded` とする。OAuth 署名には URL query、フォーム本文、OAuth パラメータを含める。HMAC-SHA1 の実装とテストは [RFC 5849](https://www.rfc-editor.org/rfc/rfc5849.html) に従う。

## Future public mode

一般公開版で全利用者に共通 Consumer secret を拡張本体に埋め込む設計は採らない。利用者が secret を意識せず使うには、安全な backend/proxy で secret と OAuth フローを管理するか、はてなが将来公開クライアント向けの別の認証方式を提供する必要がある可能性がある。サーバー方式はトークン保管、CSRF、プライバシー、運用の追加設計が必要で、v0.3 の範囲外である。未公開の内部 API や Cookie・DOM を使った投稿は採用しない。

## 実機確認の残り

この開発環境では Hatena OAuth/REST ホストに端末から接続できず、実際の callback、oob、GET、POST は未確認。各利用者の Consumer とアカウントで、認証後の状態表示、既存ブックマークの prefill、公開・非公開の追加更新、接続解除を確認する必要がある。
