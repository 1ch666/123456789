# Cloudflare Worker backend

This folder contains the free API backend for `超級垃圾新聞網`.

## What it does

- Stores posts in a Durable Object
- Exposes public APIs for listing posts, publishing posts, and sending reactions
- Supports an optional admin password for setting a featured headline

## API routes

- `GET /api/health`
- `GET /api/posts`
- `POST /api/posts`
- `POST /api/posts/:postId/reactions`
- `PATCH /api/posts/:postId/feature` with `X-Admin-Password`

## Deploy

1. Open a terminal in `cloudflare-worker`
2. Install dependencies:
   `npm install`
3. Log in to Cloudflare:
   `npx wrangler login`
4. Optional: set an admin password for headline management:
   `npx wrangler secret put ADMIN_PASSWORD`
5. Optional: restrict browser access to your Pages domain:
   `npx wrangler secret put CORS_ORIGIN`
6. Deploy:
   `npm run deploy`

After deployment, you will get a Worker URL like:

`https://garbage-news-api.<subdomain>.workers.dev`

Open your frontend with the API URL in the query string once:

`https://your-pages-site/?api=https://garbage-news-api.<subdomain>.workers.dev`

The frontend stores that API URL in `localStorage`, so you only need to set it once per device.
