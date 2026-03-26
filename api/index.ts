import express from 'express'
import cors from 'cors'
import { generateKeyPairSigner, createKeyPairSignerFromBytes, getBase58Codec } from '@solana/kit'
import { Mppx, solana } from '@solana/mpp/server'

const RPC_URL = process.env.RPC_URL || 'https://oddly-doges-mows.txtx.network:8899'
const NETWORK = process.env.NETWORK || 'localnet'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SECRET_KEY = process.env.SECRET_KEY || 'demo-secret-key'

// Cache the signer across warm invocations
let cachedApp: express.Express | null = null

async function createApp() {
  if (cachedApp) return cachedApp

  // ── Keypair setup ──
  let feePayerSigner
  if (process.env.FEE_PAYER_KEY) {
    const bytes = getBase58Codec().encode(process.env.FEE_PAYER_KEY)
    feePayerSigner = await createKeyPairSignerFromBytes(bytes)
  } else {
    feePayerSigner = await generateKeyPairSigner()
  }

  const recipient = process.env.RECIPIENT || feePayerSigner.address

  // Bootstrap fee payer on surfnet via cheatcodes
  await bootstrap(feePayerSigner.address)

  // ── Express app ──
  const app = express()
  app.use(express.json())
  app.use(cors({
    exposedHeaders: ['www-authenticate', 'payment-receipt'],
  }))

  // ── MPP setup ──
  const mppx = Mppx.create({
    secretKey: SECRET_KEY,
    methods: [solana.charge({
      recipient,
      network: NETWORK,
      rpcUrl: RPC_URL,
      signer: feePayerSigner,
      currency: USDC_MINT,
      decimals: 6,
    })],
  })

  // ── MPP endpoints ──

  app.get('/mpp/quote/:symbol', async (req, res) => {
    const result = await mppx.charge({
      amount: '10000',
      currency: USDC_MINT,
      description: `Stock quote: ${req.params.symbol}`,
    })(toWebRequest(req))

    if (result.status === 402) {
      const challenge = result.challenge as Response
      const body = await challenge.text()
      res.writeHead(challenge.status, Object.fromEntries(challenge.headers))
      res.end(body)
      return
    }

    const response = result.withReceipt(Response.json({
      symbol: req.params.symbol.toUpperCase(),
      price: (Math.random() * 500).toFixed(2),
      currency: 'USD',
      source: 'mpp-demo',
    })) as Response
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(await response.text())
  })

  app.get('/mpp/weather/:city', async (req, res) => {
    const result = await mppx.charge({
      amount: '5000',
      currency: USDC_MINT,
      description: `Weather: ${req.params.city}`,
    })(toWebRequest(req))

    if (result.status === 402) {
      const challenge = result.challenge as Response
      const body = await challenge.text()
      res.writeHead(challenge.status, Object.fromEntries(challenge.headers))
      res.end(body)
      return
    }

    const response = result.withReceipt(Response.json({
      city: req.params.city,
      temperature: Math.floor(Math.random() * 35) + 5,
      conditions: ['Sunny', 'Cloudy', 'Rainy', 'Windy'][Math.floor(Math.random() * 4)],
      source: 'mpp-demo',
    })) as Response
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(await response.text())
  })

  // ── Landing page ──
  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.send(landingPage(recipient))
  })

  // ── Health ──
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', network: NETWORK, recipient })
  })

  cachedApp = app
  return app
}

// ── Surfnet bootstrap ──

async function bootstrap(address: string) {
  const rpc = (method: string, params: any[]) =>
    fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }).then(r => r.json() as Promise<any>)

  // Fund fee payer with 100 SOL
  await rpc('surfnet_setAccount', [address, {
    lamports: 100_000_000_000,
    data: '',
    executable: false,
    owner: '11111111111111111111111111111111',
  }])

  // Fund fee payer's USDC token account with 1000 USDC
  await rpc('surfnet_setTokenAccount', [address, USDC_MINT, {
    amount: 1_000_000_000, // 1000 USDC (6 decimals)
  }])
}

// ── Helpers ──

function toWebRequest(req: express.Request): globalThis.Request {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https'
  const host = req.headers.host || 'localhost'
  const url = `${protocol}://${host}${req.originalUrl}`
  return new globalThis.Request(url, {
    method: req.method,
    headers: new Headers(req.headers as Record<string, string>),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
  })
}

function landingPage(recipient: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Solana Pay Demo</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #e5e5e5; --muted: #888; --accent: #14f195; --purple: #9945ff; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; background: var(--bg); color: var(--fg); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 640px; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    h1 span { color: var(--accent); }
    .subtitle { color: var(--muted); margin-bottom: 2rem; font-size: 0.85rem; }
    .section { margin-bottom: 1.5rem; }
    .section h2 { font-size: 0.9rem; color: var(--purple); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .endpoint { background: #151515; border: 1px solid #252525; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; }
    .endpoint .method { color: var(--accent); font-weight: bold; margin-right: 0.75rem; }
    .endpoint .path { flex: 1; }
    .endpoint .price { color: var(--muted); font-size: 0.8rem; }
    .try { margin-top: 2rem; padding: 1rem; background: #151515; border: 1px solid #252525; border-radius: 6px; }
    .try h2 { font-size: 0.9rem; color: var(--accent); margin-bottom: 0.75rem; }
    code { background: #1a1a1a; padding: 0.2rem 0.4rem; border-radius: 3px; font-size: 0.8rem; }
    pre { background: #1a1a1a; padding: 0.75rem; border-radius: 4px; overflow-x: auto; font-size: 0.8rem; margin-top: 0.5rem; line-height: 1.6; }
    .footer { margin-top: 2rem; color: var(--muted); font-size: 0.75rem; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1><span>pay</span> demo server</h1>
    <p class="subtitle">MPP-gated API endpoints on Solana — pay with USDC to access data</p>

    <div class="section">
      <h2>MPP Endpoints</h2>
      <div class="endpoint">
        <span class="method">GET</span>
        <span class="path">/mpp/quote/:symbol</span>
        <span class="price">0.01 USDC</span>
      </div>
      <div class="endpoint">
        <span class="method">GET</span>
        <span class="path">/mpp/weather/:city</span>
        <span class="price">0.005 USDC</span>
      </div>
    </div>

    <div class="section">
      <h2>Free Endpoints</h2>
      <div class="endpoint">
        <span class="method">GET</span>
        <span class="path">/health</span>
        <span class="price">free</span>
      </div>
    </div>

    <div class="try">
      <h2>Try it with the pay CLI</h2>
      <pre>pay --yes curl ${recipient ? `https://&lt;this-host&gt;` : 'https://&lt;this-host&gt;'}/mpp/quote/SOL
pay --yes curl ${recipient ? `https://&lt;this-host&gt;` : 'https://&lt;this-host&gt;'}/mpp/weather/paris</pre>
    </div>

    <div class="try">
      <h2>Or just curl to see the 402</h2>
      <pre>curl -i /mpp/quote/SOL
# Returns 402 with www-authenticate header</pre>
    </div>

    <p class="footer">
      Recipient: <code>${recipient}</code><br/>
      Network: <code>${NETWORK}</code><br/>
      RPC: <code>${RPC_URL}</code>
    </p>
  </div>
</body>
</html>`
}

// ── Vercel handler ──
export default async function handler(req: any, res: any) {
  const app = await createApp()
  return app(req, res)
}
