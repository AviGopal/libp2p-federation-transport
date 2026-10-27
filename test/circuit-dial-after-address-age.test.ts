// circuit-dial-after-address-age.test.ts — a circuit dial still works after the relay's
// address has aged out of the peer store.
//
// Three in-process nodes on loopback, nothing leaves the host: a relay, a target that holds
// a reservation on it, and a client with NO standing relay connection whose peer store
// forgets addresses after one second (the production default is one hour). The client
// resolves over the target's circuit address, drops its relay connection, waits past the
// address age, and resolves over the SAME address again. Before the fix the second dial
// failed with "no valid addresses for peer <relay>": the circuit transport dialed the relay
// by peer id, and the peer store had kept the address's first observed time and aged it out.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createLibp2p, type Libp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { asCrypto, defaultCrypto } from '@chainsafe/libp2p-noise/crypto'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { createVesselLibp2p, serveResolve, resolveViaLibp2p, type VesselLibp2p } from '../src/index.ts'

const ADDRESS_AGE_MS = 1_000
const encrypter = () => noise({ crypto: { ...defaultCrypto, chaCha20Poly1305Encrypt: asCrypto.chaCha20Poly1305Encrypt, chaCha20Poly1305Decrypt: asCrypto.chaCha20Poly1305Decrypt } })
const tag = `circuit-age-test-${process.pid}-${Date.now()}`

let relay: Libp2p
let target: VesselLibp2p
let client: Libp2p
let circuitAddr = ''

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  relay = await createLibp2p({
    addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
    transports: [tcp()],
    connectionEncrypters: [encrypter()],
    streamMuxers: [yamux()],
    services: { identify: identify(), relay: circuitRelayServer({ reservations: { applyDefaultLimit: false } }) } as any,
  })
  await relay.start()
  const relayAddr = relay.getMultiaddrs().find((m) => m.toString().startsWith('/ip4/127.0.0.1/tcp/'))!.toString()

  target = await createVesselLibp2p({ vesselId: `${tag}-target`, relayMultiaddr: relayAddr, disableDcutr: true })
  await serveResolve(target, (pointer: any) => ({ shape: pointer?.type, ok: true }))
  for (let i = 0; i < 100 && !circuitAddr; i++) {
    circuitAddr = target.advertiseMultiaddrs().find((m) => m.includes('/p2p-circuit/')) ?? ''
    if (!circuitAddr) await sleep(100)
  }
  if (!circuitAddr) throw new Error('target never got a circuit address: ' + JSON.stringify(target.advertiseMultiaddrs()))

  client = await createLibp2p({
    addresses: { listen: [] },
    transports: [tcp(), circuitRelayTransport()],
    connectionEncrypters: [encrypter()],
    streamMuxers: [yamux()],
    peerStore: { maxAddressAge: ADDRESS_AGE_MS },
    connectionMonitor: { abortConnectionOnPingFailure: false },
    services: { identify: identify() } as any,
  })
  await client.start()
}, 30_000)

// The relay server's stop() does not settle within seconds here, so every stop is bounded.
afterAll(async () => {
  await Promise.all([client?.stop(), target?.stop(), relay?.stop()].map((p) => Promise.race([p?.catch(() => {}), sleep(4_000)])))
}, 20_000)

test('a circuit dial after the relay address has aged out of the peer store still resolves', async () => {
  const asVessel = { node: client } as unknown as VesselLibp2p
  const first = await resolveViaLibp2p(asVessel, circuitAddr, { type: 'age_probe_1' })
  expect(first?.content).toEqual({ shape: 'age_probe_1', ok: true })

  // No standing relay connection: close every connection, then let the address age out.
  await Promise.allSettled(client.getConnections().map((c) => c.close()))
  expect(client.getConnections().length).toBe(0)
  await sleep(ADDRESS_AGE_MS * 2)

  const second = await resolveViaLibp2p(asVessel, circuitAddr, { type: 'age_probe_2' })
  expect(second?.content).toEqual({ shape: 'age_probe_2', ok: true })
}, 30_000)
