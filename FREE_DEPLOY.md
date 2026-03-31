# 免費部署流程

這份流程會把系統拆成兩部分：

- 前端：GitHub Pages
- 後端 API：Cloudflare Workers

完成後，手機和平板只要打開 GitHub Pages 網址，就能使用同一套系統。

## 1. 前端上線到 GitHub Pages

你的前端首頁已經是根目錄的 `index.html`，GitHub Pages 可以直接發布。

### 設定步驟

1. 打開你的 repo：
   `https://github.com/1ch666/123456789`
2. 進入 `Settings`
3. 點左邊 `Pages`
4. `Build and deployment`
5. `Source` 選 `Deploy from a branch`
6. `Branch` 選 `main`
7. Folder 選 `/ (root)`
8. 按 `Save`

### 成功後網址

GitHub Pages 網址通常會是：

`https://1ch666.github.io/123456789/`

## 2. 後端上線到 Cloudflare Workers

後端部署目錄是：

`C:\Users\user\Desktop\網站\cloudflare-worker`

### 第一次部署

開 PowerShell：

```powershell
cd C:\Users\user\Desktop\網站\cloudflare-worker
npm install
npx wrangler login
npx wrangler secret put ADMIN_PASSWORD
npm run deploy
```

### 你會需要輸入的東西

- `ADMIN_PASSWORD`
  這裡輸入你真正要給櫃台用的密碼

### 部署成功後

Cloudflare 會給你一個網址，格式通常像：

`https://counter-api.<你的-subdomain>.workers.dev`

## 3. 把前端綁到正式 API

前端支援用網址參數設定 API，設定一次後會記在瀏覽器。

第一次打開前端時，請用這種格式：

```text
https://1ch666.github.io/123456789/?api=https://counter-api.<你的-subdomain>.workers.dev
```

這樣這台手機或平板之後就會記住正式 API。

## 4. 給手機和平板使用

部署完成後，你可以把這個網址傳給手機和平板：

```text
https://1ch666.github.io/123456789/?api=https://counter-api.<你的-subdomain>.workers.dev
```

建議：

- 櫃台平板：先登入後固定開著櫃台頁
- 製作區平板：先登入後切到製作頁
- 客人顯示器：只開顯示頁，不登入

## 5. 之後更新程式

每次你修改完程式並 push 到 GitHub 之後：

- GitHub Pages 會自動更新前端

如果你有改 `cloudflare-worker/` 裡面的 API，還要再部署一次 Workers：

```powershell
cd C:\Users\user\Desktop\網站\cloudflare-worker
npm run deploy
```

## 6. 建議的正式設定

部署穩定後，建議把 Worker 的 `CORS_ORIGIN` 改成你的 GitHub Pages 網址，而不是 `*`。

你可以在 `cloudflare-worker/wrangler.jsonc` 裡把：

```json
"CORS_ORIGIN": "*"
```

改成：

```json
"CORS_ORIGIN": "https://1ch666.github.io"
```

如果之後你要，我可以再幫你把這個限制直接改好。
