import express from 'express'
import cors from 'cors'
import { generateKeyPairSigner, createKeyPairSignerFromBytes, getBase58Codec } from '@solana/kit'
import { Mppx, solana } from '@solana/mpp/server'
import { paymentMiddleware } from 'x402-express'

const RPC_URL = process.env.RPC_URL || 'http://402.surfnet.dev:8899'
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

  // Bootstrap fee payer on surfnet via cheatcodes (best-effort, don't block startup)
  await bootstrap(feePayerSigner.address).catch(() => {})

  // ── Express app ──
  const app = express()
  app.use(express.json())
  app.use(cors({
    exposedHeaders: [
      'www-authenticate', 'payment-receipt',       // MPP
      'x-payment-required', 'x-payment-response',  // x402
    ],
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

  // ── x402 endpoints ──
  // Facilitator runs as a separate serverless function at /facilitator
  const facilitatorUrl = process.env.FACILITATOR_URL || selfUrl() + '/facilitator'

  const x402App = express.Router()

  x402App.use(paymentMiddleware(
    recipient,
    {
      '/x402/joke': {
        price: '$0.001',
        network: 'solana-devnet' as any,
        config: { description: 'A random joke' },
      },
      '/x402/fact': {
        price: '$0.001',
        network: 'solana-devnet' as any,
        config: { description: 'A random fact' },
      },
    },
    { url: facilitatorUrl },
  ))

  x402App.get('/x402/joke', (_req, res) => {
    const jokes = [
      "Why do programmers prefer dark mode? Because light attracts bugs.",
      "There are 10 types of people: those who understand binary and those who don't.",
      "A SQL query walks into a bar, sees two tables, and asks: 'Can I JOIN you?'",
    ]
    res.json({ joke: jokes[Math.floor(Math.random() * jokes.length)], source: 'x402-demo' })
  })

  x402App.get('/x402/fact', (_req, res) => {
    const facts = [
      "Honey never spoils. Archaeologists found 3000-year-old honey in Egyptian tombs.",
      "Octopuses have three hearts and blue blood.",
      "A group of flamingos is called a 'flamboyance'.",
    ]
    res.json({ fact: facts[Math.floor(Math.random() * facts.length)], source: 'x402-demo' })
  })

  app.use(x402App)

  // ── Landing page ──
  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.send(landingPage(recipient))
  })

  // ── Health ──
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      network: NETWORK,
      recipient,
      facilitatorUrl,
      vercelUrl: process.env.VERCEL_URL || '(not set)',
    })
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
      signal: AbortSignal.timeout(5000),
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

function selfUrl(): string {
  // Vercel provides VERCEL_URL (no protocol) on deployed functions
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  const port = process.env.PORT || '3000'
  return `http://localhost:${port}`
}

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
    :root { --bg: #0a0a0a; --fg: #e5e5e5; --muted: #888; --accent: #14f195; --purple: #9945ff; --blue: #00d4ff; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; background: var(--bg); color: var(--fg); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 640px; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    h1 span { color: var(--accent); }
    .subtitle { color: var(--muted); margin-bottom: 2rem; font-size: 0.85rem; }
    .section { margin-bottom: 1.5rem; }
    .section h2 { font-size: 0.9rem; color: var(--purple); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .section h2.x402 { color: var(--blue); }
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
    <p class="subtitle">402 payment-gated API endpoints on Solana — powered by <a href="https://github.com/txtx/surfpool">Surfpool</a> on <code>402.surfnet.dev</code>. No real funds needed.</p>

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
      <h2 class="x402">x402 Endpoints</h2>
      <div class="endpoint">
        <span class="method">GET</span>
        <span class="path">/x402/joke</span>
        <span class="price">$0.001</span>
      </div>
      <div class="endpoint">
        <span class="method">GET</span>
        <span class="path">/x402/fact</span>
        <span class="price">$0.001</span>
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
      <pre># MPP
pay --dev curl https://402-demo-api.vercel.app/mpp/quote/SOL
pay --dev curl https://402-demo-api.vercel.app/mpp/weather/paris

# x402
pay --dev curl https://402-demo-api.vercel.app/x402/joke
pay --dev curl https://402-demo-api.vercel.app/x402/fact</pre>
    </div>

    <div class="try">
      <h2>Or just curl to see the 402</h2>
      <pre>curl -i https://402-demo-api.vercel.app/mpp/quote/SOL
curl -i https://402-demo-api.vercel.app/x402/joke</pre>
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
