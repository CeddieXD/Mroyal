// Thin fetch client for the POS backend. Change API_BASE if the middleware runs elsewhere.
export const API_HOST = window.POS_API_BASE || `${window.location.protocol}//${window.location.hostname}:3000`;
export const API_BASE = API_HOST + '/api/pos';
export const imageUrl = (p) => p ? (p.startsWith('http') ? p : API_HOST + p) : null;

async function req(path, opts = {}, base = API_BASE) {
    const res = await fetch(base + path, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
}

export function subscribeEvents(onEvent) {
    let retryMs = 2000;
    let stopped = false;
    let controller;
    let retryTimer;

    async function connect() {
        controller = new AbortController();
        try {
            const response = await fetch(API_BASE + '/events', {
                headers: { Accept: 'text/event-stream' },
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Event stream failed (HTTP ${response.status})`);
            if (!response.body) throw new Error('Event stream is unavailable in this browser.');
            retryMs = 2000;

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (!stopped) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
                let boundary;
                while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                    const message = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    let eventName = '';
                    let data = '';
                    for (const line of message.split('\n')) {
                        if (line.startsWith('event:')) eventName = line.slice(6).trim();
                        if (line.startsWith('data:')) data += line.slice(5).trim();
                    }
                    if (eventName === 'order:new') onEvent('new', safeJson(data));
                    if (eventName === 'order:change') onEvent('change', safeJson(data));
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError' && !stopped) console.warn('POS event stream disconnected:', error.message);
        } finally {
            if (!stopped) {
                retryTimer = setTimeout(connect, retryMs);
                retryMs = Math.min(retryMs * 2, 30000);
            }
        }
    }

    void connect();
    return () => {
        stopped = true;
        clearTimeout(retryTimer);
        controller?.abort();
    };
}
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

export const api = {
    orders: (status) => req(`/orders?status=${encodeURIComponent(status)}`),
    posSettings: () => req('/settings'),
    endOfDayReceipt: () => req('/end-of-day-receipt', { method: 'POST' }),
    menu: () => req('/menu'),
    addOns: () => req('/api/add-ons', {}, API_HOST),
    verify: (id, payload) => req(`/orders/${id}/verify`, { method: 'POST', body: JSON.stringify(payload) }),
    print: (id) => req(`/orders/${id}/print`, { method: 'POST' }),
    void:   (id, reason, pendingOnly = false) =>
        req(`/orders/${id}/void`, { method: 'POST', body: JSON.stringify({ reason, pendingOnly }) }),
    reopen: (id)          => req(`/orders/${id}/reopen`, { method: 'POST' }),
    edit:   (id, items)   => req(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ items }) }),
    walkin: (items) =>
        req('/orders/walkin', { method: 'POST', body: JSON.stringify({ items }) }),
};
