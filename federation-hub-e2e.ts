// federation-hub-e2e.ts — prove a local (NATed) spoke joins the syzygy hub namespace
// and is resolvable over the PUBLIC syzygy relay. Two libp2p nodes on this machine both
// reserve on the remote relay; the egress dials the ingress THROUGH it (real NAT traversal
// via the deployed hub). Env: RELAY_MULTIADDR, DISCOVERY_URL, HUB_KEY.
import { createVesselLibp2p, serveResolveHttp, resolveViaHttp } from './src/index.ts'

const RELAY = process.env.RELAY_MULTIADDR!
const DISCOVERY = process.env.DISCOVERY_URL!.replace(/\/+$/, '')
const KEY = process.env.HUB_KEY!
const SHAPE = 'spoke_probe'
const VALUE = 'hello-from-local-spoke-over-syzygy-relay'
const ok = (m: string) => console.log('  ✓ ' + m)

// 1. INGRESS: reserve on the syzygy relay + serve spoke_probe over libp2p.
const ingress = await createVesselLibp2p({ vesselId: 'local-spoke-ingress', relayMultiaddr: RELAY, enableHttp: true })
await serveResolveHttp(ingress, (p) => p?.type === SHAPE ? { shape: SHAPE, produced_by: 'local-spoke', value: VALUE } : { error: 'unknown shape' })
let circuit = ''
for (let i = 0; i < 40; i++) { const c = ingress.advertiseMultiaddrs().find((m) => m.includes('p2p-circuit')); if (c) { circuit = c; break } await new Promise((r) => setTimeout(r, 500)) }
if (!circuit) { console.error('FAIL: ingress got no circuit reservation on the syzygy relay'); process.exit(1) }
ok('ingress reserved on syzygy relay: ' + circuit.slice(0, 72) + '…')

// 2. Register the spoke with the HUB discovery (into the shared org namespace).
const reg = await fetch(DISCOVERY + '/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'ApiKey ' + KEY },
  body: JSON.stringify({ vesselId: 'local-spoke-ingress', vesselName: 'local-spoke', version: '0.1.0', endpoint: 'http://127.0.0.1:0', shapes: [SHAPE], resolve_endpoint: '/v2/impulses/resolve', resolve_request_format: 'pointer', auth_scheme: 'none', protocol: 'libp2p', libp2p_peer_id: ingress.peerId, libp2p_multiaddr: [circuit], systemVessel: true }),
})
if (!reg.ok) { console.error('FAIL: hub register HTTP ' + reg.status); process.exit(1) }
ok('registered spoke_probe with the hub discovery (HTTP ' + reg.status + ')')

// 3. Query the hub discovery back — the spoke is in the shared namespace, libp2p-reachable.
const dq = await fetch(DISCOVERY + '/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'ApiKey ' + KEY }, body: JSON.stringify({ pointer: { type: 'vesselCapability', shape: SHAPE } }) })
const dj: any = await dq.json()
const v = dj?.content?.vessels?.[0]
if (!v || v.protocol !== 'libp2p' || !v.libp2p_multiaddr?.[0]) { console.error('FAIL: hub discovery did not return the spoke as libp2p', JSON.stringify(dj).slice(0, 300)); process.exit(1) }
ok('hub discovery returns spoke as protocol=libp2p, ma=' + v.libp2p_multiaddr[0].slice(0, 60) + '…')

// 4. EGRESS: a second node reserves on the syzygy relay, dials the spoke's advertised
//    multiaddr THROUGH the relay, and resolves spoke_probe.
const egress = await createVesselLibp2p({ vesselId: 'local-spoke-egress', relayMultiaddr: RELAY, enableHttp: true })
for (let i = 0; i < 20; i++) { if (egress.advertiseMultiaddrs().some((m) => m.includes('p2p-circuit'))) break; await new Promise((r) => setTimeout(r, 500)) }
const res: any = await resolveViaHttp(egress, v.libp2p_multiaddr[0], { type: SHAPE })
const value = res?.content?.value ?? res?.value
console.log('  → resolve over syzygy relay returned:', JSON.stringify(res))
await ingress.stop().catch(() => {}); await egress.stop().catch(() => {})
if (value === VALUE) { console.log('\nFEDERATION E2E PASS — local spoke resolved through the public syzygy relay'); process.exit(0) }
console.error('\nFAIL: unexpected resolve value'); process.exit(1)
