/**
 * ChatWidget — floating AI agent chat bubble for Arc Pay.
 *
 * The agent interprets natural-language requests and returns structured
 * intents. The widget fires callbacks so PaymentApp can open the right
 * sheet pre-filled without the agent ever holding wallet keys.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, X, Send, Loader2, Bot, User, Sparkles } from 'lucide-react'
import { getUsdc } from '@/onchain-facts'
import { Amount, usdcDecimalsFor } from '@/onchain-money'

// ─── Types ────────────────────────────────────────────────────────────────────
type IntentAction = 'send' | 'bridge' | 'request' | 'balance' | 'none'

export interface AgentIntent {
  action: IntentAction
  to?: string
  amount?: string
  memo?: string
  fromChain?: string
  toChain?: string
}

interface Message {
  id: string
  role: 'user' | 'agent'
  text: string
  intent?: AgentIntent
  ts: number
}

interface ChatWidgetProps {
  onSendIntent: (intent: AgentIntent) => void
  onBridgeIntent: (intent: AgentIntent) => void
  onRequestIntent: (intent: AgentIntent) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CHAIN_ID = 5042002
const USDC_FACT = getUsdc(CHAIN_ID)!
const USDC_ADDRESS = USDC_FACT.address as `0x${string}`

const WELCOME = `Hi! I'm your Arc Pay assistant. I can help you:
• **Send** USDC to any address
• **Bridge** USDC to Base or Ethereum
• **Request** a payment from someone
• **Check** your balance

Try: "Send 5 USDC to 0x…" or "Bridge 10 USDC to Base"`

// ─── Markdown-lite renderer (bold only) ──────────────────────────────────────
function renderText(text: string) {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/\*\*(.+?)\*\*/)
    return (
      <span key={i}>
        {parts.map((part, j) =>
          j % 2 === 1
            ? <strong key={j}>{part}</strong>
            : <span key={j}>{part}</span>
        )}
        {i < text.split('\n').length - 1 && <br />}
      </span>
    )
  })
}

// ─── Intent action chip ───────────────────────────────────────────────────────
function IntentChip({
  intent,
  onFire,
}: {
  intent: AgentIntent
  onFire: () => void
}) {
  if (intent.action === 'none' || intent.action === 'balance') return null

  const labels: Record<string, string> = {
    send: `Open send sheet${intent.amount ? ` · ${intent.amount} USDC` : ''}`,
    bridge: `Open bridge sheet${intent.amount ? ` · ${intent.amount} USDC` : ''}`,
    request: `Open request sheet${intent.amount ? ` · ${intent.amount} USDC` : ''}`,
  }
  const label = labels[intent.action]
  if (!label) return null

  return (
    <button
      onClick={onFire}
      className="mt-2 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
      style={{ background: 'var(--accent)' }}
    >
      <Sparkles className="size-3" />
      {label}
    </button>
  )
}

// ─── ChatWidget ───────────────────────────────────────────────────────────────
export default function ChatWidget({
  onSendIntent,
  onBridgeIntent,
  onRequestIntent,
}: ChatWidgetProps) {
  const { address, isConnected } = useAccount()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>(() => {
    // lazy initializer keeps Date.now() out of render
    return [{ id: 'welcome', role: 'agent', text: WELCOME, ts: Date.now() }]
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [unread, setUnread] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Live USDC balance to include as context
  const { data: rawBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  })
  const formattedBalance = rawBalance
    ? Amount.fromRaw(rawBalance, usdcDecimalsFor(CHAIN_ID)).toFixed(6)
    : undefined

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when opened; clear unread on the event, not inside an effect
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 120)
    }
  }, [open])

  const fireIntent = useCallback((intent: AgentIntent) => {
    if (intent.action === 'send') onSendIntent(intent)
    else if (intent.action === 'bridge') onBridgeIntent(intent)
    else if (intent.action === 'request') onRequestIntent(intent)
    setOpen(false)
  }, [onSendIntent, onBridgeIntent, onRequestIntent])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text, ts: Date.now() }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          walletAddress: address,
          balance: formattedBalance,
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = (await res.json()) as { reply: string; intent?: AgentIntent }

      const agentMsg: Message = {
        id: crypto.randomUUID(),
        role: 'agent',
        text: data.reply,
        intent: data.intent,
        ts: Date.now(),
      }
      setMessages((prev) => [...prev, agentMsg])

      if (!open) setUnread((n) => n + 1)

      // Auto-fire single-step intents (balance check) without user needing to click chip
      if (data.intent?.action === 'balance') {
        // already handled in reply text — no sheet to open
      }
    } catch (err) {
      const errMsg: Message = {
        id: crypto.randomUUID(),
        role: 'agent',
        text: "Sorry, I couldn't reach the agent server. Make sure the backend is running (`bun run start`).",
        ts: Date.now(),
      }
      setMessages((prev) => [...prev, errMsg])
    } finally {
      setLoading(false)
    }
  }, [input, loading, address, formattedBalance, open])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  // Quick-prompt chips shown when no conversation yet
  const quickPrompts = [
    'What\'s my balance?',
    'Send 1 USDC',
    'Bridge to Base',
    'Request 5 USDC',
  ]

  return (
    <>
      {/* ── Floating button ── */}
      <button
        onClick={() => { setOpen((v) => { if (!v) setUnread(0); return !v }) }}
        className="fixed bottom-24 right-4 z-50 flex size-14 items-center justify-center rounded-full shadow-xl transition-all hover:scale-105 active:scale-95"
        style={{ background: 'var(--accent)', color: '#fff' }}
        aria-label="Open AI agent chat"
      >
        <AnimatePresence mode="wait">
          {open ? (
            <motion.span key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <X className="size-6" />
            </motion.span>
          ) : (
            <motion.span key="open" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <MessageCircle className="size-6" />
            </motion.span>
          )}
        </AnimatePresence>
        {/* Unread badge */}
        {unread > 0 && !open && (
          <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {/* ── Chat panel ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed bottom-44 right-4 z-50 flex w-80 flex-col overflow-hidden rounded-3xl shadow-2xl"
            style={{
              background: 'rgba(255,255,255,0.96)',
              backdropFilter: 'blur(32px) saturate(200%)',
              WebkitBackdropFilter: 'blur(32px) saturate(200%)',
              border: '1px solid var(--border)',
              maxHeight: '70dvh',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center gap-2.5 px-4 py-3"
              style={{ borderBottom: '1px solid var(--border)', background: 'var(--accent)' }}
            >
              <div className="flex size-8 items-center justify-center rounded-xl bg-white/20">
                <Bot className="size-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Arc Pay Agent</p>
                <p className="text-[11px] text-white/70">
                  {isConnected ? 'Wallet connected' : 'No wallet'}
                  {isConnected && formattedBalance ? ` · ${parseFloat(formattedBalance).toFixed(2)} USDC` : ''}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto rounded-lg p-1 text-white/60 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3" style={{ minHeight: 0 }}>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'agent' && (
                    <div
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
                      style={{ background: 'var(--accent)' }}
                    >
                      <Bot className="size-3.5 text-white" />
                    </div>
                  )}
                  <div className={`max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                    <div
                      className="rounded-2xl px-3 py-2 text-sm leading-relaxed"
                      style={
                        msg.role === 'user'
                          ? { background: 'var(--accent)', color: '#fff', borderBottomRightRadius: '4px' }
                          : { background: 'var(--surface-muted)', color: 'var(--ink)', borderBottomLeftRadius: '4px' }
                      }
                    >
                      {renderText(msg.text)}
                    </div>
                    {msg.intent && (
                      <IntentChip intent={msg.intent} onFire={() => fireIntent(msg.intent!)} />
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
                      style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
                    >
                      <User className="size-3.5" style={{ color: 'var(--muted)' }} />
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex items-center gap-2">
                  <div
                    className="flex size-6 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'var(--accent)' }}
                  >
                    <Bot className="size-3.5 text-white" />
                  </div>
                  <div className="rounded-2xl px-3 py-2" style={{ background: 'var(--surface-muted)' }}>
                    <Loader2 className="size-4 animate-spin" style={{ color: 'var(--muted)' }} />
                  </div>
                </div>
              )}

              {/* Quick-prompt chips (shown only at start) */}
              {messages.length === 1 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {quickPrompts.map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 0) }}
                      className="rounded-xl border px-2.5 py-1 text-xs font-medium transition-all hover:scale-[1.02]"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink-2)', background: 'var(--surface-strong)' }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div
              className="flex items-center gap-2 px-3 py-3"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything…"
                className="flex-1 rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
                style={{
                  borderColor: 'var(--border)',
                  color: 'var(--ink)',
                }}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={!input.trim() || loading}
                className="flex size-9 items-center justify-center rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
                style={{ background: 'var(--accent)', color: '#fff' }}
                aria-label="Send message"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
