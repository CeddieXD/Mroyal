import { api, subscribeEvents, imageUrl } from './api.js';

const state = {
    filter: 'ALL',          // ALL | VERIFIED | PREPARING | SERVED
    orders: [],             // full kitchen list from server
    newCount: 0,            // bell counter — reset when user views incoming
    seenIds: new Set(),
};

const $ = sel => document.querySelector(sel);
const SOUND_STORAGE_KEY = 'mango-royal-kitchen-sound-muted';
const alertedIncomingOrderIds = new Set();
let soundEnabled = true;
let alertAudioContext = null;
try {
    soundEnabled = localStorage.getItem(SOUND_STORAGE_KEY) !== 'muted';
} catch (error) {
    console.warn('Could not read kitchen sound preference:', error);
}
const formatAddOns = addOns => addOns.map(addon => {
    if (typeof addon === 'string') return addon;
    return `${addon.name}${addon.quantity > 1 ? ` ×${addon.quantity}` : ''}`;
}).join(', ');

// The state machine — mirrors backend TRANSITIONS.
const NEXT = { VERIFIED: 'PREPARING', PREPARING: 'SERVED' };
const BACK = { PREPARING: 'VERIFIED', SERVED: 'PREPARING' };

const STATUS_LABEL = { VERIFIED: 'Incoming', PREPARING: 'Preparing', SERVED: 'Served' };

function elapsed(iso) {
    const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 60) return `${secs}s ago`;
    const m = Math.floor(secs / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
}

/* ---------- rendering ---------- */
function renderCounts() {
    const by = { VERIFIED: 0, PREPARING: 0, SERVED: 0 };
    for (const o of state.orders) if (by[o.status] != null) by[o.status]++;
    $('#count-ALL').textContent       = state.orders.length;
    $('#count-VERIFIED').textContent  = by.VERIFIED;
    $('#count-PREPARING').textContent = by.PREPARING;
    $('#count-SERVED').textContent    = by.SERVED + state.orders.filter(order => order.status === 'READY').length;
}

function itemRow(i) {
    return `
      <div class="item-row">
        <div class="item-thumb">
          ${i.image ? `<img src="${imageUrl(i.image)}" alt="${i.name}" onerror="this.style.display='none'">` : `<span>—</span>`}
        </div>
        <div class="item-info">
          <div class="item-name">${i.name}</div>
          <div class="item-meta">${i.bundleQuantity > 1 ? `${i.bundleQuantity} Tall cups per bundle` : i.size || ''}${i.addOns?.length ? ` · Add-ons: ${formatAddOns(i.addOns)}` : ''}</div>
        </div>
        <div class="item-qty">${i.bundleQuantity > 1 ? `${i.quantity} bundle${i.quantity === 1 ? '' : 's'} (${i.quantity * i.bundleQuantity} cups)` : `×${i.quantity}`}</div>
      </div>`;
}

function cardActions(o, oldestIncomingId) {
    const next = NEXT[o.status];
    const back = BACK[o.status];
    const parts = [];
    if (next) {
        const label = next === 'PREPARING' ? 'Start Preparing'
                    : next === 'SERVED'    ? 'Mark Served'
                    : `→ ${STATUS_LABEL[next]}`;
        const cls   = next === 'SERVED' ? 'btn-success' : 'btn-primary';
        const blocked = o.status === 'VERIFIED' && Number(o.rawId) !== oldestIncomingId;
        parts.push(`<button class="btn ${cls}" data-act="next" ${blocked ? 'disabled title="Start the oldest incoming order first."' : ''}>${label}</button>`);
    }
    if (back) {
        parts.push(`<button class="btn btn-ghost" data-act="back" title="Move back">↶ ${STATUS_LABEL[back]}</button>`);
    }
    return parts.join('');
}

function cardHtml(o, oldestIncomingId, draggable = false) {
    const displayStatus = o.status === 'READY' ? 'SERVED' : o.status;
    const displayOrder = displayStatus === o.status ? o : { ...o, status: displayStatus };
    return `
      <div class="card status-${displayStatus}" data-id="${o.rawId}" data-status="${displayStatus}"${draggable ? ' draggable="true"' : ''}>
        <div class="card-header">
          <div>
            <div class="order-id">#${o.orderId}</div>
            <div class="ts">${elapsed(o.createdAt)}</div>
          </div>
        </div>
        <div class="card-body">
          ${displayOrder.items.map(itemRow).join('')}
        </div>
        <div class="card-actions">${cardActions(displayOrder, oldestIncomingId)}</div>
      </div>`;
}

function render() {
    const board = $('#board');
    const empty = $('#empty-state');
    const orders = [...state.orders].sort((a, b) =>
        new Date(a.createdAt) - new Date(b.createdAt) || Number(a.rawId) - Number(b.rawId)
    );
    const oldestIncoming = orders.find(order => order.status === 'VERIFIED');
    const oldestIncomingId = oldestIncoming ? Number(oldestIncoming.rawId) : null;

    if (state.filter === 'ALL') {
        empty.classList.add('hidden');
        const byStatus = { VERIFIED: [], PREPARING: [], SERVED: [] };
        for (const o of orders) {
            const status = o.status === 'READY' ? 'SERVED' : o.status;
            if (byStatus[status]) byStatus[status].push(o);
        }

        board.innerHTML = `
          <div class="columns">
            ${['VERIFIED', 'PREPARING', 'SERVED'].map(s => `
              <section class="column col-${s}" data-drop="${s}">
                <div class="col-header">
                  <span class="col-title">${STATUS_LABEL[s]}</span>
                  <span class="badge badge-${s === 'VERIFIED' ? 'yellow' : s === 'PREPARING' ? 'blue' : 'green'}">${byStatus[s].length}</span>
                </div>
                <div class="col-body">
                  ${byStatus[s].map(o => cardHtml(o, oldestIncomingId, s !== 'SERVED' && o.status !== 'READY')).join('') || `<div class="empty col-empty">No orders</div>`}
                </div>
              </section>`).join('')}
          </div>`;
    } else {
        const list = orders.filter(o => (o.status === 'READY' ? 'SERVED' : o.status) === state.filter);
        if (!list.length) {
            board.innerHTML = '';
            empty.classList.remove('hidden');
        } else {
            empty.classList.add('hidden');
            board.innerHTML = `<div class="grid">${list.map(order => cardHtml(order, oldestIncomingId)).join('')}</div>`;
        }
    }

    board.querySelectorAll('.card').forEach(el => {
        const o = state.orders.find(x => String(x.rawId) === el.dataset.id);
        if (!o) return;
        el.querySelectorAll('[data-act]').forEach(btn =>
            btn.addEventListener('click', () =>
                handleAction(btn.dataset.act, o.status === 'READY' ? { ...o, status: 'SERVED' } : o)
            )
        );
    });
    if (state.filter === 'ALL') wireDnd(oldestIncomingId);
}

/* ---------- drag & drop (ALL view only) ---------- */
// Mirror of backend TRANSITIONS — cheap client-side guard so an illegal
// drop doesn't round-trip just to receive a 409.
const ALLOWED = {
    VERIFIED:  new Set(['PREPARING']),
    PREPARING: new Set(['SERVED', 'VERIFIED']),
    SERVED:    new Set(['PREPARING']),
    READY:     new Set(['PREPARING']),
};

function wireDnd(oldestIncomingId) {
    let dragId = null;
    let dragFrom = null;

    document.querySelectorAll('.card[draggable="true"]').forEach(card => {
        card.addEventListener('dragstart', e => {
            dragId = card.dataset.id;
            dragFrom = card.dataset.status;
            if (dragFrom === 'VERIFIED' && Number(dragId) !== oldestIncomingId) {
                e.preventDefault();
                dragId = null;
                dragFrom = null;
                return;
            }
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            // Firefox needs data set for the drag to fire.
            e.dataTransfer.setData('text/plain', dragId);
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            document.querySelectorAll('.column').forEach(c =>
                c.classList.remove('drop-ok', 'drop-bad'));
        });
    });

    document.querySelectorAll('.column[data-drop]').forEach(col => {
        const target = col.dataset.drop;
        col.addEventListener('dragover', e => {
            if (!dragFrom) return;
            const normalizedTarget = target === 'READY' ? 'SERVED' : target;
            const ok = dragFrom === normalizedTarget || (ALLOWED[dragFrom] && ALLOWED[dragFrom].has(normalizedTarget));
            if (!ok) { col.classList.add('drop-bad'); return; }
            e.preventDefault(); // enable drop
            col.classList.add('drop-ok');
        });
        col.addEventListener('dragleave', () => col.classList.remove('drop-ok', 'drop-bad'));
        col.addEventListener('drop', e => {
            e.preventDefault();
            col.classList.remove('drop-ok', 'drop-bad');
            const normalizedTarget = target === 'READY' ? 'SERVED' : target;
            if (!dragId || dragFrom === normalizedTarget) return;
            if (!ALLOWED[dragFrom] || !ALLOWED[dragFrom].has(normalizedTarget)) return;

            const id = dragId;
            // Optimistic update so the card jumps instantly.
            const o = state.orders.find(x => String(x.rawId) === id);
            if (o) o.status = normalizedTarget;
            renderCounts();
            render();

            api.setStatus(id, normalizedTarget).then(refresh).catch(err => {
                alert('Move failed: ' + err.message);
                refresh();
            });
        });
    });
}

/* ---------- actions ---------- */
async function refresh() {
    try {
        const list = await api.orders();

        // Track new VERIFIED orders (fresh from POS) for the bell.
        let fresh = 0;
        for (const o of list) {
            if (o.status === 'VERIFIED' && !state.seenIds.has(o.rawId)) fresh++;
            state.seenIds.add(o.rawId);
        }
        if (fresh && state.filter !== 'VERIFIED' && state.filter !== 'ALL') {
            state.newCount += fresh;
        }

        state.orders = list;
        renderBell();
        renderCounts();
        render();
    } catch (err) {
        console.error(err);
        // Don't alert on refresh — kitchen screens are always-on.
    }
}

function renderBell() {
    const bell = $('#bell');
    const cnt  = $('#bell-count');
    if (state.newCount > 0) {
        bell.hidden = false;
        cnt.textContent = state.newCount;
    } else {
        bell.hidden = true;
    }
}

function handleAction(act, o) {
    const target = act === 'next' ? NEXT[o.status] : BACK[o.status];
    if (!target) return;
    api.setStatus(o.rawId, target)
        .then(refresh)
        .catch(e => alert('Status update failed: ' + e.message));
}

function syncSoundToggle() {
    const button = $('#sound-toggle');
    if (!button) return;
    button.textContent = soundEnabled ? 'Mute sound' : 'Unmute sound';
    button.setAttribute('aria-pressed', String(soundEnabled));
}

async function unlockAlertAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
        console.warn('Audio alerts are not supported by this browser.');
        return;
    }
    if (!alertAudioContext) alertAudioContext = new AudioContextClass();
    if (alertAudioContext.state === 'suspended') await alertAudioContext.resume();
}

function playOrderAlertSound() {
    if (!soundEnabled || !alertAudioContext || alertAudioContext.state !== 'running') return;
    const oscillator = alertAudioContext.createOscillator();
    const gain = alertAudioContext.createGain();
    const now = alertAudioContext.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(gain);
    gain.connect(alertAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.23);
}

function showOrderAlert(payload) {
    const root = $('#order-alerts');
    if (!root) return;
    const orderNumber = payload?.orderNumber || payload?.queueNumber || payload?.orderId || payload?.id;
    const toast = document.createElement('div');
    toast.className = 'order-alert';
    const message = document.createElement('div');
    const title = document.createElement('strong');
    const detail = document.createElement('span');
    title.textContent = 'New order from POS';
    detail.textContent = orderNumber ? `Order #${orderNumber} is ready for the kitchen.` : 'A new order is ready for the kitchen.';
    message.append(title, detail);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'order-alert-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss notification');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => toast.remove());
    toast.append(message, dismiss);
    root.appendChild(toast);
    window.setTimeout(() => toast.remove(), 8000);
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('New order for kitchen', { body: detail.textContent });
    }
}

function wasOrderAlreadyAlerted(payload) {
    const orderId = payload?.orderId ?? payload?.queueNumber;
    if (orderId == null) return false;
    const key = String(orderId);
    if (alertedIncomingOrderIds.has(key)) return true;
    alertedIncomingOrderIds.add(key);
    if (alertedIncomingOrderIds.size > 100) {
        alertedIncomingOrderIds.delete(alertedIncomingOrderIds.values().next().value);
    }
    return false;
}

/* ---------- wiring ---------- */
function wire() {
    $('#today').textContent = new Date().toDateString();
    syncSoundToggle();

    document.addEventListener('pointerdown', () => {
        unlockAlertAudio().catch(error => console.warn('Could not enable kitchen alert sound:', error));
    }, { once: true, capture: true });
    document.addEventListener('keydown', () => {
        unlockAlertAudio().catch(error => console.warn('Could not enable kitchen alert sound:', error));
    }, { once: true, capture: true });
    $('#sound-toggle').addEventListener('click', async () => {
        soundEnabled = !soundEnabled;
        try {
            localStorage.setItem(SOUND_STORAGE_KEY, soundEnabled ? 'enabled' : 'muted');
        } catch (error) {
            console.warn('Could not save kitchen sound preference:', error);
        }
        syncSoundToggle();
        if (soundEnabled) {
            try {
                await unlockAlertAudio();
                playOrderAlertSound();
            } catch (error) {
                console.warn('Could not enable kitchen alert sound:', error);
            }
        }
    });

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        state.filter = t.dataset.filter;
        // Viewing incoming clears the notification badge.
        if (state.filter === 'VERIFIED' || state.filter === 'ALL') state.newCount = 0;
        renderBell();
        render();
    }));

    $('#refresh-btn').addEventListener('click', refresh);

}

wire();
refresh();

// Live push — a POS verification creates a new kitchen order.
subscribeEvents((type, payload) => {
    clearTimeout(window.__kitchenRefreshT);
    window.__kitchenRefreshT = setTimeout(refresh, 150);

    if (type === 'change' && payload?.status === 'VERIFIED' && payload.source === 'pos'
        && !wasOrderAlreadyAlerted(payload)) {
        showOrderAlert(payload);
        playOrderAlertSound();
    }
});

// Safety-net poll + timestamp refresh.
setInterval(refresh, 30000);
setInterval(() => { if (state.orders.length) render(); }, 15000);
