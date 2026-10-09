// resolve-context.test.ts — an inbound resolve tells its handler which peer sent it.
//
// Two in-process nodes on loopback, no relay, nothing leaves the host. The server serves
// both inbound paths (serveResolve, serveResolveHttp); the client dials each. The handler
// must receive the CLIENT's peer id as ctx.remotePeer, and a one-argument handler must
// keep working unchanged (the context argument is optional).
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createVesselLibp2p, serveResolve, serveResolveHttp, resolveViaLibp2p, resolveViaHttp, type VesselLibp2p } from '../src/index.ts'

let server: VesselLibp2p
let legacy: VesselLibp2p
let client: VesselLibp2p
const seen: Array<{ pointer: any, ctx: any, argc: number }> = []
const tag = `resolve-context-test-${process.pid}-${Date.now()}`

const loopbackAddr = (vl: VesselLibp2p): string => {
  const ma = vl.advertiseMultiaddrs().find((m) => m.startsWith('/ip4/127.0.0.1/tcp/'))
  if (!ma) throw new Error('no loopback listen address: ' + JSON.stringify(vl.advertiseMultiaddrs()))
  return ma.includes('/p2p/') ? ma : `${ma}/p2p/${vl.peerId}`
}

beforeAll(async () => {
  server = await createVesselLibp2p({ vesselId: `${tag}-server`, enableHttp: true, disableDcutr: true })
  legacy = await createVesselLibp2p({ vesselId: `${tag}-legacy`, enableHttp: true, disableDcutr: true })
  client = await createVesselLibp2p({ vesselId: `${tag}-client`, enableHttp: true, disableDcutr: true })
  const h = (...args: any[]) => { seen.push({ pointer: args[0], ctx: args[1], argc: args.length }); return { shape: args[0]?.type, ok: true } }
  await serveResolve(server, h)
  await serveResolveHttp(server, h)
  // A handler written before the context existed: one parameter, ignores the rest.
  const old = (pointer: any) => ({ shape: pointer?.type, legacy: true })
  await serveResolve(legacy, old)
  await serveResolveHttp(legacy, old)
}, 30_000)

afterAll(async () => {
  for (const n of [client, server, legacy]) await n?.stop().catch(() => {})
})

test('lpStream inbound: the handler receives the dialer\'s peer id', async () => {
  seen.length = 0
  const res = await resolveViaLibp2p(client, loopbackAddr(server), { type: 'ctx_probe_lp' })
  expect(res).toEqual({ content: { shape: 'ctx_probe_lp', ok: true }, metadata: { shape: 'ctx_probe_lp' } })
  expect(seen.length).toBe(1)
  expect(seen[0].ctx).toEqual({ remotePeer: client.peerId, transport: 'lpstream' })
}, 30_000)

test('HTTP-over-libp2p inbound: the handler receives the dialer\'s peer id', async () => {
  seen.length = 0
  const res = await resolveViaHttp(client, loopbackAddr(server), { type: 'ctx_probe_http' })
  expect(res?.content).toEqual({ shape: 'ctx_probe_http', ok: true })
  expect(seen.length).toBe(1)
  expect(seen[0].ctx).toEqual({ remotePeer: client.peerId, transport: 'http' })
}, 30_000)

test('a one-argument handler is unaffected on both paths', async () => {
  const a = await resolveViaLibp2p(client, loopbackAddr(legacy), { type: 'legacy_lp' })
  expect(a).toEqual({ content: { shape: 'legacy_lp', legacy: true }, metadata: { shape: 'legacy_lp' } })
  const b = await resolveViaHttp(client, loopbackAddr(legacy), { type: 'legacy_http' })
  expect(b?.content).toEqual({ shape: 'legacy_http', legacy: true })
}, 30_000)
