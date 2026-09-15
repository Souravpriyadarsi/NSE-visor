import { AngelLoginError, SmartApi, type AngelCredentials } from '../../src/lib/angel/api.ts';
import { MODE, parseTick, STREAM_URL, subscribeMessage, type DepthTick } from '../../src/lib/angel/stream.ts';

type Listener = (tick: DepthTick) => void;

export type ServiceStatus = { loggedIn: boolean; loginFailed: boolean; streaming: boolean; lastTickAt: number | null; error: string | null };

const PING_MS = 10_000;
const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;

/** Node's built-in WebSocket accepts headers (the browser's doesn't), which the SmartAPI stream needs. */
type NodeWebSocket = new (url: string, options: { headers: Record<string, string> }) => WebSocket;

/** Keeps one Angel One price stream open for everything that's watching, and reconnects when it drops. */
export class AngelService {
  readonly api: SmartApi;
  readonly latest = new Map<string, DepthTick>();
  private readonly credentials: AngelCredentials;
  private readonly watchers = new Map<string, Set<Listener>>();
  private socket: WebSocket | null = null;
  private connecting = false;
  private closed = false;
  private retryMs = FIRST_RETRY_MS;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTickAt: number | null = null;
  private error: string | null = null;

  constructor(credentials: AngelCredentials) {
    this.credentials = credentials;
    this.api = new SmartApi(credentials);
  }

  status(): ServiceStatus {
    return {
      loggedIn: this.api.loggedIn,
      loginFailed: this.api.loginError != null,
      streaming: this.socket?.readyState === WebSocket.OPEN,
      lastTickAt: this.lastTickAt,
      error: this.api.loginError ?? this.error,
    };
  }

  /** Streams ticks for these tokens to `listener` (starting with the latest known one). Returns a function to stop. */
  watch(tokens: string[], listener: Listener): () => void {
    const added: string[] = [];
    for (const token of tokens) {
      let listeners = this.watchers.get(token);
      if (!listeners) {
        this.watchers.set(token, (listeners = new Set()));
        added.push(token);
      }
      listeners.add(listener);
      const last = this.latest.get(token);
      if (last) listener(last);
    }
    if (added.length) this.send(subscribeMessage(added, MODE.snapQuote, 1));
    void this.connect();

    return () => {
      const removed: string[] = [];
      for (const token of tokens) {
        const listeners = this.watchers.get(token);
        listeners?.delete(listener);
        if (listeners?.size === 0) {
          this.watchers.delete(token);
          removed.push(token);
        }
      }
      if (removed.length) this.send(subscribeMessage(removed, MODE.snapQuote, 0));
    };
  }

  close(): void {
    this.closed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    this.socket?.close();
  }

  private send(message: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(message);
  }

  private async connect(): Promise<void> {
    if (this.closed || this.connecting || this.socket || this.watchers.size === 0) return;
    this.connecting = true;
    try {
      const session = await this.api.ensureSession();
      const socket = new (WebSocket as unknown as NodeWebSocket)(STREAM_URL, {
        headers: {
          Authorization: `Bearer ${session.jwtToken}`,
          'x-api-key': this.credentials.apiKey,
          'x-client-code': this.credentials.clientCode,
          'x-feed-token': session.feedToken,
        },
      });
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      socket.onopen = () => {
        this.error = null;
        this.retryMs = FIRST_RETRY_MS;
        if (this.watchers.size) socket.send(subscribeMessage([...this.watchers.keys()], MODE.snapQuote, 1));
        this.pingTimer = setInterval(() => this.send('ping'), PING_MS);
      };
      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') return; // "pong"
        const tick = parseTick(event.data as ArrayBuffer);
        if (!tick) return;
        this.lastTickAt = Date.now();
        this.latest.set(tick.token, tick);
        this.watchers.get(tick.token)?.forEach((listener) => listener(tick));
      };
      socket.onerror = () => {
        this.error = 'The Angel One price stream disconnected; reconnecting.';
      };
      socket.onclose = () => {
        clearInterval(this.pingTimer);
        this.socket = null;
        // A refused connection is often an expired session.
        this.api.clearSession();
        this.scheduleReconnect();
      };
    } catch (err) {
      this.socket = null;
      this.error = err instanceof Error ? err.message : String(err);
      // Wrong login details: stop, so repeated attempts don't lock the account.
      if (!(err instanceof AngelLoginError)) this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.watchers.size === 0 || this.api.loginError) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
  }
}
