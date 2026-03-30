# Cloudflare Worker backend

This folder contains the free-deployable API for the drink and ice order system.

## What it does

- Stores orders and pickup numbers in a Durable Object
- Supports counter login, order creation, calling numbers, kitchen status updates, and daily stats
- Uses `ADMIN_PASSWORD` as a Worker secret

## Deploy

1. Open a terminal in `cloudflare-worker`
2. Install dependencies:
   `npm install`
3. Log in to Cloudflare:
   `npx wrangler login`
4. Set the counter password:
   `npx wrangler secret put ADMIN_PASSWORD`
5. Optional: limit browser access to your GitHub Pages domain:
   `npx wrangler secret put CORS_ORIGIN`
6. Deploy:
   `npm run deploy`

After deployment, you will get a Worker URL like:

`https://counter-api.<subdomain>.workers.dev`

Open your frontend with the API URL in the query string once:

`https://1ch666.github.io/123456789/?api=https://counter-api.<subdomain>.workers.dev`

The frontend stores that API URL in `localStorage`, so you only need to set it once per device.
