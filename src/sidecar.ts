// sidecar.ts — the libp2p INGRESS sidecar.
//
// Makes ANY local HTTP vessel (e.g. an Obsidian plugin serving /resolve on
// 127.0.0.1:27182) reachable over the substrate's Circuit Relay v2 overlay and
// registered with a discovery-vessel — WITHOUT the vessel itself carrying any
// libp2p dependency. This is the mirror of the egress front door: the transport
// lives in the sidecar, the vessel stays a plain HTTP server.
//
// Flow: bring up a libp2p node (deterministic identity from vesselId) → dial the
// relay, hold a reservation → serve resolves over libp2p-HTTP, proxying each
// pointer to LOCAL_RESOLVE_URL → register with discovery advertising
// protocol:"libp2p" + peer_id + circuit multiaddr + FED_SHAPES → heartbeat.
//
// Env:
//   FED_VESSEL_ID       stable vessel id (seeds the libp2p identity + peerId)   [required]
//   RELAY_MULTIADDR     the substrate relay's public multiaddr  [optional: derived from DISCOVERY_URL /bootstrap]
//   DISCOVERY_URL       discovery-vessel base URL to register with             [required]
//   LOCAL_RESOLVE_URL   the local vessel's resolve endpoint to proxy to        [required]
//   FED_SHAPES          comma-separated shapes to advertise                    [required]
//   METABOB_API_KEY     ApiKey to authenticate the discovery registration      [required for auth'd discovery]
//   FED_HEALTH_PORT     plain-HTTP /health port for liveness (default 8402)
//   FED_VESSEL_NAME     display name (default = FED_VESSEL_ID)
//   FED_SYSTEM_VESSEL   "1" to register systemVessel:true (global visibility)  [default off]
//   FED_RESOLVE_TIMEOUT_MS  proxy fetch timeout (default 10000)
import { createVesselLibp2p, serveResolveHttp, type VesselLibp2p } from './index.ts'

const VESSEL_ID = process.env.FED_VESSEL_ID || ''
const VESSEL_NAME = process.env.FED_VESSEL_NAME || VESSEL_ID
let RELAY = process.env.RELAY_MULTIADDR || ''
const DISCOVERY = (process.env.DISCOVERY_URL || '').replace(/\/+$/, '')
const LOCAL_RESOLVE_URL = process.env.LOCAL_RESOLVE_URL || ''
const SHAPES = (process.env.FED_SHAPES || '').split(',').map((s) => s.trim()).filter(Boolean)
const API_KEY = process.env.METABOB_API_KEY || ''
const HEALTH_PORT = parseInt(process.env.FED_HEALTH_PORT || '8402', 10)
const SYSTEM_VESSEL = process.env.FED_SYSTEM_VESSEL === '1'
const RESOLVE_TIMEOUT_MS = parseInt(process.env.FED_RESOLVE_TIMEOUT_MS || '10000', 10)

function die(msg: string): never { console.error('[fed-sidecar] ERROR:', msg); process.exit(1) }
if (!VESSEL_ID) die('set FED_VESSEL_ID')
if (!DISCOVERY) die('set DISCOVERY_URL')
if (!LOCAL_RESOLVE_URL) die('set LOCAL_RESOLVE_URL (the local vessel /resolve to proxy to)')
if (SHAPES.length === 0) die('set FED_SHAPES (comma-separated shapes to advertise)')

// Point-and-go: with no explicit RELAY_MULTIADDR, read the relay anchor from the
// discovery vessel's public GET /bootstrap and PREFER the p2p overlay, so the whole
// federation config is {DISCOVERY_URL, METABOB_API_KEY} and the relay is never a
// stale hand-copied multiaddr (law 1: read it at use time, not frozen in env). Mirror
// of obsidian-vessel/sidecar/federation-sidecar.ts.
if (!RELAY) {
  try {
    const r = await fetch(`${DISCOVERY}/bootstrap`, { signal: AbortSignal.timeout(5000) })
    if (r.ok) {
      const b = (await r.json()) as { relay_multiaddrs?: string[] }
      if (b.relay_multiaddrs?.length) {
        RELAY = b.relay_multiaddrs[0]!
        console.log(`[fed-sidecar] relay from ${DISCOVERY}/bootstrap: ${RELAY}`)
      }
    }
  } catch (e) {
    console.warn(`[fed-sidecar] bootstrap fetch failed (${String((e as Error)?.message ?? e)})`)
  }
}
if (!RELAY) die('set RELAY_MULTIADDR, or DISCOVERY_URL must expose relay_multiaddrs via /bootstrap')

const vl: VesselLibp2p = await createVesselLibp2p({ vesselId: VESSEL_ID, relayMultiaddr: RELAY, enableHttp: true })

// Serve resolves over libp2p-HTTP by proxying each pointer to the local vessel's
// plain-HTTP /resolve. Unwrap the common response envelopes so the caller (goal-host
// via the egress) receives the vessel's content verbatim.
await serveResolveHttp(vl, async (pointer) => {
  try {
    const resp = await fetch(LOCAL_RESOLVE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pointer),
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    })
    const j: any = await resp.json().catch(() => null)
    if (j == null) return { error: 'local vessel returned non-JSON' }
    if (j.success === false) return { error: j.error || 'local vessel resolve failed' }
    // Prefer {content}; fall back to {body}; else the raw payload.
    return 'content' in j ? j.content : ('body' in j ? j.body : j)
  } catch (e) {
    return { error: 'sidecar proxy to local vessel failed: ' + String((e as Error)?.message ?? e) }
  }
})

// Wait for the relay reservation → our advertisable circuit multiaddr.
let circuit = ''
for (let i = 0; i < 40; i++) {
  const c = vl.advertiseMultiaddrs().find((m) => m.includes('p2p-circuit'))
  if (c) { circuit = c; break }
  await new Promise((r) => setTimeout(r, 500))
}
if (!circuit) console.warn('[fed-sidecar] no circuit multiaddr yet — relay reservation pending')

// Plain HTTP /health — a liveness surface (mirrors the transport vessel).
Bun.serve({
  port: HEALTH_PORT,
  hostname: '0.0.0.0',
  fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/health') {
      return Response.json({ status: 'ok', service: VESSEL_ID, transport: vl.health(), libp2p_peer_id: vl.peerId, libp2p_multiaddr: circuit })
    }
    return new Response('not found', { status: 404 })
  },
})

async function register(): Promise<void> {
  try {
    const r = await fetch(DISCOVERY + '/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(API_KEY ? { Authorization: 'ApiKey ' + API_KEY } : {}) },
      body: JSON.stringify({
        vesselId: VESSEL_ID,
        vesselName: VESSEL_NAME,
        version: '0.1.0',
        // HTTP surface is loopback here (the health port); the real reach is libp2p.
        endpoint: `http://127.0.0.1:${HEALTH_PORT}`,
        shapes: SHAPES,
        resolve_endpoint: '/v2/impulses/resolve',
        resolve_request_format: 'pointer',
        auth_scheme: 'none',
        protocol: 'libp2p',
        libp2p_peer_id: vl.peerId,
        libp2p_multiaddr: circuit ? [circuit] : [],
        ...(SYSTEM_VESSEL ? { systemVessel: true } : {}),
      }),
    })
    console.log('[fed-sidecar] register ->', r.status, 'shapes=', SHAPES.join(','), 'circuit=', circuit || '(pending)')
  } catch (e) {
    console.log('[fed-sidecar] register err', String(e))
  }
}
await register()
setInterval(register, 120_000) // refresh discovery TTL (5-min TTL)

console.log(`[fed-sidecar] up id=${VESSEL_ID} peer=${vl.peerId} health=:${HEALTH_PORT} local=${LOCAL_RESOLVE_URL}`)
