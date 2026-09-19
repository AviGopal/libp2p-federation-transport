import { type Libp2p } from 'libp2p';
export declare const RESOLVE_PROTO = "/substrate/resolve/1.0.0";
/** Serve cross-substrate resolution: handler(pointer) -> content, over RESOLVE_PROTO. */
export declare function serveResolve(vl: VesselLibp2p, handler: (pointer: any) => Promise<any> | any): Promise<void>;
/**
 * Dial a peer and resolve a pointer over libp2p (lpStream-corrected path).
 * Accepts a multiaddr string OR a PeerId string — dialing by PeerId lets libp2p
 * prefer a DCUtR-upgraded direct connection; a `/p2p-circuit` multiaddr forces relay.
 */
export declare function resolveViaLibp2p(vl: VesselLibp2p, target: string, pointer: any): Promise<any>;
export declare const RESOLVE_HTTP_PROTO = "/substrate/resolve-http/1.0.0";
export declare const RESOLVE_HTTP_PATH = "/v2/impulses/resolve";
/** Serve cross-substrate resolution as an HTTP POST handler over libp2p. */
export declare function serveResolveHttp(vl: VesselLibp2p, handler: (pointer: any) => Promise<any> | any): Promise<void>;
/**
 * Resolve a pointer FROM a peer over HTTP-over-libp2p (Fetch-style).
 * `target` is a PeerId string (preferred — lets libp2p pick direct vs relay) or a
 * multiaddr string. We pre-dial so a connection (direct, ideally DCUtR-upgraded) exists,
 * then fetch the resolve route by protocol path.
 */
export declare function resolveViaHttp(vl: VesselLibp2p, target: string, pointer: any): Promise<any>;
export interface VesselLibp2pOptions {
    vesselId: string;
    relayMultiaddr?: string;
    localTcpPort?: number;
    enableHttp?: boolean;
    disableDcutr?: boolean;
    reReserveAtTtlFraction?: number;
    assumedReservationTtlMs?: number;
    extraServices?: Record<string, unknown>;
}
export interface TransportHealth {
    peerId: string;
    activeReservations: number;
    reservationTtlRemainingMs: number | null;
    connections: Array<{
        peer: string;
        addr: string;
        limited: boolean;
        bytesRemaining: number | null;
        secondsRemaining: number | null;
    }>;
    holePunchSuccess: number;
    holePunchFail: number;
    streamResets: number;
}
export interface VesselLibp2p {
    node: Libp2p;
    peerId: string;
    /** Addresses to advertise to discovery (includes the relay-circuit address when a relay is used). */
    advertiseMultiaddrs: () => string[];
    /** Snapshot of transport reachability — what self-recovery senses. */
    health: () => TransportHealth;
    /** Stop the reservation-refresh loop and the node. */
    stop: () => Promise<void>;
}
/** Deterministic Ed25519 keypair from the vessel id (seed = sha256(vesselId)). */
export declare function vesselKeyFromId(vesselId: string): Promise<import("@libp2p/interface").Ed25519PrivateKey>;
export declare function createVesselLibp2p(opts: VesselLibp2pOptions): Promise<VesselLibp2p>;
//# sourceMappingURL=index.d.ts.map