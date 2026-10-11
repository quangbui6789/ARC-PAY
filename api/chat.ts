import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createPublicClient, http, erc20Abi, formatUnits } from 'viem'

// Hardcode values (tránh import từ src/)
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as `0x${string}`
const USDC_DECIMALS = 6
const RPC_URL = 'https://rpc.testnet.arc.io'

const SUPPORTED_BRIDGE_CHAINS: Record<string, string> = {
  arc: 'Arc_Testnet',
  'arc testnet': 'Arc_Testnet',
  base: 'Base_Sepolia',
  'base sepolia': 'Base_Sepolia',
  eth: 'Ethereum_Sepolia',
  ethereum: 'Ethereum_Sepolia',
  sepolia: 'Ethereum_Sepolia',
}

interface AgentRequest {
  message: string
  walletAddress?: string
  balance?: string
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

async function fetchBalance(address: string): Promise<string> {
  try {
    const client = createPublicClient({ transport: http(RPC_URL) })
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
  const fromToMatch = /(?:from\s+)?([\w ]+?)\s+to\s+([\w ]+?)(?:\s+\d|$)/.exec(lower)
  if (fromToMatch) {
    const from = SUPPORTED_BRIDGE_CHAINS[fromToMatch[1].trim()]
    const to = SUPPORTED_BRIDGE_CHAINS[fromToMatch[2].trim()]
    if (from && to) return { from, to }
  }
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
        ? `Opening the bridge sheet to move **${intent.amount} USDC** from ${intent.fromChain?.replace(/_/g, ' ')} → ${intent.toChain?.replace(/_/g, ' ')} via CCTP.`
        : `Opening the bridge sheet (${intent.fromChain?.replace(/_/g, ' ')} → ${intent.toChain?.replace(/_/g, ' ')}). Enter an amount to continue.`
    case 'request':
      return intent.amount
        ? `Creating a payment request for **${intent.amount} USDC**${intent.memo ? ` — "${intent.memo}"` : ''}. I'll open the request sheet.`
        : "Opening the request sheet. How much USDC do you want to request?"
    default:
      return `I can help you **send**, **bridge**, or **request** USDC, and check your balance.\n\nTry: "Send 5 USDC to 0x…" · "Bridge 10 USDC to Base" · "What's my balance?"`
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { message, walletAddress, balance: clientBalance } = req.body as AgentRequest

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' })
  }

  let balance = clientBalance ?? '0'
  if (walletAddress) {
    balance = await fetchBalance(walletAddress)
  }

  const intent = ruleBasedIntent(message)
  const reply = buildReply(intent, balance, !!walletAddress)

  return res.status(200).json({ reply, intent })
}
