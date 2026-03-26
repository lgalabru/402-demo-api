# pay demo (Vercel)

MPP-gated API demo deployed as a Vercel serverless function, running against a hosted Surfnet.

On cold start the serverless function bootstraps the fee payer with 100 SOL + 1000 USDC via surfnet cheatcodes — no real funds needed.

## Deploy

```bash
cd demo
pnpm install
vercel          # preview
vercel --prod   # production
```

## Environment Variables

Set these in your Vercel project settings:

| Variable | Required | Description |
|----------|----------|-------------|
| `RECIPIENT` | No | Solana address to receive payments (defaults to fee payer) |
| `FEE_PAYER_KEY` | No | Base58-encoded keypair (generates ephemeral if unset) |
| `RPC_URL` | No | Surfnet RPC (defaults to `https://oddly-doges-mows.txtx.network:8899`) |
| `SECRET_KEY` | No | MPP secret key (defaults to `demo-secret-key`) |
| `NETWORK` | No | Solana network (defaults to `localnet`) |

## Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /` | free | Landing page |
| `GET /health` | free | Health check |
| `GET /mpp/quote/:symbol` | 0.01 USDC | Stock quote |
| `GET /mpp/weather/:city` | 0.005 USDC | Weather data |

## Test locally

```bash
pnpm dev
curl -i http://localhost:3000/mpp/quote/SOL
```
