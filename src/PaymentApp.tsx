import { useState, useCallback, useEffect, useRef } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { erc20Abi, isAddress } from 'viem'
import { ConnectKitButton } from 'connectkit'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  ExternalLink,
  Loader2,
  X,
  Check,
  ChevronRight,
  Zap,
  Link2,
  ArrowLeftRight,
  QrCode,
  ShieldCheck,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { Amount, usdcDecimalsFor, parseAmount } from '@/onchain-money'
import BridgeSheet from './BridgeSheet'
import QRScanSheet, { type QRResult } from './QRScanSheet'
import PrivacySheet, { type PrivacySettings } from './PrivacySheet'

const CHAIN_ID = 5042002
const USDC_FACT = getUsdc(CHAIN_ID)!
const USDC_ADDRESS = USDC_FACT.address as `0x${string}`
const ARCPAY_ADDRESS = '0xDa5f9cEb9eD17d7F7c633bC1Ebc6132fc10aB4c6' as `0x${string}`

const arcPayAbi = [
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'ref', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

interface TxRecord {
  hash: string
  direction: 'sent' | 'received'
  amount: string
  to: string
  from: string
  ts: number
}

const glass = {
  card: {
    background: 'var(--surface-strong)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid var(--border)',
    borderRadius: '1.5rem',
  } as React.CSSProperties,
  inner: {
    background: 'var(--surface-muted)',
    borderRadius: '1rem',
    border: '1px solid var(--border)',
  } as React.CSSProperties,
}

const spectral = 'linear-gradient(90deg, #60a5fa, #a78bfa, #f472b6, #fb923c)'

const springs = {
  sheet: { type: 'spring' as const, stiffness: 420, damping: 38, mass: 0.9 },
}

function formatAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function BalanceCard({ onSend, onRequest }: { onSend: () => void; onRequest: () => void }) {
  const { address, isConnected } = useAccount()

  const { data: rawBalance, isLoading } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(address) },
  })

  const formatted =
    rawBalance !== undefined
      ? Amount.fromRaw(rawBalance, usdcDecimalsFor(CHAIN_ID)).toFixed(2)
      : '0.00'

  return (
    <section style={glass.card} className="p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TokenUSDC variant="branded" size={20} />
          <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--muted)' }}>
            USDC Balance
          </span>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
          style={{ background: 'rgba(18,45,69,0.07)', color: 'var(--muted)' }}
        >
          Arc Testnet
        </span>
      </div>

      <div className="flex items-baseline gap-1.5 my-1">
        {isLoading ? (
          <span className="display text-5xl font-bold tabular-nums" style={{ color: 'var(--ink)', opacity: 0.25 }}>
            ···
          </span>
        ) : (
          <span className="display text-5xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
            {isConnected ? formatted : '—'}
          </span>
        )}
        <span className="text-xl font-semibold" style={{ color: 'var(--subtle)' }}>
          USDC
        </span>
      </div>

      {address && (
        <p className="mono mt-1 text-xs truncate" style={{ color: 'var(--subtle)' }}>
          {address}
        </p>
      )}

      <div className="mt-5 flex gap-3">
        <button
          onClick={onSend}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'var(--accent)' }}
        >
          <ArrowUpRight className="size-4" />
          Send
        </button>
        <button
          onClick={onRequest}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: 'var(--surface-muted)',
            border: '1px solid var(--border)',
            color: 'var(--ink)',
          }}
        >
          <ArrowDownLeft className="size-4" />
          Request
        </button>
      </div>
    </section>
  )
}

function SendSheet({
  open,
  onClose,
  onSuccess,
  initialTo = '',
  initialAmount = '',
}: {
  open: boolean
  onClose: () => void
  onSuccess: (record: TxRecord) => void
  initialTo?: string
  initialAmount?: string
}) {
  const { address, chainId: walletChainId, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()
  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  const {
    writeContract: writeApprove,
    data: approveHash,
    isPending: approvePending,
    error: approveError,
  } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({
    hash: approveHash,
  })

  const [to, setTo] = useState(initialTo)
  const [amount, setAmount] = useState(initialAmount)
  const [recorded, setRecorded] = useState(false)
  const paySent = useRef(false)

  const { data: rawBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(address) },
  })

  const formattedBalance =
    rawBalance !== undefined ? Amount.fromRaw(rawBalance, usdcDecimalsFor(CHAIN_ID)).toFixed(2) : '0.00'

  const isWrongChain = walletChainId !== CHAIN_ID
  const isValidAddr = isAddress(to)
  const isValidAmount = Boolean(amount && parseFloat(amount) > 0)
  const busy = isPending || isConfirming || approvePending || approveConfirming
  const canSend = isConnected && isValidAddr && isValidAmount && !busy && !isSuccess

  const handleSend = useCallback(() => {
    if (isWrongChain) {
      switchChain({ chainId: CHAIN_ID })
      return
    }
    if (!isValidAddr || !isValidAmount) return
    paySent.current = false
    const parsed = parseAmount(CHAIN_ID, amount)
    writeApprove({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [ARCPAY_ADDRESS, parsed.raw],
      chainId: CHAIN_ID,
    })
  }, [isWrongChain, isValidAddr, isValidAmount, amount, switchChain, writeApprove])

  useEffect(() => {
    if (!approveSuccess || !isValidAddr || !isValidAmount || paySent.current) return
    paySent.current = true
    const parsed = parseAmount(CHAIN_ID, amount)
    writeContract({
      address: ARCPAY_ADDRESS,
      abi: arcPayAbi,
      functionName: 'pay',
      args: [to as `0x${string}`, parsed.raw, `0x${'0'.repeat(64)}`],
      chainId: CHAIN_ID,
    })
  }, [approveSuccess, isValidAddr, isValidAmount, amount, to, writeContract])

  useEffect(() => {
    if (isSuccess && hash && !recorded) {
      setRecorded(true)
      onSuccess({
        hash,
        direction: 'sent' as const,
        amount,
        to,
        from: address ?? '',
        ts: Date.now(),
      })
    }
  }, [isSuccess, hash, recorded, onSuccess, amount, to, address])

  const handleClose = () => {
    if (busy) return
    setTo('')
    setAmount('')
    setRecorded(false)
    paySent.current = false
    onClose()
  }

  const presets = ['0.01', '0.10', '0.50', '1.00']
  const error = approveError || writeError

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <motion.section
            className="relative w-full max-w-md overflow-hidden rounded-t-3xl"
            style={{
              background: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(40px) saturate(200%)',
              WebkitBackdropFilter: 'blur(40px) saturate(200%)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={springs.sheet}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1" style={{ background: spectral }} />
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-black/10" />
            </div>

            <div className="px-5 pb-8 pt-2">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>
                  Send USDC
                </h2>
                <button
                  onClick={handleClose}
                  className="flex size-8 items-center justify-center rounded-full"
                  style={{ background: 'var(--surface-muted)' }}
                >
                  <X className="size-4" style={{ color: 'var(--muted)' }} />
                </button>
              </div>

              {isSuccess && hash ? (
                <div className="py-6 text-center">
                  <div
                    className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full"
                    style={{ background: 'rgba(26,128,71,0.12)' }}
                  >
                    <Check className="size-7" style={{ color: 'var(--success)' }} />
                  </div>
                  <p className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>
                    Sent {amount} USDC
                  </p>
                  <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                    to {formatAddr(to)}
                  </p>
                  <a
                    href={buildTxExplorerUrl(CHAIN_ID, hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium"
                    style={{ color: 'var(--accent-hover)' }}
                  >
                    View on ArcScan <ExternalLink className="size-3.5" />
                  </a>
                  <button
                    onClick={handleClose}
                    className="mt-5 block w-full rounded-2xl py-3.5 text-sm font-semibold text-white"
                    style={{ background: 'var(--accent)' }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                    Recipient address
                  </label>
                  <div className="mb-4 rounded-2xl px-4 py-3" style={glass.inner}>
                    <input
                      className="w-full bg-transparent text-sm outline-none placeholder:opacity-40"
                      style={{ color: 'var(--ink)', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem' }}
                      placeholder="0x..."
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      spellCheck={false}
                    />
                  </div>

                  <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                    Amount
                  </label>
                  <div className="mb-3 rounded-2xl px-4 py-3" style={glass.inner}>
                    <input
                      inputMode="decimal"
                      className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:opacity-25"
                      style={{ color: 'var(--ink)' }}
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, '')
                        if (v === '' || /^\d*\.?\d*$/.test(v)) setAmount(v)
                      }}
                    />
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
                        USDC
                      </span>
                      <button
                        className="text-xs font-semibold"
                        style={{ color: 'var(--accent-hover)' }}
                        onClick={() => setAmount(formattedBalance)}
                      >
                        Balance: {formattedBalance} · Max
                      </button>
                    </div>
                  </div>

                  <div className="mb-5 flex gap-2">
                    {presets.map((p) => (
                      <button
                        key={p}
                        onClick={() => setAmount(p)}
                        className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all hover:scale-105"
                        style={{
                          background: amount === p ? 'var(--accent)' : 'var(--surface-muted)',
                          color: amount === p ? '#fff' : 'var(--ink)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        ${p}
                      </button>
                    ))}
                  </div>

                  {error && (
                    <p className="mb-3 rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>
                      {error.message.includes('user rejected')
                        ? 'Transaction cancelled.'
                        : error.message.includes('insufficient')
                        ? 'Insufficient USDC balance.'
                        : 'Transaction failed. Please try again.'}
                    </p>
                  )}

                  <button
                    disabled={!canSend}
                    onClick={handleSend}
                    className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: 'var(--accent)' }}
                  >
                    {!isConnected ? (
                      'Connect Wallet'
                    ) : isWrongChain ? (
                      'Switch to Arc Testnet'
                    ) : approvePending ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="size-4 animate-spin" /> Approve in wallet…
                      </span>
                    ) : approveConfirming ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="size-4 animate-spin" /> Approving USDC…
                      </span>
                    ) : isPending ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="size-4 animate-spin" /> Confirm pay in wallet…
                      </span>
                    ) : isConfirming ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="size-4 animate-spin" /> Confirming…
                      </span>
                    ) : (
                      'Send USDC'
                    )}
                  </button>
                </>
              )}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function RequestSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useAccount()
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [copied, setCopied] = useState(false)

  const link =
    address && amount
      ? `${window.location.origin}?to=${address}&amount=${amount}${memo ? `&memo=${encodeURIComponent(memo)}` : ''}`
      : ''

  const handleCopy = () => {
    if (!link) return
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      toast.success('Payment link copied!')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const presets = ['1.00', '5.00', '10.00', '25.00']

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <motion.section
            className="relative w-full max-w-md overflow-hidden rounded-t-3xl"
            style={{
              background: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(40px) saturate(200%)',
              WebkitBackdropFilter: 'blur(40px) saturate(200%)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={springs.sheet}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1" style={{ background: spectral }} />
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-black/10" />
            </div>

            <div className="px-5 pb-8 pt-2">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>
                  Request Payment
                </h2>
                <button
                  onClick={onClose}
                  className="flex size-8 items-center justify-center rounded-full"
                  style={{ background: 'var(--surface-muted)' }}
                >
                  <X className="size-4" style={{ color: 'var(--muted)' }} />
                </button>
              </div>

              <div className="mb-4 rounded-2xl px-4 py-4" style={glass.inner}>
                <input
                  inputMode="decimal"
                  className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:opacity-25"
                  style={{ color: 'var(--ink)' }}
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, '')
                    if (v === '' || /^\d*\.?\d*$/.test(v)) setAmount(v)
                  }}
                />
                <span className="mt-1 block text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
                  USDC
                </span>
              </div>

              <div className="mb-4 flex gap-2">
                {presets.map((p) => (
                  <button
                    key={p}
                    onClick={() => setAmount(p)}
                    className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all hover:scale-105"
                    style={{
                      background: amount === p ? 'var(--accent)' : 'var(--surface-muted)',
                      color: amount === p ? '#fff' : 'var(--ink)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    ${p}
                  </button>
                ))}
              </div>

              <div className="mb-5 rounded-2xl px-4 py-3" style={glass.inner}>
                <input
                  className="w-full bg-transparent text-sm outline-none placeholder:opacity-40"
                  style={{ color: 'var(--ink)' }}
                  placeholder="Memo (optional)"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </div>

              {link && (
                <div className="mb-4 rounded-2xl px-4 py-3" style={{ ...glass.inner, border: '1px dashed var(--border-strong)' }}>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                    Payment link
                  </p>
                  <p className="mono truncate text-xs" style={{ color: 'var(--ink-2)' }}>
                    {link}
                  </p>
                </div>
              )}

              <button
                disabled={!link}
                onClick={handleCopy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'var(--accent)' }}
              >
                {copied ? (
                  <>
                    <Check className="size-4" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="size-4" /> Copy Payment Link
                  </>
                )}
              </button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PrefillBanner({ onPay, onDismiss }: { onPay: (to: string, amount: string, memo?: string) => void; onDismiss: () => void }) {
  const params = new URLSearchParams(window.location.search)
  const to = params.get('to') ?? ''
  const amount = params.get('amount') ?? ''
  const memo = params.get('memo') ?? ''

  if (!to || !amount) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 mb-4"
      style={{ background: 'rgba(16,97,166,0.07)', border: '1px solid rgba(16,97,166,0.18)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-xs font-semibold" style={{ color: 'var(--accent-hover)' }}>
            Payment Request
          </p>
          <p className="mt-0.5 text-sm font-medium" style={{ color: 'var(--ink)' }}>
            {amount} USDC to {formatAddr(to)}
          </p>
          {memo && (
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              {memo}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onPay(to, amount, memo || undefined)}
            className="rounded-xl px-3 py-1.5 text-xs font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            Pay
          </button>
          <button
            onClick={onDismiss}
            className="flex size-7 items-center justify-center rounded-full"
            style={{ background: 'var(--surface-muted)' }}
          >
            <X className="size-3.5" style={{ color: 'var(--muted)' }} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function ActivityList({ txs }: { txs: TxRecord[] }) {
  if (txs.length === 0) return null

  return (
    <section style={glass.card} className="p-5 shadow-sm">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
        Recent Activity
      </h3>
      <div className="space-y-3">
        {txs.map((tx) => (
          <div key={tx.hash} className="flex items-center gap-3">
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-2xl"
              style={{
                background: tx.direction === 'sent' ? 'rgba(18,45,69,0.08)' : 'rgba(26,128,71,0.1)',
              }}
            >
              {tx.direction === 'sent' ? (
                <ArrowUpRight className="size-4" style={{ color: 'var(--accent)' }} />
              ) : (
                <ArrowDownLeft className="size-4" style={{ color: 'var(--success)' }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                {tx.direction === 'sent' ? 'Sent' : 'Received'} {tx.amount} USDC
              </p>
              <p className="mono truncate text-[11px]" style={{ color: 'var(--subtle)' }}>
                {tx.direction === 'sent' ? `to ${formatAddr(tx.to)}` : `from ${formatAddr(tx.from)}`}
              </p>
            </div>
            <a
              href={buildTxExplorerUrl(CHAIN_ID, tx.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex size-7 shrink-0 items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ background: 'var(--surface-muted)' }}
            >
              <ExternalLink className="size-3.5" style={{ color: 'var(--subtle)' }} />
            </a>
          </div>
        ))}
      </div>
    </section>
  )
}

function InfoCard() {
  const rows = [
    { icon: <Zap className="size-3.5" style={{ color: 'var(--accent-hover)' }} />, label: 'Sub-second finality' },
    { icon: <TokenUSDC variant="branded" size={14} />, label: 'USDC is the native gas token' },
    { icon: <Link2 className="size-3.5" style={{ color: 'var(--accent-hover)' }} />, label: 'EVM-compatible' },
  ]

  return (
    <section
      className="rounded-2xl px-4 py-3.5"
      style={{ background: 'rgba(18,45,69,0.04)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          About Arc Testnet
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            {r.icon}
            <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
              {r.label}
            </span>
          </div>
        ))}
      </div>
      <a
        href="https://explorer.testnet.arc.io"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex items-center gap-1.5 text-xs font-medium"
        style={{ color: 'var(--accent-hover)' }}
      >
        Open ArcScan <ChevronRight className="size-3" />
      </a>
    </section>
  )
}

export default function PaymentApp() {
  const { isConnected, address } = useAccount()
  const [txs, setTxs] = useState<TxRecord[]>([])
  const [prefillDismissed, setPrefillDismissed] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [prefillTo, setPrefillTo] = useState('')
  const [prefillAmount, setPrefillAmount] = useState('')
  const [requestOpen, setRequestOpen] = useState(false)
  const [bridgeOpen, setBridgeOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [pendingPrivacy, setPendingPrivacy] = useState<PrivacySettings | null>(null)

  const openSend = () => {
    setPrefillTo('')
    setPrefillAmount('')
    setSendOpen(true)
  }
  const openRequest = () => setRequestOpen(true)

  const handlePrefillPay = (to: string, amount: string) => {
    setPrefillTo(to)
    setPrefillAmount(amount)
    setSendOpen(true)
    setPrefillDismissed(true)
  }

  const handleQRResult = (result: QRResult) => {
    setPrefillTo(result.to)
    setPrefillAmount(result.amount ?? '')
    setSendOpen(true)
  }

  const handlePrivacyApply = (settings: PrivacySettings) => {
    setPendingPrivacy(settings)
    if (settings.stealthAddress && settings.generatedStealthAddress) {
      setPrefillTo(settings.generatedStealthAddress)
    }
    toast.success('Privacy settings applied', {
      description: [
        settings.encryptedMemo ? 'Memo encrypted' : '',
        settings.stealthAddress ? 'Stealth address active' : '',
      ].filter(Boolean).join(' · '),
    })
    setSendOpen(true)
  }

  const handleTxSuccess = (record: TxRecord) => {
    setTxs((prev) => [record, ...prev])
    setPendingPrivacy(null)
    toast.success(`Sent ${record.amount} USDC`, {
      description: `to ${formatAddr(record.to)}`,
    })
  }

  const toolbarItems = [
    { icon: <ArrowLeftRight className="size-5" />, label: 'Bridge', action: () => setBridgeOpen(true) },
    { icon: <QrCode className="size-5" />, label: 'Scan QR', action: () => setQrOpen(true) },
    { icon: <ShieldCheck className="size-5" />, label: 'Privacy', action: () => setPrivacyOpen(true) },
  ]

  return (
    <div className="min-h-dvh pb-28" style={{ background: 'var(--bg-gradient)' }}>
      <header
        className="sticky top-0 z-40 mx-auto flex max-w-md items-center justify-between px-4 py-3"
        style={{
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex size-8 items-center justify-center rounded-xl"
            style={{ background: 'var(--accent)' }}
          >
            <TokenUSDC variant="mono" size={18} />
          </div>
          <span className="display text-base font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            Arc Pay
          </span>
        </div>
        <ConnectKitButton />
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 py-6">
        {!prefillDismissed && (
          <PrefillBanner
            onPay={handlePrefillPay}
            onDismiss={() => setPrefillDismissed(true)}
          />
        )}

        {pendingPrivacy && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between rounded-2xl px-4 py-3"
            style={{ background: 'rgba(18,45,69,0.06)', border: '1px solid rgba(18,45,69,0.18)' }}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4" style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                Privacy active
              </span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {[pendingPrivacy.encryptedMemo && 'Enc. memo', pendingPrivacy.stealthAddress && 'Stealth addr'].filter(Boolean).join(' · ')}
              </span>
            </div>
            <button onClick={() => setPendingPrivacy(null)}>
              <X className="size-3.5" style={{ color: 'var(--muted)' }} />
            </button>
          </motion.div>
        )}

        <BalanceCard onSend={openSend} onRequest={openRequest} />

        {!isConnected && (
          <div
            className="rounded-2xl p-5 text-center"
            style={{ background: 'rgba(18,45,69,0.04)', border: '1px dashed var(--border-strong)' }}
          >
            <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
              Connect your wallet to send and receive USDC on Arc Testnet.
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
              Need testnet USDC? Use the "Get test USDC" button in the sidebar.
            </p>
          </div>
        )}

        <ActivityList txs={txs} />
        <InfoCard />
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center">
        <div
          className="mx-4 mb-4 flex w-full max-w-md items-center justify-around rounded-3xl px-2 py-3"
          style={{
            background: 'rgba(255,255,255,0.88)',
            backdropFilter: 'blur(24px) saturate(200%)',
            WebkitBackdropFilter: 'blur(24px) saturate(200%)',
            border: '1px solid var(--border)',
            boxShadow: '0 8px 32px rgba(18,45,69,0.10)',
          }}
        >
          {toolbarItems.map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              className="flex flex-col items-center gap-1 rounded-2xl px-5 py-2 transition-all hover:scale-105 active:scale-95"
              style={{ color: 'var(--ink-2)', minWidth: 64 }}
            >
              {item.icon}
              <span className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <SendSheet
        key={`${prefillTo}-${prefillAmount}`}
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        onSuccess={handleTxSuccess}
        initialTo={pendingPrivacy?.stealthAddress ? pendingPrivacy.generatedStealthAddress : prefillTo}
        initialAmount={prefillAmount}
      />
      <RequestSheet open={requestOpen} onClose={() => setRequestOpen(false)} />
      <BridgeSheet open={bridgeOpen} onClose={() => setBridgeOpen(false)} />
      <QRScanSheet open={qrOpen} onClose={() => setQrOpen(false)} onResult={handleQRResult} />
      <PrivacySheet
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
        recipientAddress={address ?? ''}
        onApply={handlePrivacyApply}
      />
    </div>
  )
}
