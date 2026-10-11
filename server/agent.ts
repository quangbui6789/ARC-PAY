/**
 * Arc Pay — AI Agent backend
 *
 * POST /chat   { message, walletAddress?, balance? }
 *              → { reply, intent? }
 *
 * Intent shapes the frontend knows how to handle:
 *   { action: 'send',    to, amount, memo? }
 *   { action: 'bridge',  fromChain, toChain, amount }
 *   { action: 'request', amount, memo? }
 *   { action: 'balance' }
 *   { action: 'none' }
 *
 * The agent uses a small rule-based NLU so it works without an LLM API key.
 * If OPENAI_API_KEY is present it upgrades to an LLM for better accuracy.
 */

import express from 'express'
import cors from 'cors'
import { createPublicClient, http, erc20Abi, formatUnits } from 'viem'

// Import onchain facts — same registry the frontend uses
// (path resolves from project root because bun runs from /home/user/app)
import { getUsdc, getChain } from '../src/onchain-facts.ts'

const app = express()
app.use(cors())
app.use(express.json())

// ─── Chain / USDC constants ───────────────────────────────────────────────────
const ARC_TESTNET_ID = 5042002
const usdcFact = getUsdc(ARC_TESTNET_ID)!
const chainFact = getChain(ARC_TESTNET_ID)!

const USDC_ADDRESS = usdcFact.address as `0x${string}`
const USDC_DECIMALS = usdcFact.decimals

// Build RPC URL from proxy if available, fall back to public RPC from registry
const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',')
const rpcUrl =
  process.env.RPC_PROXY_BASE_URL && proxyChains.includes('Arc_Testnet')
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
    : chainFact.rpcUrls[0] // public RPC from registry — may rate-limit under load

const SUPPORTED_BRIDGE_CHAINS: Record<string, string> = {
  arc: 'Arc_Testnet',
  'arc testnet': 'Arc_Testnet',
  base: 'Base_Sepolia',
  'base sepolia': 'Base_Sepolia',
  eth: 'Ethereum_Sepolia',
  ethereum: 'Ethereum_Sepolia',
  sepolia: 'Ethereum_Sepolia',
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface AgentRequest {
  message: string
  walletAddress?: string
  balance?: string    // formatted ERC-20 balance from the frontend (optional)
}

type IntentAction = 'send' | 'bridge' | 'request' | 'balance' | 'none'

interface Intent {
  action: IntentAction
  to?: string
  amount?: string
  memo?: string
  fromChain?: string
  toChain?: string
}

interface AgentResponse {
  reply: string
  intent?: Intent
}

// ─── Live balance helper ───────────────────────────────────────────────────────
async function fetchBalance(address: string): Promise<string> {
  try {
    const client = createPublicClient({ transport: http(rpcUrl) })
    const raw = await client.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    })
    return formatUnits(raw as bigint, USDC_DECIMALS)
  } catch {
    return '0'
  }
}

// ─── Rule-based NLU ───────────────────────────────────────────────────────────
const ADDRESS_RE = /0x[0-9a-fA-F]{40}/
const AMOUNT_RE = /\$?(\d+(?:\.\d{1,6})?)/

function extractAddress(text: string): string | undefined {
  return ADDRESS_RE.exec(text)?.[0]
}

function extractAmount(text: string): string | undefined {
  const m = AMOUNT_RE.exec(text)
  return m ? m[1] : undefined
}

function extractBridgeChains(text: string): { from?: string; to?: string } {
  const lower = text.toLowerCase()

  // "from X to Y"
  const fromToMatch = /(?:from\s+)?([\w ]+?)\s+to\s+([\w ]+?)(?:\s+\d|$)/.exec(lower)
  if (fromToMatch) {
    const from = SUPPORTED_BRIDGE_CHAINS[fromToMatch[1].trim()]
    const to = SUPPORTED_BRIDGE_CHAINS[fromToMatch[2].trim()]
    if (from && to) return { from, to }
  }

  // fallback: any two named chains in the message
  const found = Object.keys(SUPPORTED_BRIDGE_CHAINS).filter((k) => lower.includes(k))
  if (found.length >= 2) {
    return {
      from: SUPPORTED_BRIDGE_CHAINS[found[0]],
      to: SUPPORTED_BRIDGE_CHAINS[found[1]],
    }
  }
  return {}
}

function ruleBasedIntent(message: string): Intent {
  const lower = message.toLowerCase()

  if (/balance|how much|wallet|funds/.test(lower)) return { action: 'balance' }

  if (/bridge|cross.?chain|move.*usdc|transfer.*to (base|eth|arc)/.test(lower)) {
    const amount = extractAmount(message)
    const { from, to } = extractBridgeChains(message)
    return {
      action: 'bridge',
      amount,
      fromChain: from ?? 'Arc_Testnet',
      toChain: to ?? 'Base_Sepolia',
    }
  }

  if (/request|invoice|ask for|charge/.test(lower)) {
    const amount = extractAmount(message)
    const memoMatch = /(?:for|memo|note)[:\s]+["']?(.+?)["']?$/.exec(message)
    return { action: 'request', amount, memo: memoMatch?.[1] }
  }

  if (/send|pay|transfer|give/.test(lower)) {
    const to = extractAddress(message)
    const amount = extractAmount(message)
    const memoMatch = /(?:for|memo|note)[:\s]+["']?(.+?)["']?$/.exec(message)
    if (to || amount) return { action: 'send', to, amount, memo: memoMatch?.[1] }
  }

  return { action: 'none' }
}

// ─── Optional LLM upgrade (set OPENAI_API_KEY in .env) ───────────────────────
async function llmIntent(message: string, context: string): Promise<Intent | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const systemPrompt = `You are the AI assistant for Arc Pay, a USDC payment dApp on Arc Testnet.
Extract the user intent and return ONLY valid JSON (no markdown, no prose) matching one of:
{"action":"send","to":"0x...","amount":"5.00","memo":"optional"}
{"action":"bridge","fromChain":"Arc_Testnet","toChain":"Base_Sepolia","amount":"10.00"}
{"action":"request","amount":"5.00","memo":"optional"}
{"action":"balance"}
{"action":"none"}
Valid chain identifiers: Arc_Testnet, Base_Sepolia, Ethereum_Sepolia.
Context: ${context}`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
    })
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
    return JSON.parse(raw) as Intent
  } catch {
    return null
  }
}

// ─── Reply builder ────────────────────────────────────────────────────────────
function buildReply(intent: Intent, balance: string, connected: boolean): string {
  if (!connected) {
    return "Connect your wallet first — then I can check your balance, send USDC, or bridge to another chain."
  }

  switch (intent.action) {
    case 'balance':
      return `Your Arc Testnet balance is **${parseFloat(balance).toFixed(2)} USDC**. Want to send or bridge some?`

    case 'send':
      if (intent.to && intent.amount)
        return `Opening the send sheet — **${intent.amount} USDC** to \`${intent.to.slice(0, 6)}…${intent.to.slice(-4)}\`. Review and confirm in your wallet.`
      if (intent.amount)
        return `Got **${intent.amount} USDC**. Who should receive it? Paste a wallet address.`
      if (intent.to)
        return `Sending to \`${intent.to.slice(0, 6)}…${intent.to.slice(-4)}\`. How much USDC?`
      return "Who do you want to send USDC to, and how much?"

    case 'bridge':
      return intent.amount
        ? `Opening the bridge sheet to move **${intent.amount} USDC** from ${intent.fromChain?.replace(/_/g, ' ')} → ${intent.toChain?.replace(/_/g, ' ')} via CCTP (~8–20 s).`
        : `Opening the bridge sheet (${intent.fromChain?.replace(/_/g, ' ')} → ${intent.toChain?.replace(/_/g, ' ')}). Enter an amount to continue.`

    case 'request':
      return intent.amount
        ? `Creating a payment request for **${intent.amount} USDC**${intent.memo ? ` — "${intent.memo}"` : ''}. I'll open the request sheet.`
        : "Opening the request sheet. How much USDC do you want to request?"

    default:
      return `I can help you **send**, **bridge**, or **request** USDC, and check your balance.\n\nTry: "Send 5 USDC to 0x…" · "Bridge 10 USDC to Base" · "What's my balance?"`
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { message, walletAddress, balance: clientBalance } = req.body as AgentRequest

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message is required' })
    return
  }

  // Prefer live balance over client-supplied one
  let balance = clientBalance ?? '0'
  if (walletAddress) {
    balance = await fetchBalance(walletAddress)
  }

  const context = walletAddress
    ? `Wallet: ${walletAddress}, USDC balance: ${balance}`
    : 'No wallet connected'

  let intent: Intent = ruleBasedIntent(message)
  const llmResult = await llmIntent(message, context)
  if (llmResult) intent = llmResult

  const body: AgentResponse = {
    reply: buildReply(intent, balance, !!walletAddress),
    intent,
  }
  res.json(body)
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, llm: !!process.env.OPENAI_API_KEY })
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Arc Pay agent server on :${PORT} (LLM: ${process.env.OPENAI_API_KEY ? 'yes' : 'rule-based'})`)
})
