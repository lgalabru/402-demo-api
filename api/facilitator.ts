import express from 'express'

const RPC_URL = process.env.RPC_URL || 'http://402.surfnet.dev:8899'

const app = express()
app.use(express.json())

app.get('/facilitator/supported', (_req, res) => {
  // feePayer is informational — the actual signer lives in the main function
  const feePayer = process.env.RECIPIENT || 'demo'
  res.json({
    kinds: [{
      scheme: 'exact',
      network: 'solana-devnet',
      extra: { feePayer },
    }],
  })
})

app.post('/facilitator/verify', (req, res) => {
  const { paymentPayload } = req.body
  if (!paymentPayload?.payload) {
    return res.json({ isValid: false, invalidReason: 'Missing payload' })
  }
  res.json({
    isValid: true,
    payer: paymentPayload.payload.authorization?.from || 'unknown',
  })
})

app.post('/facilitator/settle', async (req, res) => {
  const { paymentPayload } = req.body
  try {
    const payload = paymentPayload?.payload
    if (!payload) {
      return res.json({ success: false, errorReason: 'Missing payload' })
    }

    if (payload.transaction) {
      const result = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'sendTransaction',
          params: [payload.transaction, { encoding: 'base64', skipPreflight: true }],
        }),
      })
      const data = await result.json() as any
      if (data.error) {
        return res.json({ success: false, errorReason: data.error.message })
      }
      return res.json({ success: true, transaction: data.result })
    }

    return res.json({ success: true, transaction: 'local-facilitator-settled' })
  } catch (err: any) {
    return res.json({ success: false, errorReason: err.message })
  }
})

export default function handler(req: any, res: any) {
  return app(req, res)
}
