/**
 * QRScanSheet — Camera-based QR code scanner for payment links and addresses.
 * Uses jsQR for pure-JS decoding with the device camera via getUserMedia.
 * On success it extracts ?to=, ?amount=, ?memo= from a URL, or treats a raw
 * 0x address as the recipient.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import jsQR from 'jsqr'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Camera, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import { isAddress } from 'viem'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface QRResult {
  to: string
  amount?: string
  memo?: string
}

interface QRScanSheetProps {
  open: boolean
  onClose: () => void
  onResult: (result: QRResult) => void
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const spectral = 'linear-gradient(90deg, #60a5fa, #a78bfa, #f472b6, #fb923c)'
const springs = { sheet: { type: 'spring' as const, stiffness: 420, damping: 38, mass: 0.9 } }

// ─── QR parsing ───────────────────────────────────────────────────────────────
function parseQRText(text: string): QRResult | null {
  const trimmed = text.trim()

  // Plain EVM address
  if (isAddress(trimmed)) {
    return { to: trimmed }
  }

  // Payment URL with ?to=&amount=&memo= (our app's format or ethereum: URI)
  try {
    // Handle ethereum:0x... URIs
    if (trimmed.startsWith('ethereum:')) {
      const addr = trimmed.replace('ethereum:', '').split('?')[0]
      if (isAddress(addr)) {
        const params = new URLSearchParams(trimmed.split('?')[1] ?? '')
        return {
          to: addr,
          amount: params.get('amount') ?? params.get('value') ?? undefined,
          memo: params.get('memo') ?? undefined,
        }
      }
    }

    // Regular URL
    const url = new URL(trimmed)
    const to = url.searchParams.get('to') ?? ''
    if (isAddress(to)) {
      return {
        to,
        amount: url.searchParams.get('amount') ?? undefined,
        memo: url.searchParams.get('memo') ?? undefined,
      }
    }
  } catch {
    // not a URL
  }

  return null
}

// ─── Scanner component ────────────────────────────────────────────────────────
function Scanner({ onDetect }: { onDetect: (result: QRResult) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  const [error, setError] = useState<string | null>(null)
  // Use a ref for scanning flag so the tick loop sees the latest value without re-creating it
  const scanningRef = useRef(true)
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect

  useEffect(() => {
    let active = true
    scanningRef.current = true

    // Named recursive function avoids the self-reference-during-init lint error
    function tick() {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || !scanningRef.current || !active) return

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) { rafRef.current = requestAnimationFrame(tick); return }
        ctx.drawImage(video, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        })
        if (code) {
          const result = parseQRText(code.data)
          if (result) {
            scanningRef.current = false
            onDetectRef.current(result)
            return
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (!active) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch (err) {
        if (!active) return
        const e = err instanceof Error ? err : new Error('Camera error')
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
          setError('Camera permission denied. Allow camera access and try again.')
        } else if (e.name === 'NotFoundError') {
          setError('No camera found on this device.')
        } else {
          setError('Could not access camera. ' + e.message)
        }
      }
    }

    void startCamera()

    return () => {
      active = false
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <AlertTriangle className="size-8" style={{ color: 'var(--danger)' }} />
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {error}
        </p>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '1' }}>
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        muted
        playsInline
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Scanner crosshair overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative"
          style={{ width: '60%', aspectRatio: '1' }}
        >
          {/* Corners */}
          {[
            'top-0 left-0 border-t-2 border-l-2 rounded-tl-lg',
            'top-0 right-0 border-t-2 border-r-2 rounded-tr-lg',
            'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
            'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg',
          ].map((cls, i) => (
            <div
              key={i}
              className={`absolute h-6 w-6 ${cls}`}
              style={{ borderColor: 'rgba(255,255,255,0.85)' }}
            />
          ))}

          {/* Scan line animation */}
          <motion.div
            className="absolute left-0 right-0 h-0.5"
            style={{ background: 'rgba(255,255,255,0.7)' }}
            animate={{ top: ['10%', '90%', '10%'] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      </div>

      <p
        className="absolute bottom-3 left-0 right-0 text-center text-xs font-medium"
        style={{ color: 'rgba(255,255,255,0.8)' }}
      >
        Point at a QR code or payment link
      </p>
    </div>
  )
}

// ─── QRScanSheet ──────────────────────────────────────────────────────────────
export default function QRScanSheet({ open, onClose, onResult }: QRScanSheetProps) {
  const [detected, setDetected] = useState<QRResult | null>(null)
  const [scanKey, setScanKey] = useState(0)

  const handleDetect = useCallback((result: QRResult) => {
    setDetected(result)
  }, [])

  const handleConfirm = () => {
    if (!detected) return
    onResult(detected)
    onClose()
    setDetected(null)
    setScanKey((k) => k + 1)
  }

  const handleClose = () => {
    setDetected(null)
    setScanKey((k) => k + 1)
    onClose()
  }

  const handleRetry = () => {
    setDetected(null)
    setScanKey((k) => k + 1)
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
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <motion.section
            className="relative w-full max-w-md overflow-hidden rounded-t-3xl"
            style={{
              background: 'rgba(255,255,255,0.95)',
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
                <div className="flex items-center gap-2">
                  <Camera className="size-5" style={{ color: 'var(--ink)' }} />
                  <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>
                    Scan QR
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

              {detected ? (
                /* ── Detected result ── */
                <div>
                  <div
                    className="mb-4 flex items-start gap-3 rounded-2xl p-4"
                    style={{ background: 'rgba(26,128,71,0.07)', border: '1px solid rgba(26,128,71,0.18)' }}
                  >
                    <Check className="mt-0.5 size-5 shrink-0" style={{ color: 'var(--success)' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
                        QR code detected
                      </p>
                      <p className="mono mt-1 truncate text-xs" style={{ color: 'var(--ink-2)' }}>
                        {detected.to}
                      </p>
                      {detected.amount && (
                        <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
                          Amount: {detected.amount} USDC
                        </p>
                      )}
                      {detected.memo && (
                        <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
                          Memo: {detected.memo}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleRetry}
                      className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01]"
                      style={{
                        background: 'var(--surface-muted)',
                        border: '1px solid var(--border)',
                        color: 'var(--ink)',
                      }}
                    >
                      <RefreshCw className="size-4" /> Scan again
                    </button>
                    <button
                      onClick={handleConfirm}
                      className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01]"
                      style={{ background: 'var(--accent)' }}
                    >
                      <Check className="size-4" /> Pay this
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Scanner view ── */
                <Scanner key={scanKey} onDetect={handleDetect} />
              )}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
