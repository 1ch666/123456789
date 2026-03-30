# 免費部署說明

這個專案目前拆成兩部分：

- 前端：`index.html`，可直接放在 GitHub Pages
- 後端：`cloudflare-worker/`，可免費部署到 Cloudflare Workers + Durable Objects

## 1. 部署前端到 GitHub Pages

把根目錄的 `index.html` push 到 GitHub 後，在 repo 的 `Settings -> Pages` 設定：

1. `Source` 選 `Deploy from a branch`
2. `Branch` 選你的主分支
3. Folder 選 `/ (root)`

存檔後，GitHub Pages 會自動發布。

## 2. 部署免費 API 到 Cloudflare Workers

進入 Worker 目錄：

```powershell
cd C:\Users\user\Desktop\網站\cloudflare-worker
npm install
npx wrangler login
```

可選設定：

```powershell
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put CORS_ORIGIN
```

正式部署：

```powershell
npm run deploy
```

部署成功後，會得到類似：

`https://garbage-news-api.<你的-subdomain>.workers.dev`

## 3. 讓前端接上 API

第一次打開網站時，在網址後面加上：

```text
?api=https://garbage-news-api.<你的-subdomain>.workers.dev
```

前端會把這個 API 網址存進 `localStorage`，之後同一台裝置不需要再加。

## 4. 本地開發

```powershell
cd C:\Users\user\Desktop\網站
node .\server\server.js
```

然後打開：

```text
http://localhost:3000/?api=http://localhost:3000
```

## 5. 資料說明

- Cloudflare Worker 版會把文章存到 Durable Object
- 本地 Express 版會把文章存到 `server/data/posts.json`
- 若 API 尚未設定，前端會退回展示模式並顯示內建示範文章
