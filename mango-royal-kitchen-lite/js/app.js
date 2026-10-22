import { api, subscribeEvents, imageUrl } from './api.js';

const state = {
    filter: 'ALL',          // ALL | VERIFIED | PREPARING | READY
    orders: [],             // full kitchen list from server
    newCount: 0,            // bell counter — reset when user views incoming
    seenIds: new Set(),
};

const $ = sel => document.querySelector(sel);
const formatAddOns = addOns => addOns.map(addon => {
    if (typeof addon === 'string') return addon;
    return `${addon.name}${addon.quantity > 1 ? ` ×${addon.quantity}` : ''}`;
}).join(', ');

// The state machine — mirrors backend TRANSITIONS.
const NEXT = { VERIFIED: 'PREPARING', PREPARING: 'READY' };
const BACK = { PREPARING: 'VERIFIED', READY: 'PREPARING' };

const STATUS_LABEL = { VERIFIED: 'Incoming', PREPARING: 'Preparing', READY: 'Ready' };

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
    const by = { VERIFIED: 0, PREPARING: 0, READY: 0 };
    for (const o of state.orders) if (by[o.status] != null) by[o.status]++;
    $('#count-ALL').textContent       = state.orders.length;
    $('#count-VERIFIED').textContent  = by.VERIFIED;
    $('#count-PREPARING').textContent = by.PREPARING;
    $('#count-READY').textContent     = by.READY;
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

function cardActions(o) {
    const next = NEXT[o.status];
    const back = BACK[o.status];
    const parts = [];
    if (next) {
        const label = next === 'PREPARING' ? 'Start Preparing'
                    : next === 'READY'     ? 'Mark Ready'
                    : `→ ${STATUS_LABEL[next]}`;
        const cls   = next === 'READY' ? 'btn-success' : 'btn-primary';
        parts.push(`<button class="btn ${cls}" data-act="next">${label}</button>`);
    }
    if (back) {
        parts.push(`<button class="btn btn-ghost" data-act="back" title="Move back">↶ ${STATUS_LABEL[back]}</button>`);
    }
    return parts.join('');
}

function cardHtml(o, draggable = false) {
    return `
      <div class="card status-${o.status}" data-id="${o.rawId}" data-status="${o.status}"${draggable ? ' draggable="true"' : ''}>
        <div class="card-header">
          <div>
            <div class="order-id">#${o.orderId}</div>
            <div class="ts">${elapsed(o.createdAt)}</div>
          </div>
          <div class="badges">
            <span class="badge ${o.orderType === 'Dine-in' ? 'badge-dinein' : 'badge-takeout'}">
              ${o.orderType === 'Dine-in' ? '🍽 Dine-in' : '🥤 Take-out'}
            </span>
          </div>
        </div>
        <div class="card-body">
          ${o.items.map(itemRow).join('')}
        </div>
        <div class="card-actions">${cardActions(o)}</div>
      </div>`;
}

function render() {
    const board = $('#board');
    const empty = $('#empty-state');

    if (state.filter === 'ALL') {
        empty.classList.add('hidden');
        const byStatus = { VERIFIED: [], PREPARING: [], READY: [] };
        for (const o of state.orders) if (byStatus[o.status]) byStatus[o.status].push(o);
        // newest first inside each column
        for (const k of Object.keys(byStatus)) byStatus[k].reverse();

        board.innerHTML = `
          <div class="columns">
            ${['VERIFIED', 'PREPARING', 'READY'].map(s => `
              <section class="column col-${s}" data-drop="${s}">
                <div class="col-header">
                  <span class="col-title">${STATUS_LABEL[s]}</span>
                  <span class="badge badge-${s === 'VERIFIED' ? 'yellow' : s === 'PREPARING' ? 'blue' : 'green'}">${byStatus[s].length}</span>
                </div>
                <div class="col-body">
                  ${byStatus[s].map(o => cardHtml(o, true)).join('') || `<div class="empty col-empty">Drop here</div>`}
                </div>
              </section>`).join('')}
          </div>`;
        wireDnd();
    } else {
        const list = state.orders.filter(o => o.status === state.filter).reverse();
        if (!list.length) {
            board.innerHTML = '';
            empty.classList.remove('hidden');
        } else {
            empty.classList.add('hidden');
            board.innerHTML = `<div class="grid">${list.map(cardHtml).join('')}</div>`;
        }
    }

    board.querySelectorAll('.card').forEach(el => {
        const o = state.orders.find(x => String(x.rawId) === el.dataset.id);
        if (!o) return;
        el.querySelectorAll('[data-act]').forEach(btn =>
            btn.addEventListener('click', () => handleAction(btn.dataset.act, o))
        );
    });
}

/* ---------- drag & drop (ALL view only) ---------- */
// Mirror of backend TRANSITIONS — cheap client-side guard so an illegal
// drop doesn't round-trip just to receive a 409.
const ALLOWED = {
    VERIFIED:  new Set(['PREPARING']),
    PREPARING: new Set(['READY', 'VERIFIED']),
    READY:     new Set(['PREPARING']),
};

function wireDnd() {
    let dragId = null;
    let dragFrom = null;

    document.querySelectorAll('.card[draggable="true"]').forEach(card => {
        card.addEventListener('dragstart', e => {
            dragId = card.dataset.id;
            dragFrom = card.dataset.status;
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
            const ok = dragFrom === target || (ALLOWED[dragFrom] && ALLOWED[dragFrom].has(target));
            if (!ok) { col.classList.add('drop-bad'); return; }
            e.preventDefault(); // enable drop
            col.classList.add('drop-ok');
        });
        col.addEventListener('dragleave', () => col.classList.remove('drop-ok', 'drop-bad'));
        col.addEventListener('drop', e => {
            e.preventDefault();
            col.classList.remove('drop-ok', 'drop-bad');
            if (!dragId || dragFrom === target) return;
            if (!ALLOWED[dragFrom] || !ALLOWED[dragFrom].has(target)) return;

            const id = dragId;
            // Optimistic update so the card jumps instantly.
            const o = state.orders.find(x => String(x.rawId) === id);
            if (o) o.status = target;
            renderCounts();
            render();

            api.setStatus(id, target).then(refresh).catch(err => {
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

function playDing() {
    const a = $('#ding');
    if (a) a.play().catch(() => {});
}

/* ---------- wiring ---------- */
function wire() {
    $('#today').textContent = new Date().toDateString();

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

    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

wire();
refresh();

// Live push — new order verified in POS or any status change.
subscribeEvents((type, payload) => {
    clearTimeout(window.__kitchenRefreshT);
    window.__kitchenRefreshT = setTimeout(refresh, 150);

    if (type === 'change' && payload && payload.status === 'VERIFIED' && payload.source !== 'kitchen') {
        // A cashier just verified an order → new work for the kitchen.
        playDing();
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('New order for kitchen', { body: `Order queued` });
        }
    }
});

// Safety-net poll + timestamp refresh.
setInterval(refresh, 30000);
setInterval(() => { if (state.orders.length) render(); }, 15000);
