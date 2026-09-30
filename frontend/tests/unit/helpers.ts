import { vi } from 'vitest';

type Reply = { status?: number; body?: unknown; raw?: string };
type Handler = (init: RequestInit | undefined, url: string) => Reply;

/**
 * Fake backend: map "METHOD /path" (path relative to /api, query included) to a response.
 * Returns the mock so tests can inspect calls. Unknown routes → 404.
 */
export function mockApi(routes: Record<string, Handler | Reply>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+\/api/, '');
    const key = `${(init?.method || 'GET').toUpperCase()} ${path}`;
    // exact match, or a key ending in * matches by prefix ("GET /export/*")
    const route = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1];
    if (!route) return new Response(JSON.stringify({ error: 'not mocked: ' + key }), { status: 404 });
    const r = typeof route === 'function' ? route(init, url) : route;
    if (r.raw !== undefined) return new Response(r.raw, { status: r.status ?? 200 });
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** jsdom can't navigate; replace window.location with a plain object we can inspect. */
export function stubLocation() {
  const loc = { href: 'http://localhost/dashboard' };
  Object.defineProperty(window, 'location', { value: loc, writable: true, configurable: true });
  return loc;
}

/** Capture file downloads (createObjectURL + anchor click). */
export function captureDownloads() {
  const saved: string[] = [];
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
  return saved;
}

export const tx = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  transaction_type: 'dispatch',
  status: 'confirmed',
  total_amount: '15750.00',
  advance_paid: '0.00',
  party_name: 'Siddhi Stone',
  worker_name: null,
  stone_type_text: '2x1½',
  sqft_quantity: '500.00',
  unit_rate: '31.50',
  ref_code: 'K7Q2',
  created_at: '2026-09-29T20:00:00Z', // 30 Sep 01:30 IST
  ...over,
});
