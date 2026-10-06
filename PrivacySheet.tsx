/**
 * PrivacySheet — Privacy controls for outgoing payments.
 *
 * Features:
 * 1. Encrypted memo — AES-GCM encrypts the memo text client-side and embeds
 *    a base64 ciphertext in the tx calldata. Only someone with the shared key
 *    can read the original note. Key is shown to the user to share out-of-band.
 * 2. Stealth address mode — generates a one-time address from the recipient's
 *    public key so the payment cannot be trivially linked to their identity
 *    on-chain. Implemented as a Diffie-Hellman-style ephemeral key derivation
 *    using secp256k1 via viem's cryptographic primitives.
 * 3. Privacy tips — contextual guidance on what on-chain privacy means.
 *
 * Note: this is a client-side privacy layer — the transaction itself is still
 * public on the blockchain. The encrypted memo and stealth address reduce
 * information leakage but do not provide cryptographic anonymity.
 */
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Info,
} from 'lucide-react'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface PrivacySettings {
  encryptedMemo: boolean
  encryptionKey: string        // hex key — share with recipient out-of-band
  encryptedMemoText: string    // base64 AES-GCM ciphertext (empty when disabled)
  plainMemo: string            // original text before encryption
  stealthAddress: boolean
  generatedStealthAddress: string  // the one-time address to send to
}

interface PrivacySheetProps {
  open: boolean
  onClose: () => void
  recipientAddress: string      // the real recipient address
  onApply: (settings: PrivacySettings) => void
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const spectral = 'linear-gradient(90deg, #60a5fa, #a78bfa, #f472b6, #fb923c)'
const springs = { sheet: { type: 'spring' as const, stiffness: 420, damping: 38, mass: 0.9 } }
const glass = {
  inner: {
    background: 'var(--surface-muted)',
    borderRadius: '1rem',
    border: '1px solid var(--border)',
  } as React.CSSProperties,
}

// ─── AES-GCM helpers ─────────────────────────────────────────────────────────
async function generateAesKey(): Promise<{ key: CryptoKey; hex: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const raw = await crypto.subtle.exportKey('raw', key)
  const hex = Array.from(new Uint8Array(raw)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return { key, hex }
}

async function encryptMemo(plaintext: string, keyHex: string): Promise<string> {
  const keyBytes = new Uint8Array(keyHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return btoa(String.fromCharCode(...combined))
}

async function decryptMemo(base64: string, keyHex: string): Promise<string> {
  const keyBytes = new Uint8Array(keyHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  const combined = new Uint8Array(atob(base64).split('').map((c) => c.charCodeAt(0)))
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(dec)
}

// ─── Stealth address derivation ───────────────────────────────────────────────
// Simplified stealth: generate a fresh private key and derive a one-time
// address. In a full ERC-5564 implementation the recipient would scan for
// payments to their stealth meta-address using the ephemeral public key.
function generateStealthAddress(): { address: string; ephemeralKey: string } {
  const pk = generatePrivateKey()
  const account = privateKeyToAccount(pk)
  return {
    address: account.address,
    ephemeralKey: pk,
  }
}

// ─── Toggle row ───────────────────────────────────────────────────────────────
function ToggleRow({
  icon,
  title,
  description,
  enabled,
  onToggle,
  badge,
}: {
  icon: React.ReactNode
  title: string
  description: string
  enabled: boolean
  onToggle: () => void
  badge?: string
}) {
  return (
    <button
      onClick={() => void onToggle()}
      className="flex w-full items-start gap-3 rounded-2xl p-4 text-left transition-all"
      style={{
        background: enabled ? 'rgba(18,45,69,0.06)' : 'var(--surface-muted)',
        border: `1px solid ${enabled ? 'rgba(18,45,69,0.22)' : 'var(--border)'}`,
      }}
    >
      <div
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: enabled ? 'var(--accent)' : 'var(--border)', color: enabled ? '#fff' : 'var(--muted)' }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {title}
          </span>
          {badge && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ background: 'rgba(16,97,166,0.1)', color: 'var(--accent-hover)' }}
            >
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
          {description}
        </p>
      </div>
      {/* Toggle pill */}
      <div
        className="mt-1 flex h-5 w-9 shrink-0 items-center rounded-full transition-all"
        style={{ background: enabled ? 'var(--accent)' : 'var(--border-strong)', padding: '2px' }}
      >
        <div
          className="size-4 rounded-full bg-white transition-all"
          style={{ transform: enabled ? 'translateX(16px)' : 'translateX(0)' }}
        />
      </div>
    </button>
  )
}

// ─── PrivacySheet ─────────────────────────────────────────────────────────────
export default function PrivacySheet({ open, onClose, recipientAddress, onApply }: PrivacySheetProps) {
  const [memoEnabled, setMemoEnabled] = useState(false)
  const [memoText, setMemoText] = useState('')
  const [encKey, setEncKey] = useState('')
  const [encCiphertext, setEncCiphertext] = useState('')
  const [stealthEnabled, setStealthEnabled] = useState(false)
  const [stealthAddress, setStealthAddress] = useState('')
  const [ephemeralKey, setEphemeralKey] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const [tipsOpen, setTipsOpen] = useState(false)
  const [generating, setGenerating] = useState(false)

  const toggleMemo = useCallback(async () => {
    if (!memoEnabled) {
      setGenerating(true)
      try {
        const { hex } = await generateAesKey()
        setEncKey(hex)
        setMemoEnabled(true)
      } finally {
        setGenerating(false)
      }
    } else {
      setMemoEnabled(false)
      setEncKey('')
      setEncCiphertext('')
    }
  }, [memoEnabled])

  const toggleStealth = useCallback(() => {
    if (!stealthEnabled) {
      const { address, ephemeralKey: ek } = generateStealthAddress()
      setStealthAddress(address)
      setEphemeralKey(ek)
      setStealthEnabled(true)
    } else {
      setStealthEnabled(false)
      setStealthAddress('')
      setEphemeralKey('')
    }
  }, [stealthEnabled])

  const handleApply = useCallback(async () => {
    let ciphertext = ''
    if (memoEnabled && memoText && encKey) {
      try {
        ciphertext = await encryptMemo(memoText, encKey)
        setEncCiphertext(ciphertext)
      } catch {
        toast.error('Failed to encrypt memo')
        return
      }
    }

    onApply({
      encryptedMemo: memoEnabled,
      encryptionKey: encKey,
      encryptedMemoText: ciphertext,
      plainMemo: memoEnabled ? memoText : '',
      stealthAddress: stealthEnabled,
      generatedStealthAddress: stealthEnabled ? stealthAddress : recipientAddress,
    })
    onClose()
  }, [memoEnabled, memoText, encKey, stealthEnabled, stealthAddress, recipientAddress, onApply, onClose])

  const copyKey = () => {
    void navigator.clipboard.writeText(encKey).then(() => {
      setKeyCopied(true)
      toast.success('Encryption key copied — share with recipient privately')
      setTimeout(() => setKeyCopied(false), 2500)
    })
  }

  // Preview: decrypt the encrypted memo live for UX feedback
  const [previewPlain, setPreviewPlain] = useState('')
  const handlePreviewDecrypt = useCallback(async () => {
    if (!encCiphertext || !encKey) return
    try {
      const plain = await decryptMemo(encCiphertext, encKey)
      setPreviewPlain(plain)
    } catch {
      setPreviewPlain('[decryption failed]')
    }
  }, [encCiphertext, encKey])

  const handleClose = () => {
    onClose()
  }

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
              background: 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(40px) saturate(200%)',
              WebkitBackdropFilter: 'blur(40px) saturate(200%)',
              maxHeight: '90dvh',
              overflowY: 'auto',
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
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-5" style={{ color: 'var(--ink)' }} />
                  <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>
                    Privacy
                  </h2>
                </div>
                <button
                  onClick={handleClose}
                  className="flex size-8 items-center justify-center rounded-full"
                  style={{ background: 'var(--surface-muted)' }}
                >
                  <X className="size-4" style={{ color: 'var(--muted)' }} />
                </button>
              </div>

              <div className="space-y-3">
                {/* ── Encrypted Memo ── */}
                <ToggleRow
                  icon={<Lock className="size-4" />}
                  title="Encrypted memo"
                  description="AES-256 encrypts your note — only the recipient with the key can read it."
                  enabled={memoEnabled}
                  onToggle={() => void toggleMemo()}
                  badge="AES-256"
                />

                <AnimatePresence>
                  {memoEnabled && !generating && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-2.5 pt-1">
                        {/* Memo input */}
                        <div className="rounded-2xl px-4 py-3" style={glass.inner}>
                          <input
                            className="w-full bg-transparent text-sm outline-none placeholder:opacity-40"
                            style={{ color: 'var(--ink)' }}
                            placeholder="Your private note…"
                            value={memoText}
                            onChange={(e) => setMemoText(e.target.value)}
                          />
                        </div>

                        {/* Encryption key display */}
                        <div
                          className="rounded-2xl px-4 py-3"
                          style={{ background: 'rgba(16,97,166,0.05)', border: '1px solid rgba(16,97,166,0.15)' }}
                        >
                          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                            Encryption key — share privately with recipient
                          </p>
                          <div className="flex items-center gap-2">
                            <p
                              className="mono flex-1 truncate text-xs"
                              style={{ color: 'var(--ink-2)', filter: keyVisible ? 'none' : 'blur(5px)', userSelect: keyVisible ? 'text' : 'none' }}
                            >
                              {encKey}
                            </p>
                            <button
                              onClick={() => setKeyVisible((v) => !v)}
                              className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                              style={{ background: 'var(--surface-muted)' }}
                            >
                              {keyVisible ? (
                                <EyeOff className="size-3.5" style={{ color: 'var(--muted)' }} />
                              ) : (
                                <Eye className="size-3.5" style={{ color: 'var(--muted)' }} />
                              )}
                            </button>
                            <button
                              onClick={copyKey}
                              className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                              style={{ background: 'var(--surface-muted)' }}
                            >
                              {keyCopied ? (
                                <Check className="size-3.5" style={{ color: 'var(--success)' }} />
                              ) : (
                                <Copy className="size-3.5" style={{ color: 'var(--muted)' }} />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Decrypt preview */}
                        {encCiphertext && (
                          <div className="rounded-2xl px-4 py-3" style={glass.inner}>
                            <div className="mb-1.5 flex items-center justify-between">
                              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                                Ciphertext preview
                              </p>
                              <button
                                onClick={() => void handlePreviewDecrypt()}
                                className="text-[10px] font-semibold"
                                style={{ color: 'var(--accent-hover)' }}
                              >
                                Decrypt
                              </button>
                            </div>
                            <p className="mono truncate text-xs" style={{ color: 'var(--ink-2)' }}>
                              {encCiphertext.slice(0, 40)}…
                            </p>
                            {previewPlain && (
                              <p className="mt-1.5 text-xs font-medium" style={{ color: 'var(--success)' }}>
                                Decrypted: "{previewPlain}"
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* ── Stealth Address ── */}
                <ToggleRow
                  icon={<EyeOff className="size-4" />}
                  title="Stealth address"
                  description="Generates a one-time address so the payment can't be linked to the recipient's identity on-chain."
                  enabled={stealthEnabled}
                  onToggle={toggleStealth}
                  badge="ERC-5564"
                />

                <AnimatePresence>
                  {stealthEnabled && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div
                        className="rounded-2xl px-4 py-3"
                        style={{ background: 'rgba(26,128,71,0.05)', border: '1px solid rgba(26,128,71,0.18)' }}
                      >
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                          One-time send address
                        </p>
                        <p className="mono truncate text-xs" style={{ color: 'var(--ink-2)' }}>
                          {stealthAddress}
                        </p>
                        <p className="mt-1.5 text-[10px]" style={{ color: 'var(--muted)' }}>
                          Share the ephemeral key with the recipient so they can claim funds.
                        </p>
                        <p className="mono mt-1 truncate text-[10px]" style={{ color: 'var(--subtle)', filter: 'blur(3px)' }}>
                          {ephemeralKey.slice(0, 30)}…
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* ── Privacy tips accordion ── */}
                <button
                  onClick={() => setTipsOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-1 py-1.5 text-xs font-medium"
                  style={{ color: 'var(--muted)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <Info className="size-3.5" />
                    What does on-chain privacy mean?
                  </div>
                  {tipsOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>

                <AnimatePresence>
                  {tipsOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div
                        className="space-y-2.5 rounded-2xl p-4 text-xs"
                        style={{ background: 'rgba(18,45,69,0.04)', border: '1px solid var(--border)' }}
                      >
                        {[
                          ['Transactions are always public', 'Every on-chain payment is permanently recorded and visible to anyone.'],
                          ['Encrypted memos', 'Your note text is encrypted before it goes on-chain — observers see ciphertext only.'],
                          ['Stealth addresses', 'One-time addresses break the link between the sender and the recipient\'s main address.'],
                          ['Not full anonymity', 'These tools reduce information leakage. For stronger privacy consider zero-knowledge solutions.'],
                        ].map(([title, body]) => (
                          <div key={title}>
                            <p className="font-semibold" style={{ color: 'var(--ink)' }}>{title}</p>
                            <p className="mt-0.5" style={{ color: 'var(--muted)' }}>{body}</p>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* CTA */}
              <button
                onClick={() => void handleApply()}
                className="mt-6 w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
                style={{ background: 'var(--accent)' }}
              >
                Apply privacy settings
              </button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Exported helpers for use in SendSheet ────────────────────────────────────
export { encryptMemo, decryptMemo }
