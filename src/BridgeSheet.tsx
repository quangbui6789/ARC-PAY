/**
 * BridgeSheet — CCTP bridge using Circle App Kit + wagmi viem-v2 adapter.
 * Supports Arc Testnet ↔ Base Sepolia ↔ ETH Sepolia (all testnet).
 */
import { useState, useCallback } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { AppKit } from '@circle-fin/app-kit'
import type { EIP1193Provider } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeftRight,
  ChevronDown,
  ExternalLink,
  Loader2,
  X,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { TESTNET_ONCHAIN_CHAINS } from '@/onchain-facts'

// Subset of accepted BridgeChainIdentifier string literals used in this app
type AppKitChain = 'Arc_Testnet' | 'Base_Sepolia' | 'Ethereum_Sepolia'

// ─── App Kit singleton ────────────────────────────────────────────────────────
const appKit = new AppKit()

// ─── Supported bridge chains ─────────────────────────────────────────────────
const BRIDGE_CHAINS = TESTNET_ONCHAIN_CHAINS.filter((c) =>
  ['Arc Testnet', 'Base Sepolia', 'Ethereum Sepolia'].includes(c.name),
)

// Map from chainId to App Kit chain string name
const CHAIN_NAME_MAP: Record<number, AppKitChain> = {
  5042002: 'Arc_Testnet',
  84532: 'Base_Sepolia',
  11155111: 'Ethereum_Sepolia',
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const glass = {
  inner: {
    background: 'var(--surface-muted)',
    borderRadius: '1rem',
    border: '1px solid var(--border)',
  } as React.CSSProperties,
}

const spectral = 'linear-gradient(90deg, #60a5fa, #a78bfa, #f472b6, #fb923c)'
const springs = { sheet: { type: 'spring' as const, stiffness: 420, damping: 38, mass: 0.9 } }

// ─── Step state display ───────────────────────────────────────────────────────
type StepName = 'approve' | 'burn' | 'fetchAttestation' | 'mint'
type StepState = 'idle' | 'pending' | 'success' | 'error'

interface StepInfo {
  name: StepName
  label: string
  state: StepState
  txHash?: string
  explorerUrl?: string
}

const STEP_LABELS: Record<StepName, string> = {
  approve: 'Approve USDC',
  burn: 'Burn on source chain',
  fetchAttestation: 'Fetching attestation',
  mint: 'Mint on destination',
}

function StepRow({ step }: { step: StepInfo }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-full"
        style={{
          background:
            step.state === 'success'
              ? 'rgba(26,128,71,0.12)'
              : step.state === 'pending'
              ? 'rgba(18,45,69,0.08)'
              : step.state === 'error'
              ? 'rgba(186,43,76,0.10)'
              : 'var(--surface-muted)',
        }}
      >
        {step.state === 'success' && <Check className="size-3.5" style={{ color: 'var(--success)' }} />}
        {step.state === 'pending' && <Loader2 className="size-3.5 animate-spin" style={{ color: 'var(--accent)' }} />}
        {step.state === 'error' && <X className="size-3.5" style={{ color: 'var(--danger)' }} />}
        {step.state === 'idle' && <div className="size-1.5 rounded-full" style={{ background: 'var(--border-strong)' }} />}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium" style={{ color: step.state === 'idle' ? 'var(--subtle)' : 'var(--ink)' }}>
          {step.label}
        </p>
      </div>
      {step.explorerUrl && (
        <a href={step.explorerUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-3.5" style={{ color: 'var(--accent-hover)' }} />
        </a>
      )}
    </div>
  )
}

// ─── ChainSelector ────────────────────────────────────────────────────────────
function ChainSelector({
  label,
  chainId,
  onChange,
  disabledId,
}: {
  label: string
  chainId: number
  onChange: (id: number) => void
  disabledId?: number
}) {
  const [open, setOpen] = useState(false)
  const selected = BRIDGE_CHAINS.find((c) => c.chainId === chainId)

  return (
    <div className="relative">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
        {label}
      </p>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium transition-all hover:scale-[1.01]"
        style={glass.inner}
      >
        <div className="flex items-center gap-2">
          <TokenUSDC variant="branded" size={16} />
          <span style={{ color: 'var(--ink)' }}>{selected?.name ?? 'Select chain'}</span>
        </div>
        <ChevronDown className="size-4" style={{ color: 'var(--subtle)' }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-full z-10 mt-1.5 overflow-hidden rounded-2xl py-1 shadow-lg"
            style={{ background: 'rgba(255,255,255,0.96)', border: '1px solid var(--border)' }}
          >
            {BRIDGE_CHAINS.map((c) => (
              <button
                key={c.chainId}
                disabled={c.chainId === disabledId}
                onClick={() => {
                  onChange(c.chainId)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40"
                style={{
                  color: c.chainId === chainId ? 'var(--accent-hover)' : 'var(--ink)',
                  background: c.chainId === chainId ? 'rgba(16,97,166,0.06)' : 'transparent',
                }}
              >
                <TokenUSDC variant="branded" size={14} />
                {c.name}
                {c.chainId === chainId && <Check className="ml-auto size-3.5" style={{ color: 'var(--accent-hover)' }} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── BridgeSheet ──────────────────────────────────────────────────────────────
export default function BridgeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address, connector, chainId: walletChainId, isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()

  const [fromChainId, setFromChainId] = useState(5042002)
  const [toChainId, setToChainId] = useState(84532)
  const [amount, setAmount] = useState('')

  const [bridging, setBridging] = useState(false)
  const [bridgeDone, setBridgeDone] = useState(false)
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [steps, setSteps] = useState<StepInfo[]>([])

  const resetState = useCallback(() => {
    setBridging(false)
    setBridgeDone(false)
    setBridgeError(null)
    setSteps([])
    setAmount('')
  }, [])

  const handleClose = () => {
    if (bridging) return
    resetState()
    onClose()
  }

  const swap = () => {
    setFromChainId(toChainId)
    setToChainId(fromChainId)
  }

  const canBridge = isConnected && Boolean(amount && parseFloat(amount) > 0) && !bridging

  const handleBridge = useCallback(async () => {
    if (!connector || !address || !amount) return
    const fromChainName = CHAIN_NAME_MAP[fromChainId]
    const toChainName = CHAIN_NAME_MAP[toChainId]
    if (!fromChainName || !toChainName) return

    setBridging(true)
    setBridgeError(null)
    setBridgeDone(false)

    const initialSteps: StepInfo[] = (
      ['approve', 'burn', 'fetchAttestation', 'mint'] as StepName[]
    ).map((name) => ({ name, label: STEP_LABELS[name], state: 'idle' }))
    setSteps(initialSteps)

    try {
      if (walletChainId !== fromChainId) {
        await switchChainAsync({ chainId: fromChainId })
      }

      const provider = (await connector.getProvider()) as EIP1193Provider
      const adapter = await createViemAdapterFromProvider({ provider })

      // Listen for step events via poll on result
      const result = await appKit.bridge({
        from: { adapter, chain: fromChainName },
        to: { adapter, chain: toChainName },
        amount,
      })

      // Map result.steps to our display state
      if (result.steps) {
        setSteps(
          (['approve', 'burn', 'fetchAttestation', 'mint'] as StepName[]).map((name) => {
            const s = result.steps?.find((st: { name: string }) => st.name === name)
            return {
              name,
              label: STEP_LABELS[name],
              state: s ? (s.state === 'success' ? 'success' : s.state === 'error' ? 'error' : 'idle') : 'idle',
              txHash: (s as { txHash?: string } | undefined)?.txHash,
              explorerUrl: (s as { explorerUrl?: string } | undefined)?.explorerUrl,
            }
          }),
        )
      }

      if (result.state === 'success') {
        setBridgeDone(true)
      } else {
        setBridgeError('Bridge completed with status: ' + result.state)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bridge failed'
      setBridgeError(
        msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('rejected')
          ? 'Transaction cancelled.'
          : msg.includes('insufficient')
          ? 'Insufficient USDC balance.'
          : 'Bridge failed. Please try again.',
      )
      setSteps((prev) =>
        prev.map((s) => (s.state === 'pending' ? { ...s, state: 'error' } : s)),
      )
    } finally {
      setBridging(false)
    }
  }, [connector, address, amount, fromChainId, toChainId, walletChainId, switchChainAsync])

  const fromChain = BRIDGE_CHAINS.find((c) => c.chainId === fromChainId)
  const toChain = BRIDGE_CHAINS.find((c) => c.chainId === toChainId)
  const presets = ['0.10', '1.00', '5.00', '10.00']

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
              {/* header */}
              <div className="mb-5 flex items-center justify-between">
                <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>
                  Bridge USDC
                </h2>
                <button
                  onClick={handleClose}
                  className="flex size-8 items-center justify-center rounded-full"
                  style={{ background: 'var(--surface-muted)' }}
                >
                  <X className="size-4" style={{ color: 'var(--muted)' }} />
                </button>
              </div>

              {bridgeDone ? (
                /* ── Success state ── */
                <div className="py-4 text-center">
                  <div
                    className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full"
                    style={{ background: 'rgba(26,128,71,0.12)' }}
                  >
                    <Check className="size-7" style={{ color: 'var(--success)' }} />
                  </div>
                  <p className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>
                    Bridge complete
                  </p>
                  <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                    {amount} USDC · {fromChain?.name} → {toChain?.name}
                  </p>
                  <div className="mt-5 divide-y" style={{ borderColor: 'var(--border)' }}>
                    {steps.map((s) => (
                      <StepRow key={s.name} step={s} />
                    ))}
                  </div>
                  <button
                    onClick={handleClose}
                    className="mt-6 block w-full rounded-2xl py-3.5 text-sm font-semibold text-white"
                    style={{ background: 'var(--accent)' }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  {/* ── Chain selectors ── */}
                  <div className="mb-4 space-y-3">
                    <ChainSelector
                      label="From"
                      chainId={fromChainId}
                      onChange={setFromChainId}
                      disabledId={toChainId}
                    />

                    <div className="flex justify-center">
                      <button
                        onClick={swap}
                        disabled={bridging}
                        className="flex size-8 items-center justify-center rounded-full border transition-all hover:scale-110 disabled:opacity-40"
                        style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }}
                      >
                        <ArrowLeftRight className="size-3.5" style={{ color: 'var(--muted)' }} />
                      </button>
                    </div>

                    <ChainSelector
                      label="To"
                      chainId={toChainId}
                      onChange={setToChainId}
                      disabledId={fromChainId}
                    />
                  </div>

                  {/* ── Amount ── */}
                  <div className="mb-3 rounded-2xl px-4 py-3" style={glass.inner}>
                    <input
                      inputMode="decimal"
                      className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:opacity-25"
                      style={{ color: 'var(--ink)' }}
                      placeholder="0.00"
                      value={amount}
                      disabled={bridging}
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
                        disabled={bridging}
                        onClick={() => setAmount(p)}
                        className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all hover:scale-105 disabled:opacity-40"
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

                  {/* ── In-flight steps ── */}
                  {bridging && steps.length > 0 && (
                    <div
                      className="mb-4 divide-y rounded-2xl px-4"
                      style={{ borderColor: 'var(--border)', ...glass.inner }}
                    >
                      {steps.map((s) => (
                        <StepRow key={s.name} step={s} />
                      ))}
                    </div>
                  )}

                  {/* ── Info row ── */}
                  {!bridging && (
                    <div className="mb-4 flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: 'rgba(18,45,69,0.04)' }}>
                      <AlertTriangle className="size-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>
                        CCTP fast bridge (~8–20s). Testnet only — no real funds.
                      </p>
                    </div>
                  )}

                  {/* ── Error ── */}
                  {bridgeError && (
                    <p
                      className="mb-3 rounded-xl px-3 py-2 text-xs"
                      style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}
                    >
                      {bridgeError}
                    </p>
                  )}

                  {/* ── CTA ── */}
                  <button
                    disabled={!canBridge}
                    onClick={() => void handleBridge()}
                    className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: 'var(--accent)' }}
                  >
                    {!isConnected ? (
                      'Connect Wallet'
                    ) : bridging ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="size-4 animate-spin" /> Bridging…
                      </span>
                    ) : (
                      'Bridge USDC'
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
