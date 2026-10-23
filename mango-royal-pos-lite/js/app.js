import { api, subscribeEvents, imageUrl } from './api.js';
import { openVerifyModal, openVoidModal, openBulkVoidModal, openWalkInModal, openEditModal, closeModal } from './modals.js';

const MAX_SELECTED_ORDERS = 10;
const state = {
    activeStatus: 'PENDING',
    orders: { PENDING: [], VERIFIED: [], VOIDED: [] },
    menu: [],
    addOns: [],
    endOfDayReceiptEnabled: false,
    search: '',
    selectedOrderIds: new Set(),
};

const peso = n => `₱${Number(n).toFixed(2)}`;
const $ = sel => document.querySelector(sel);
let suppressCardClickFor = null;
const SOUND_STORAGE_KEY = 'mango-royal-pos-sound-muted';
const alertedIncomingOrderIds = new Set();
let soundEnabled = true;
let alertAudioContext = null;
try {
    soundEnabled = localStorage.getItem(SOUND_STORAGE_KEY) !== 'muted';
} catch (error) {
    console.warn('Could not read POS sound preference:', error);
}
const formatAddOns = addOns => addOns.map(addon => {
    if (typeof addon === 'string') return addon;
    return `${addon.name}${addon.quantity > 1 ? ` ×${addon.quantity}` : ''}`;
}).join(', ');

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
          <div class="item-meta">${i.bundleQuantity > 1 ? `${i.bundleQuantity} Tall cups/bundle · ${peso(i.price)} / bundle` : `${i.size} · ${peso(i.price)} ea`}${i.addOns?.length ? ` · Add-ons: ${formatAddOns(i.addOns)}` : ''}</div>
        </div>
        <div class="item-price"><span class="item-qty">${i.bundleQuantity > 1 ? `${i.quantity} bundle${i.quantity === 1 ? '' : 's'}` : `×${i.quantity}`}</span>${peso(i.price * i.quantity)}</div>
      </div>`;
}
function renderItemRows(items) {
    if (items.length === 1) return itemRowHtml(items[0]) + `<div class="item-row item-spacer" aria-hidden="true"></div>`;
    if (items.length === 2) return items.map(itemRowHtml).join('');
    const remainingCount = items.slice(1).reduce((s, i) => s + i.quantity * (i.bundleQuantity || 1), 0);
    const remainingLines = items.length - 1;
    return itemRowHtml(items[0]) + `
      <div class="item-row item-more" title="${items.slice(1).map(i => i.bundleQuantity > 1 ? `${i.quantity} bundle(s) of ${i.bundleQuantity} Tall cups ${i.name}` : `${i.quantity}× ${i.name} (${i.size})${i.addOns?.length ? ` + ${formatAddOns(i.addOns)}` : ''}`).join(', ')}">
        <div class="item-thumb"><span class="placeholder">+${remainingLines}</span></div>
        <div class="item-info">
          <div class="item-name">+${remainingCount} more cups</div>
          <div class="item-meta">${remainingLines} additional line${remainingLines > 1 ? 's' : ''} · hover to preview</div>
        </div>
      </div>`;
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

function showPosNotification(titleText, detailText) {
    const root = $('#order-alerts');
    if (!root) return;
    const toast = document.createElement('div');
    toast.className = 'order-alert';
    const message = document.createElement('div');
    const title = document.createElement('strong');
    const detail = document.createElement('span');
    title.textContent = titleText;
    detail.textContent = detailText;
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
}

function showOrderAlert(payload) {
    const orderNumber = payload?.orderNumber || payload?.queueNumber || payload?.orderId || payload?.id;
    const detail = orderNumber ? `Order #${orderNumber} is waiting in Incoming.` : 'A new order is waiting in Incoming.';
    showPosNotification('New kiosk order', detail);
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('New kiosk order', { body: detail });
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

syncSoundToggle();
document.addEventListener('pointerdown', () => {
    unlockAlertAudio().catch(error => console.warn('Could not enable POS alert sound:', error));
}, { once: true, capture: true });
document.addEventListener('keydown', () => {
    unlockAlertAudio().catch(error => console.warn('Could not enable POS alert sound:', error));
}, { once: true, capture: true });
$('#sound-toggle')?.addEventListener('click', async () => {
    soundEnabled = !soundEnabled;
    try {
        localStorage.setItem(SOUND_STORAGE_KEY, soundEnabled ? 'enabled' : 'muted');
    } catch (error) {
        console.warn('Could not save POS sound preference:', error);
    }
    syncSoundToggle();
    if (soundEnabled) {
        try {
            await unlockAlertAudio();
            playOrderAlertSound();
        } catch (error) {
            console.warn('Could not enable POS alert sound:', error);
        }
    }
});

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

function renderSelectionToolbar(message) {
    const toolbar = $('#selection-toolbar');
    const actions = toolbar.querySelector('.selection-actions');
    const selectionCount = state.selectedOrderIds.size;
    toolbar.classList.toggle('hidden', state.activeStatus !== 'PENDING');
    actions.classList.toggle('hidden', selectionCount === 0);
    $('#selection-status').textContent = message || (selectionCount
        ? `${selectionCount} of ${MAX_SELECTED_ORDERS} pending orders selected. Tap another order to add or remove it.`
        : `Press and hold a pending order card to select it. Select up to ${MAX_SELECTED_ORDERS} orders.`);
}

function toggleOrderSelection(orderId) {
    if (state.selectedOrderIds.has(orderId)) {
        state.selectedOrderIds.delete(orderId);
    } else if (state.selectedOrderIds.size >= MAX_SELECTED_ORDERS) {
        renderSelectionToolbar(`You can select up to ${MAX_SELECTED_ORDERS} orders at a time.`);
        return;
    } else {
        state.selectedOrderIds.add(orderId);
    }
    renderSelectionToolbar();
    renderOrders();
}

function clearOrderSelection() {
    state.selectedOrderIds.clear();
    renderSelectionToolbar();
    renderOrders();
}

function renderOrders() {
    const list = state.orders[state.activeStatus].filter(o =>
        !state.search || o.orderId.toLowerCase().includes(state.search.toLowerCase())
    );
    const grid = $('#orders-grid');
    grid.innerHTML = list.map(o => `
      <div class="card ${o.status === 'PENDING' ? 'selectable' : ''} ${state.selectedOrderIds.has(Number(o.rawId)) ? 'is-selected' : ''}" data-id="${o.rawId}">
        <div class="card-header ${o.status.toLowerCase()}">
          <div class="row">
            <div>
              <div class="order-id">${o.orderId}</div>
              <div class="ts">${o.timestamp}</div>
            </div>
            <div class="badges">
              <span class="badge badge-${o.status === 'PENDING' ? 'orange' : o.status === 'VERIFIED' ? 'green' : 'gray'}">${o.status}</span>
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
        ${state.activeStatus === 'PENDING' && state.selectedOrderIds.size ? '' : `<div class="card-actions">${cardActions(o)}</div>`}
      </div>
    `).join('');
    $('#empty-state').classList.toggle('hidden', list.length !== 0);

    grid.querySelectorAll('.card').forEach(el => {
        const order = state.orders[state.activeStatus].find(o => String(o.rawId) === el.dataset.id);
        let holdTimer;
        if (order?.status === 'PENDING') {
            el.addEventListener('pointerdown', event => {
                if (event.button !== 0 || event.target.closest('button, input, a')) return;
                holdTimer = setTimeout(() => {
                    holdTimer = null;
                    if (!state.selectedOrderIds.has(Number(order.rawId))) {
                        toggleOrderSelection(Number(order.rawId));
                        suppressCardClickFor = Number(order.rawId);
                    }
                }, 500);
            });
            ['pointerup', 'pointercancel', 'pointerleave'].forEach(type =>
                el.addEventListener(type, () => {
                    if (holdTimer) clearTimeout(holdTimer);
                    holdTimer = null;
                })
            );
            el.addEventListener('click', event => {
                if (suppressCardClickFor === Number(order.rawId)) {
                    suppressCardClickFor = null;
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                if (state.activeStatus === 'PENDING' && state.selectedOrderIds.size
                    && !event.target.closest('button, input, a')) {
                    toggleOrderSelection(Number(order.rawId));
                }
            });
        }
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
        const pendingIds = new Set(state.orders.PENDING.map(order => Number(order.rawId)));
        state.selectedOrderIds.forEach(orderId => {
            if (!pendingIds.has(orderId)) state.selectedOrderIds.delete(orderId);
        });
        renderCounts();
        renderSelectionToolbar();
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

async function ensureAddOns() {
    if (!state.addOns.length) state.addOns = await api.addOns();
    return state.addOns;
}

async function loadPosFeatureSettings() {
    try {
        const settings = await api.posSettings();
        state.endOfDayReceiptEnabled = settings.endOfDayReceiptEnabled === true;
        $('#eod-receipt-btn').hidden = !state.endOfDayReceiptEnabled;
    } catch (error) {
        console.error('Failed to load POS feature settings:', error);
    }
}

function handleAction(act, order) {
    if (act === 'verify') return openVerifyModal(order, async payload => {
        try {
            const result = await api.verify(order.rawId, payload);
            closeModal();
            await refresh();
            if (result.print && !result.print.success) {
                alert(`Order verified, but automatic receipt printing failed: ${result.print.error}`);
            }
        }
        catch (e) { alert('Verify failed: ' + e.message); }
    });
    if (act === 'void') return openVoidModal(order, async reason => {
        try { await api.void(order.rawId, reason); closeModal(); await refresh(); }
        catch (e) { alert('Void failed: ' + e.message); }
    });
    if (act === 'print') {
        api.print(order.rawId)
            .then(() => showPosNotification('Receipt sent to printer', `Receipt for ${order.orderId} was sent to the printer server.`))
            .catch(e => alert('Receipt printing failed: ' + e.message));
        return;
    }
    if (act === 'reopen') {
        if (!confirm(`Move ${order.orderId} back to incoming?`)) return;
        api.reopen(order.rawId).then(refresh).catch(e => alert('Reopen failed: ' + e.message));
        return;
    }
    if (act === 'edit') {
        Promise.all([ensureMenu(), ensureAddOns()]).then(([menu, addOns]) => openEditModal(order, menu, addOns, async items => {
            try {
                const payload = items.map(i => ({ variantId: i.variantId, quantity: i.quantity, price: i.price, addOns: i.addOns || [] }));
                await api.edit(order.rawId, payload); closeModal(); await refresh();
            } catch (e) { alert('Edit failed: ' + e.message); }
        })).catch(e => alert('Unable to open order editor: ' + e.message));
    }
}

async function printSelectedOrders() {
    const orders = Array.from(state.selectedOrderIds, id =>
        state.orders.PENDING.find(order => Number(order.rawId) === id)
    ).filter(Boolean);
    if (!orders.length) return;

    const printButton = $('#bulk-print-btn');
    const voidButton = $('#bulk-void-btn');
    printButton.disabled = true;
    voidButton.disabled = true;
    const failures = [];
    let printed = 0;
    try {
        for (const [index, order] of orders.entries()) {
            $('#selection-status').textContent = `Printing order ${index + 1} of ${orders.length}: ${order.orderId}`;
            try {
                await api.print(order.rawId);
                printed += 1;
            } catch (error) {
                failures.push(`${order.orderId}: ${error.message}`);
            }
        }
    } finally {
        clearOrderSelection();
        printButton.disabled = false;
        voidButton.disabled = false;
    }
    const summary = `Printed ${printed} of ${orders.length} selected orders.`;
    if (printed) showPosNotification('Receipts sent to printer', summary);
    if (failures.length) alert(`${summary}\n\nCould not print:\n${failures.join('\n')}`);
}

function voidSelectedOrders() {
    const orders = Array.from(state.selectedOrderIds, id =>
        state.orders.PENDING.find(order => Number(order.rawId) === id)
    ).filter(Boolean);
    if (!orders.length) return;

    openBulkVoidModal(
        orders,
        (order, reason) => api.void(order.rawId, reason, true),
        () => {
            clearOrderSelection();
            refresh();
        }
    );
}

/* ---------- wiring ---------- */
function wire() {
    $('#today').textContent = new Date().toDateString();
    $('#orders-grid').addEventListener('pointerdown', () => {
        suppressCardClickFor = null;
    });

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        state.activeStatus = t.dataset.status;
        if (state.activeStatus !== 'PENDING') state.selectedOrderIds.clear();
        renderSelectionToolbar();
        renderOrders();
    }));

    $('#search').addEventListener('input', e => { state.search = e.target.value; renderOrders(); });
    $('#bulk-print-btn').addEventListener('click', printSelectedOrders);
    $('#bulk-void-btn').addEventListener('click', voidSelectedOrders);
    $('#clear-selection-btn').addEventListener('click', clearOrderSelection);
    $('#refresh-btn').addEventListener('click', () => {
        refresh();
        loadPosFeatureSettings();
    });
    $('#eod-receipt-btn').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            const result = await api.endOfDayReceipt();
            showPosNotification('End-of-Day receipt sent', `Receipt #${result.receiptId} was recorded and sent to the printer.`);
        } catch (error) {
            alert('End-of-Day Receipt failed: ' + error.message);
        } finally {
            button.disabled = false;
        }
    });

    $('#new-walkin-btn').addEventListener('click', () => {
        Promise.all([ensureMenu(), ensureAddOns()]).then(([menu, addOns]) => openWalkInModal(menu, addOns, async items => {
            try {
                const payload = items.map(i => ({
                    variantId: i.variantId,
                    quantity: i.quantity,
                    price: i.price,
                    addOns: i.addOns || [],
                }));
                await api.walkin(payload);
                closeModal();
                document.querySelector('.tab[data-status="PENDING"]').click();
                await refresh();
            } catch (e) { alert('Walk-in failed: ' + e.message); }
        })).catch(e => alert('Unable to open walk-in order: ' + e.message));
    });
}

wire();
refresh();
loadPosFeatureSettings();
window.addEventListener('focus', loadPosFeatureSettings);

// Live push from the middleware — kiosk orders arrive instantly.
subscribeEvents((type, payload) => {
    // Small debounce: coalesce bursts of events
    clearTimeout(window.__posRefreshT);
    window.__posRefreshT = setTimeout(() => refresh(), 150);
    if (type === 'new' && state.activeStatus !== 'PENDING') {
        document.querySelector('.tab[data-status="PENDING"]').classList.add('has-new');
    }
    if (type === 'new' && payload?.source === 'kiosk' && !wasOrderAlreadyAlerted(payload)) {
        showOrderAlert(payload);
        playOrderAlertSound();
    }
});

// Safety-net poll in case the SSE drops silently.
setInterval(refresh, 60000);
