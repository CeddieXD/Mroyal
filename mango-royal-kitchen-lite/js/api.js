// Thin fetch client for the kitchen backend. Change API_BASE if the middleware runs elsewhere.
export const API_HOST = window.KITCHEN_API_BASE || 'http://localhost:3000';
export const API_BASE = API_HOST + '/api/kitchen';
export const imageUrl = (p) => p ? (p.startsWith('http') ? p : API_HOST + p) : null;

async function req(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
}

export function subscribeEvents(onEvent) {
    let es;
    let retryMs = 2000;
    const connect = () => {
        es = new EventSource(API_BASE + '/events');
        es.addEventListener('hello',        () => { retryMs = 2000; });
        es.addEventListener('order:new',    e => onEvent('new', safeJson(e.data)));
        es.addEventListener('order:change', e => onEvent('change', safeJson(e.data)));
        es.onerror = () => {
            es.close();
            setTimeout(connect, retryMs);
            retryMs = Math.min(retryMs * 2, 30000);
        };
    };
    connect();
    return () => es && es.close();
}
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

export const api = {
    orders: () => req('/orders'),
    setStatus: (id, status) => req(`/orders/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
    }),
};
