# @avigopal/libp2p-federation-transport

The reusable libp2p **Circuit Relay v2** transport for substrate federation — how a
vessel behind NAT becomes reachable across substrate boundaries, and how a
libp2p-free vessel dials out to a peer.

It is the data-plane counterpart to `@avigopal/vessel-discovery-client` (the HTTP
control plane): discovery advertises *who produces shape X and where*; this package
*carries the bytes to X over the relay*.

## Two things it gives you

### 1. The primitive (library)

```ts
import { createVesselLibp2p, serveResolveHttp, resolveViaHttp } from '@avigopal/libp2p-federation-transport'

const vl = await createVesselLibp2p({ vesselId: 'my-vessel', relayMultiaddr: RELAY, enableHttp: true })
await serveResolveHttp(vl, async (pointer) => resolveLocally(pointer))   // INGRESS: serve over libp2p
const content = await resolveViaHttp(vl, peerMultiaddr, pointer)         // EGRESS: dial a peer
```

- Deterministic identity: the libp2p `peerId` is seeded from `sha256(vesselId)`, so it
  is stable across restarts and doubles as the vessel's federation identity.
- Circuit Relay v2 + DCUtR hole-punching + Noise end-to-end encryption; the relay
  never sees plaintext and falls back to permanently-relayed for symmetric NAT.

### 2. The ingress sidecar (runnable)

Makes any local HTTP vessel (e.g. an Obsidian plugin on `127.0.0.1:27182`) reachable
over the relay and registered with discovery — the vessel needs **no** libp2p deps:

```bash
FED_VESSEL_ID=obsidian-host-1 \
RELAY_MULTIADDR=/ip4/<relay>/tcp/30333/p2p/<relay-id> \
DISCOVERY_URL=http://<hub>:18100 \
LOCAL_RESOLVE_URL=http://127.0.0.1:27182/resolve \
FED_SHAPES=obsidian:note,obsidian:write_note \
METABOB_API_KEY=<hub-issued-key> \
bun src/sidecar.ts
```

The sidecar dials the relay, serves resolves over libp2p by proxying each pointer to
`LOCAL_RESOLVE_URL`, and registers with discovery as `protocol:"libp2p"` with its
circuit multiaddr. The substrate's goal-host then resolves those shapes across the
relay via its egress — with the local vessel unaware libp2p is involved.

## Requires

A running **relay** on a public IP (see `relay.ts` in the substrate repo) and a
`discovery-vessel` to register with.

MIT © AviGopal
