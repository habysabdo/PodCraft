/**
 * Minimal local type declarations for the Cloudflare Workers runtime APIs
 * used by src/worker.ts and src/roomDurableObject.ts.
 *
 * This repo has no @cloudflare/workers-types dependency on purpose: the
 * Worker code is small and only needs these few APIs. Wrangler bundles
 * `cloudflare:workers` as a runtime builtin — it is never resolved from
 * node_modules, and `wrangler deploy` does not run tsc.
 *
 * IMPORTANT: this file must stay a SCRIPT declaration file (no top-level
 * import/export). An `export {}` at the bottom turns it into a module, and
 * ambient `declare module` blocks inside a module file do not register —
 * tsc then fails with "Cannot find module 'cloudflare:workers'".
 */

declare module 'cloudflare:workers' {
  export interface DurableObjectStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
  }

  export interface DurableObjectState {
    storage: DurableObjectStorage;
    waitUntil(promise: Promise<unknown>): void;
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
    getWebSockets(): WebSocket[];
    acceptWebSocket(ws: WebSocket): void;
  }

  export interface DurableObjectId {
    toString(): string;
    equals(other: DurableObjectId): boolean;
  }

  export interface DurableObjectStub {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  }

  export interface DurableObjectNamespace {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
  }

  /** Minimal D1 API surface (only prepare/bind/run are used by worker.ts). */
  export interface D1Result<T = unknown> {
    success: boolean;
    meta: { last_row_id: number | null; changes: number };
    results?: T[];
    error?: string;
  }

  export interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    run(): Promise<D1Result>;
    first<T = unknown>(column?: string): Promise<T | null>;
    all<T = unknown>(): Promise<D1Result<T>>;
  }

  export interface D1Database {
    prepare(query: string): D1PreparedStatement;
  }

  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

/** Created by `new WebSocketPair()` in Workers: [client, server]. */
interface WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
declare const WebSocketPair: {
  new (): WebSocketPair;
};

/** Hibernation API: per-socket metadata on Workers WebSockets. */
interface WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

/** Workers ResponseInit carries the server side of a WebSocketPair on a
 *  101 upgrade response (the DOM lib's ResponseInit has no such field). */
interface ResponseInit {
  webSocket?: WebSocket | null;
}
