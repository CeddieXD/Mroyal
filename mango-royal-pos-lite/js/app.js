import { api, subscribeEvents, imageUrl } from './api.js';
import { openVerifyModal, openVoidModal, openWalkInModal, openEditModal, closeModal } from './modals.js';

const state = {
    activeStatus: 'PENDING',
    orders: { PENDING: [], VERIFIED: [], VOIDED: [] },
    menu: [],
    search: '',
};

const peso = n => `₱${Number(n).toFixed(2)}`;
const $ = sel => document.querySelector(sel);

/**
 * Order cards show at most two rows.
 *   1 item  → single row
 *   2 items → both rows
 *   3+      → first item + "+N more items" summary row
 */
function itemRowHtml(i) {
    return `
      <div class="item-row">
        <div class="item-thumb">
          ${i.image ? `<img src="${imageUrl(i.image)}" alt="${i.name}" onerror="this.style.display='none'">` : `<span class="placeholder">—</span>`}
        </div>
        <div class="item-info">
          <div class="item-name">${i.name}</div>
          <div class="item-meta">${i.size} · ${peso(i.price)} ea</div>
        </div>
        <div class="item-price"><span class="item-qty">×${i.quantity}</span>${peso(i.price * i.quantity)}</div>
      </div>`;
}
function renderItemRows(items) {
    if (items.length === 1) return itemRowHtml(items[0]) + `<div class="item-row item-spacer" aria-hidden="true"></div>`;
    if (items.length === 2) return items.map(itemRowHtml).join('');
    const remainingCount = items.slice(1).reduce((s, i) => s + i.quantity, 0);
    const remainingLines = items.length - 1;
    return itemRowHtml(items[0]) + `
      <div class="item-row item-more" title="${items.slice(1).map(i => `${i.quantity}× ${i.name} (${i.size})`).join(', ')}">
        <div class="item-thumb"><span class="placeholder">+${remainingLines}</span></div>
        <div class="item-info">
          <div class="item-name">+${remainingCount} more items</div>
          <div class="item-meta">${remainingLines} additional line${remainingLines > 1 ? 's' : ''} · hover to preview</div>
        </div>
      </div>`;
}

/* ---------- rendering ---------- */
function renderCounts() {
    for (const s of ['PENDING', 'VERIFIED', 'VOIDED']) {
        $(`#count-${s}`).textContent = state.orders[s].length;
    }
}

function cardActions(order) {
    if (order.status === 'PENDING') {
        return `
          <button class="btn btn-success" data-act="verify">Verify</button>
          <button class="btn btn-primary" data-act="edit">Edit</button>
          <button class="btn btn-danger"  data-act="void">Void</button>`;
    }
    if (order.status === 'VERIFIED') {
        return `
          <button class="btn btn-ghost"  data-act="print">🖨 Receipt</button>
          <button class="btn btn-warn"   data-act="reopen">Move to Incoming</button>
          <button class="btn btn-danger" data-act="void">Void</button>`;
    }
    return `<div class="voided-tag">Order Voided</div>`;
}

function renderOrders() {
    const list = state.orders[state.activeStatus].filter(o =>
        !state.search || o.orderId.toLowerCase().includes(state.search.toLowerCase())
    );
    const grid = $('#orders-grid');
    grid.innerHTML = list.map(o => `
      <div class="card" data-id="${o.rawId}">
        <div class="card-header ${o.status.toLowerCase()}">
          <div class="row">
            <div>
              <div class="order-id">${o.orderId}</div>
              <div class="ts">${o.timestamp}</div>
            </div>
            <div class="badges">
              <span class="badge badge-${o.status === 'PENDING' ? 'orange' : o.status === 'VERIFIED' ? 'green' : 'gray'}">${o.status}</span>
              <span class="badge ${o.orderType === 'Dine-in' ? 'badge-dinein' : 'badge-takeout'}">${o.orderType === 'Dine-in' ? '🍽 Dine-in' : '🥤 Take-out'}</span>
            </div>
          </div>
        </div>
        <div class="card-body">
          ${renderItemRows(o.items)}
          <div class="total-row">
            <span class="label">Total</span>
            <span class="amount">${peso(o.total)}</span>
          </div>
          ${o.voidReason ? `<div class="void-reason">Reason: ${o.voidReason}</div>` : ''}
        </div>
        <div class="card-actions">${cardActions(o)}</div>
      </div>
    `).join('');
    $('#empty-state').classList.toggle('hidden', list.length !== 0);

    grid.querySelectorAll('.card').forEach(el => {
        const order = state.orders[state.activeStatus].find(o => String(o.rawId) === el.dataset.id);
        el.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => handleAction(btn.dataset.act, order)));
    });
}

/* ---------- actions ---------- */
async function loadStatus(status) {
    state.orders[status] = await api.orders(status);
}

async function refresh(status = state.activeStatus) {
    try {
        await Promise.all([loadStatus('PENDING'), loadStatus('VERIFIED'), loadStatus('VOIDED')]);
        renderCounts();
        renderOrders();
    } catch (err) {
        console.error(err);
        alert('Failed to load orders: ' + err.message);
    }
}

async function ensureMenu() {
    if (!state.menu.length) state.menu = await api.menu();
    return state.menu;
}

function handleAction(act, order) {
    if (act === 'verify') return openVerifyModal(order, async payload => {
        try { await api.verify(order.rawId, payload); closeModal(); await refresh(); }
        catch (e) { alert('Verify failed: ' + e.message); }
    });
    if (act === 'void') return openVoidModal(order, async reason => {
        try { await api.void(order.rawId, reason); closeModal(); await refresh(); }
        catch (e) { alert('Void failed: ' + e.message); }
    });
    if (act === 'print') {
        const w = window.open('', '_blank', 'width=380,height=580');
        if (!w) return window.print();
        w.document.write(`
            <html>
            <head>
                <title>Mango Royal Official Receipt</title>
                <style>
                    body { font-family: monospace; padding: 20px; font-size: 13px; text-align: center; }
                    h2 { margin: 0; font-size: 18px; }
                    p { margin: 3px 0; color: #444; }
                    .line { border-top: 1px dashed #000; margin: 10px 0; }
                    .q-num { font-size: 32px; font-weight: bold; margin: 8px 0; color: #ea580c; }
                    .items-table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
                    .items-table td { padding: 4px 0; text-align: left; }
                    .items-table td.right { text-align: right; }
                    .total-box { font-size: 14px; font-weight: bold; margin: 8px 0; }
                </style>
            </head>
            <body>
                <h2>MANGO ROYAL</h2>
                <p>Official Sales Receipt</p>
                <p>Order No: <b>${order.orderId}</b></p>
                <div class="line"></div>
                <div class="q-num">${order.orderId}</div>
                <p>Date: ${order.timestamp}</p>
                <p>Type: ${order.orderType}</p>
                <div class="line"></div>
                <table class="items-table">
                    ${order.items.map(i => `<tr><td>${i.quantity}x ${i.name} (${i.size})</td><td class="right">₱${(i.price * i.quantity).toFixed(2)}</td></tr>`).join('')}
                </table>
                <div class="line"></div>
                <div class="total-box">TOTAL AMOUNT: ₱${order.total.toFixed(2)}</div>
                ${order.discountAmount ? `<p style="color:#16a34a">Discount: -₱${order.discountAmount.toFixed(2)}</p>` : ''}
                <p>Payment: ${order.paymentMethod || 'Cash'}</p>
                <div class="line"></div>
                <p>Thank you for your purchase!</p>
                <p>Please keep this receipt for order pickup.</p>
            </body>
            </html>
        `);
        w.document.close();
        w.focus();
        setTimeout(() => { w.print(); w.close(); }, 300);
        return;
    }
    if (act === 'reopen') {
        if (!confirm(`Move ${order.orderId} back to incoming?`)) return;
        api.reopen(order.rawId).then(refresh).catch(e => alert('Reopen failed: ' + e.message));
        return;
    }
    if (act === 'edit') {
        ensureMenu().then(menu => openEditModal(order, menu, async items => {
            try {
                const payload = items.map(i => ({ variantId: i.variantId, quantity: i.quantity, price: i.price }));
                await api.edit(order.rawId, payload); closeModal(); await refresh();
            } catch (e) { alert('Edit failed: ' + e.message); }
        }));
    }
}

/* ---------- wiring ---------- */
function wire() {
    $('#today').textContent = new Date().toDateString();

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        state.activeStatus = t.dataset.status;
        renderOrders();
    }));

    $('#search').addEventListener('input', e => { state.search = e.target.value; renderOrders(); });
    $('#refresh-btn').addEventListener('click', () => refresh());
    $('#logout-btn').addEventListener('click', () => { if (confirm('Logout?')) alert('Logged out.'); });

    $('#new-walkin-btn').addEventListener('click', () => {
        ensureMenu().then(menu => openWalkInModal(menu, async (items, orderType) => {
            try {
                const payload = items.map(i => ({ variantId: i.variantId, quantity: i.quantity, price: i.price }));
                await api.walkin(payload, orderType);
                closeModal();
                document.querySelector('.tab[data-status="PENDING"]').click();
                await refresh();
            } catch (e) { alert('Walk-in failed: ' + e.message); }
        }));
    });
}

wire();
refresh();

// Live push from the middleware — kiosk orders arrive instantly.
subscribeEvents((type) => {
    // Small debounce: coalesce bursts of events
    clearTimeout(window.__posRefreshT);
    window.__posRefreshT = setTimeout(() => refresh(), 150);
    if (type === 'new' && state.activeStatus !== 'PENDING') {
        document.querySelector('.tab[data-status="PENDING"]').classList.add('has-new');
    }
});

// Safety-net poll in case the SSE drops silently.
setInterval(refresh, 60000);
