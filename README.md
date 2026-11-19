# Secret Santa

Gift-exchange site: draw names, share private links, write wish lists, ask your giftee anonymous questions. Viewers can share and browse wish lists without being in the draw.

Live: https://secret-santa-8zg.pages.dev

## How it's built
- `public/` — static page (`index.html`, `app.js`) plus `_worker.js`, the API (Cloudflare Pages advanced mode).
- Cloudflare D1 database `secret-santa`, one JSON row per group (`schema.sql`).

## Deploy
```sh
npx wrangler d1 execute secret-santa --remote --file schema.sql   # first time only
npx wrangler pages deploy --branch main
```

## Run locally
```sh
npx wrangler d1 execute secret-santa --local --file schema.sql
npx wrangler pages dev
```
