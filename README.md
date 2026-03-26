# pay demo (Vercel)

MPP and x402 payment-gated API demo deployed as a Vercel serverless function, running against the [Solana Payment Sandbox](https://402.surfnet.dev).

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
| `RPC_URL` | No | Surfnet RPC (defaults to `https://402.surfnet.dev:8899`) |
| `SECRET_KEY` | No | MPP secret key (defaults to `demo-secret-key`) |
| `NETWORK` | No | Solana network (defaults to `localnet`) |

## Endpoints

| Endpoint | Protocol | Price | Description |
|----------|----------|-------|-------------|
| `GET /` | — | free | Landing page |
| `GET /health` | — | free | Health check |
| `GET /mpp/quote/:symbol` | MPP | 0.01 USDC | Stock quote |
| `GET /mpp/weather/:city` | MPP | 0.005 USDC | Weather data |
| `GET /x402/joke` | x402 | $0.001 | Random joke |
| `GET /x402/fact` | x402 | $0.001 | Random fact |

The embedded facilitator for x402 is mounted on the same app at `/facilitator/*`.

## Try it

```bash
# See the 402 challenge
curl -i https://402-demo-api.vercel.app/mpp/quote/SOL

# Handle it automatically with pay
pay --dev curl https://402-demo-api.vercel.app/mpp/quote/SOL
```

## Test locally

```bash
pnpm dev
curl -i http://localhost:3000/mpp/quote/SOL
curl -i http://localhost:3000/x402/joke
```
