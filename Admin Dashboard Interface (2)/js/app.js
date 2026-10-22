/* ===== Mango Royal Admin — Live Functional Client ===== */

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const peso = n => '₱' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const peso2 = n => '₱' + Number(n).toFixed(2);
const hourLabel = hour => `${hour % 12 || 12} ${hour >= 12 ? 'PM' : 'AM'}`;
const dailyHourLabels = Array.from({ length: 24 }, (_, hour) => hourLabel(hour));
const DEFAULT_ADMIN_SETTINGS = {
    reportFrequency: 'daily',
    defaultFormat: 'csv',
    recipients: '',
    reportSections: {
        salesSummary: true,
        productPerformance: true,
        paymentMethods: true,
        hourlySalesTrend: false
    },
    security: { sessionTimeoutMinutes: 480 },
    appearance: { theme: 'light', accentColor: '#f97316' }
};
const ACCENT_COLORS = {
    '#f97316': { main: '#f97316', dark: '#ea580c', soft: '#fff7ed' },
    '#2563eb': { main: '#2563eb', dark: '#1d4ed8', soft: '#eff6ff' },
    '#16a34a': { main: '#16a34a', dark: '#15803d', soft: '#f0fdf4' },
    '#9333ea': { main: '#9333ea', dark: '#7e22ce', soft: '#faf5ff' }
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

// API Base URL (defaults to http://localhost:3000)
const API_BASE = window.ADMIN_API_BASE || `${window.location.protocol}//${window.location.hostname}:3000`;

/* ---------- State ---------- */
let overviewData = {
    todaySales: 0,
    totalOrders: 0,
    bestSeller: 'No sales yet',
    peakTime: 'None yet',
    averageOrderValue: 0,
    inProgressOrders: 0,
    completedOrders: 0,
    voidedOrders: 0,
    dineInOrders: 0,
    takeOutOrders: 0,
    topProducts: [],
    hourly: []
};

let recentTransactions = [];
let menuItems = [];
let salesInterval = 'month';
let overviewRequestId = 0;
let adminSettings = structuredClone(DEFAULT_ADMIN_SETTINGS);
let savedAdminSettings = structuredClone(DEFAULT_ADMIN_SETTINGS);
let adminSettingsLoaded = false;
const assistantDock = $('#royal-assistant');
let operationalMetricsAvailable = false;

const categoryLabels = {
    all: 'All Items',
    BEST_SELLERS: 'Best Sellers',
    PREMIUM: 'Premium',
    BASIC: 'Basic',
    SEASONAL: 'Seasonal'
};

let users = [
    { id:'A-001', name:'John Dela Cruz', email:'john.delacruz@mangoroyal.com', role:'Admin',         status:'Active', lastLogin:new Date() },
    { id:'C-001', name:'Carlos Reyes',   email:'carlos.reyes@mangoroyal.com',   role:'Cashier',       status:'Active', lastLogin:new Date() },
    { id:'K-001', name:'Anna Garcia',    email:'anna.garcia@mangoroyal.com',    role:'Kitchen Staff', status:'Active', lastLogin:new Date() },
];

/* ---------- Nav ---------- */
const charts = {};
$('#sales-interval')?.addEventListener('change', event => {
    salesInterval = event.target.value;
    loadOverviewData();
});
$$('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(view) {
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    const showDashboardAssistant = view === 'dashboard';
    if (!showDashboardAssistant && assistantDock.classList.contains('is-open')) {
        setAssistantOpen(false);
    }
    assistantDock.hidden = !showDashboardAssistant;
    document.body.classList.toggle('dashboard-active', showDashboardAssistant);
    if (view === 'dashboard') loadOverviewData();
    if (view === 'transactions') loadTransactionsData();
    if (view === 'menu') loadMenuData();
    if (view === 'reports') {
        if (!adminSettingsLoaded) loadAdminSettings();
        renderReports();
    }
    if (view === 'settings') loadAdminSettings();
    if (view === 'users') renderUsers();
}

/* ---------- Data Fetching (Live Backend API) ---------- */
async function loadOverviewData() {
    const requestId = ++overviewRequestId;
    const requestedInterval = salesInterval;
    try {
        const res = await fetch(`${API_BASE}/api/admin/overview?interval=${encodeURIComponent(requestedInterval)}`);
        if (requestId !== overviewRequestId) return;
        if (res.ok) {
            const data = await res.json();
            const operationalFields = [
                'averageOrderValue', 'inProgressOrders', 'completedOrders',
                'voidedOrders', 'dineInOrders', 'takeOutOrders'
            ];
            operationalMetricsAvailable = operationalFields.every(key => Number.isFinite(Number(data[key])));
            if (!operationalMetricsAvailable) {
                console.warn('Operations analytics are missing from the overview API. Restart the backend to load the latest metrics.');
            }
            overviewData = { ...overviewData, ...data };
        } else {
            console.warn(`Backend overview fetch failed (HTTP ${res.status}).`);
            salesInterval = overviewData.salesInterval || salesInterval;
            $('#sales-interval').value = salesInterval;
        }
    } catch (e) {
        if (requestId !== overviewRequestId) return;
        console.warn('Backend overview fetch failed, displaying current state', e);
        salesInterval = overviewData.salesInterval || salesInterval;
        $('#sales-interval').value = salesInterval;
    }
    renderDashboard();
}

async function loadTransactionsData() {
    try {
        const res = await fetch(`${API_BASE}/api/admin/transactions`);
        if (res.ok) {
            const data = await res.json();
            recentTransactions = (Array.isArray(data) ? data : []).map(d => ({
                ...d,
                date: new Date(d.date),
                timeServed: d.timeServed ? new Date(d.timeServed) : null,
                auditLogs: Array.isArray(d.auditLogs) ? d.auditLogs.map(log => ({
                    ...log,
                    created_at: new Date(log.created_at)
                })) : [],
                itemDetails: Array.isArray(d.itemDetails) ? d.itemDetails.map(item => ({
                    ...item,
                    auditLogs: Array.isArray(item.auditLogs) ? item.auditLogs.map(log => ({
                        ...log,
                        created_at: new Date(log.created_at)
                    })) : []
                })) : []
            }));
        }
    } catch (e) {
        console.warn('Backend transactions fetch failed', e);
    }
    renderTransactions();
}

async function loadMenuData() {
    try {
        const res = await fetch(`${API_BASE}/api/admin/menu`);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                menuItems = data;
            }
        }
    } catch (e) {
        console.warn('Backend menu fetch failed', e);
    }
    renderMenu();
}

function mergeAdminSettings(settings) {
    return {
        ...structuredClone(DEFAULT_ADMIN_SETTINGS),
        ...settings,
        reportSections: {
            ...DEFAULT_ADMIN_SETTINGS.reportSections,
            ...(settings.reportSections || {})
        },
        security: {
            ...DEFAULT_ADMIN_SETTINGS.security,
            ...(settings.security || {})
        },
        appearance: {
            ...DEFAULT_ADMIN_SETTINGS.appearance,
            ...(settings.appearance || {})
        }
    };
}

function applyAppearance(appearance) {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark', 'theme-auto');
    root.classList.add(`theme-${appearance.theme}`);
    const accent = ACCENT_COLORS[appearance.accentColor] || ACCENT_COLORS['#f97316'];
    root.style.setProperty('--brand', accent.main);
    root.style.setProperty('--brand-dark', accent.dark);
    root.style.setProperty('--brand-soft', accent.soft);
}

function applyReportSections() {
    const sectionIds = {
        salesSummary: 'report-sales-summary',
        productPerformance: 'report-product-performance',
        paymentMethods: 'report-payment-methods',
        hourlySalesTrend: 'report-hourly-trend'
    };
    for (const [key, id] of Object.entries(sectionIds)) {
        const section = document.getElementById(id);
        if (section) section.hidden = !adminSettings.reportSections[key];
    }
}

function populateSettingsForm(settings) {
    $('#setting-report-frequency').value = settings.reportFrequency;
    $('#setting-report-format').value = settings.defaultFormat;
    $('#setting-report-recipients').value = settings.recipients;
    $('#setting-session-timeout').value = settings.security.sessionTimeoutMinutes;
    $('#setting-theme').value = settings.appearance.theme;
    $$('[data-report-section]').forEach(input => {
        input.checked = settings.reportSections[input.dataset.reportSection];
    });
    $$('.swatch[data-color]').forEach(swatch => {
        swatch.classList.toggle('active', swatch.dataset.color === settings.appearance.accentColor);
    });
}

function setSettingsStatus(message, state = '') {
    const status = $('#settings-status');
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
}

async function loadAdminSettings() {
    try {
        const response = await fetch(`${API_BASE}/api/admin/settings`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        adminSettings = mergeAdminSettings(data);
        savedAdminSettings = structuredClone(adminSettings);
        adminSettingsLoaded = true;
        $('#settings-save').disabled = false;
        $('#settings-cancel').disabled = false;
        populateSettingsForm(adminSettings);
        applyAppearance(adminSettings.appearance);
        applyReportSections();
        setSettingsStatus('');
        if (document.getElementById('chart-hour') && charts.hour) renderReports();
    } catch (error) {
        console.error('Admin settings fetch failed:', error);
        setSettingsStatus(`Could not load settings: ${error.message}`, 'error');
    }
}

function readSettingsForm() {
    return {
        reportFrequency: $('#setting-report-frequency').value,
        defaultFormat: $('#setting-report-format').value,
        recipients: $('#setting-report-recipients').value,
        reportSections: Object.fromEntries($$('[data-report-section]').map(input => [
            input.dataset.reportSection,
            input.checked
        ])),
        security: {
            sessionTimeoutMinutes: Number($('#setting-session-timeout').value)
        },
        appearance: {
            theme: $('#setting-theme').value,
            accentColor: $('.swatch.active[data-color]')?.dataset.color || '#f97316'
        }
    };
}

$('#admin-settings-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = $('#settings-save');
    button.disabled = true;
    setSettingsStatus('Saving settings…');
    try {
        const response = await fetch(`${API_BASE}/api/admin/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(readSettingsForm())
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        adminSettings = mergeAdminSettings(data);
        savedAdminSettings = structuredClone(adminSettings);
        adminSettingsLoaded = true;
        populateSettingsForm(adminSettings);
        applyAppearance(adminSettings.appearance);
        applyReportSections();
        renderReports();
        setSettingsStatus('Settings saved.', 'success');
    } catch (error) {
        console.error('Admin settings save failed:', error);
        setSettingsStatus(`Could not save settings: ${error.message}`, 'error');
    } finally {
        button.disabled = !adminSettingsLoaded;
    }
});

$('#settings-cancel')?.addEventListener('click', () => {
    adminSettings = structuredClone(savedAdminSettings);
    populateSettingsForm(adminSettings);
    applyAppearance(adminSettings.appearance);
    applyReportSections();
    setSettingsStatus('Changes discarded.');
});

$('#setting-theme')?.addEventListener('change', event => {
    applyAppearance({ ...adminSettings.appearance, theme: event.target.value });
});
$$('[data-report-section]').forEach(input => {
    input.addEventListener('change', () => {
        adminSettings.reportSections[input.dataset.reportSection] = input.checked;
        applyReportSections();
    });
});

/* ---------- Dashboard ---------- */
function renderDashboard() {
    $('#stat-sales').textContent  = peso(overviewData.todaySales || 0);
    $('#stat-orders').textContent = overviewData.totalOrders || 0;
    $('#stat-best').textContent   = overviewData.bestSeller || 'No sales yet';
    $('#stat-peak').textContent   = overviewData.peakTime || 'None yet';
    const unavailableMetric = '—';
    $('#metric-average-order').textContent = operationalMetricsAvailable ? peso(overviewData.averageOrderValue) : unavailableMetric;
    $('#metric-in-progress').textContent = operationalMetricsAvailable ? overviewData.inProgressOrders : unavailableMetric;
    $('#metric-completed').textContent = operationalMetricsAvailable ? overviewData.completedOrders : unavailableMetric;
    $('#metric-voided').textContent = operationalMetricsAvailable ? overviewData.voidedOrders : unavailableMetric;

    const dineInOrders = operationalMetricsAvailable ? Number(overviewData.dineInOrders) : 0;
    const takeOutOrders = operationalMetricsAvailable ? Number(overviewData.takeOutOrders) : 0;
    const orderMixTotal = dineInOrders + takeOutOrders;
    const dineInPercent = orderMixTotal ? dineInOrders / orderMixTotal * 100 : 0;
    $('#order-mix-total').textContent = operationalMetricsAvailable
        ? `${orderMixTotal} order${orderMixTotal === 1 ? '' : 's'}`
        : 'Metrics unavailable';
    $('#mix-dine-in-count').textContent = operationalMetricsAvailable ? dineInOrders : unavailableMetric;
    $('#mix-take-out-count').textContent = operationalMetricsAvailable ? takeOutOrders : unavailableMetric;
    $('#mix-dine-in').style.width = `${dineInPercent}%`;
    $('#mix-take-out').style.width = `${100 - dineInPercent}%`;
    updateClock();

    const salesTimeline = Array.isArray(overviewData.salesTimeline) ? overviewData.salesTimeline : [];
    const salesTotal = salesTimeline.reduce((sum, point) => sum + Number(point.sales || 0), 0);
    const orderTotal = salesTimeline.reduce((sum, point) => sum + Number(point.orders || 0), 0);
    const displayedInterval = overviewData.salesInterval || salesInterval;
    const intervalLabels = { day: 'today', week: 'the last 7 days', month: 'month to date', year: 'year to date' };
    $('#sales-chart-summary').textContent =
        `${intervalLabels[displayedInterval] || 'selected interval'} · ${peso(salesTotal)} sales · ${orderTotal} orders`;
    const salesLabels = salesTimeline.map(point => point.label);
    const intervalSales = salesTimeline.map(point => Number(point.sales || 0));
    const intervalOrders = salesTimeline.map(point => Number(point.orders || 0));

    // 1. Sales Analytics Line Chart
    destroyChart('sales');
    const salesChartOptions = chartBase();
    salesChartOptions.scales.y.title = { display: true, text: 'Sales (₱)' };
    salesChartOptions.scales.y.ticks.callback = value => peso(value);
    salesChartOptions.scales.orders = {
        beginAtZero: true,
        position: 'right',
        title: { display: true, text: 'Orders' },
        ticks: { precision: 0, color: '#3b82f6', font: { size: 11 } },
        grid: { drawOnChartArea: false }
    };
    salesChartOptions.plugins.tooltip = {
        callbacks: {
            label: context => context.dataset.yAxisID === 'orders'
                ? `Orders: ${Number(context.parsed.y).toLocaleString('en-US')}`
                : `Sales: ${peso(context.parsed.y)}`
        }
    };
    charts.sales = new Chart($('#chart-sales'), {
        type: 'line',
        data: {
            labels: salesLabels,
            datasets: [
                {
                    label: 'Sales (₱)',
                    yAxisID: 'y',
                    data: intervalSales,
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.08)',
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2.5,
                    pointRadius: (ctx) => (intervalSales[ctx.dataIndex] > 0 ? 4 : 2)
                },
                {
                    label: 'Orders Count',
                    yAxisID: 'orders',
                    data: intervalOrders,
                    borderColor: '#3b82f6',
                    backgroundColor: 'transparent',
                    borderDash: [4, 4],
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: (ctx) => (intervalOrders[ctx.dataIndex] > 0 ? 3 : 1)
                }
            ]
        },
        options: salesChartOptions
    });

    // 2. Items Sold Today Bar Chart (Real items from DB)
    destroyChart('items');
    const topItems = (overviewData.topProducts || []);
    const itemNames = topItems.length ? topItems.map(d => d.name) : ['No items sold yet'];
    const itemCounts = topItems.length ? topItems.map(d => d.sold) : [0];

    charts.items = new Chart($('#chart-items'), {
        type: 'bar',
        data: {
            labels: itemNames,
            datasets: [{
                label: 'Quantity Sold',
                data: itemCounts,
                backgroundColor: '#f97316',
                borderRadius: 6,
                maxBarThickness: 36
            }]
        },
        options: chartBase()
    });
}

function updateClock() {
    const now = new Date();
    const t = $('#w-time'); const d = $('#w-date');
    if (t) t.textContent = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
    if (d) d.textContent = now.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}
setInterval(updateClock, 1000);

function chartBase() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top',
                align: 'end',
                labels: { boxWidth: 12, font: { size: 11 } }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    font: { size: 11 },
                    color: '#64748b',
                    precision: 0
                },
                grid: { color: '#f1f5f9' }
            },
            x: {
                ticks: {
                    font: { size: 10 },
                    color: '#64748b',
                    maxRotation: 30,
                    minRotation: 0
                },
                grid: { display: false }
            }
        }
    };
}
function destroyChart(k) { if (charts[k]) { charts[k].destroy(); charts[k] = null; } }

/* ---------- Transactions ---------- */
const txState = { search:'', status:'all', payment:'all', time:'all', day:'all', expanded:null, auditItem:null };
['tx-search','tx-status','tx-payment','tx-time','tx-day'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) { txState[id.slice(3)] = e.target.value; renderTransactions(); } });
    document.addEventListener('change', e => { if (e.target.id === id) { txState[id.slice(3)] = e.target.value; renderTransactions(); } });
});

function filterTransactions() {
    return recentTransactions.filter(t => {
        const q = txState.search.toLowerCase();
        if (q && !t.id.toLowerCase().includes(q) && !t.items.some(i => i.toLowerCase().includes(q))) return false;
        if (txState.status !== 'all' && t.status !== txState.status) return false;
        if (txState.payment !== 'all' && t.paymentMethod !== txState.payment) return false;
        if (txState.time !== 'all') {
            const now = new Date(); const td = t.date;
            const h = td.getHours();
            if (txState.time === 'today' && td.toDateString() !== now.toDateString()) return false;
            if (txState.time === 'yesterday') { const y = new Date(now); y.setDate(y.getDate()-1); if (td.toDateString() !== y.toDateString()) return false; }
            if (txState.time === 'last7days') { const s = new Date(now); s.setDate(s.getDate()-7); if (td < s) return false; }
            if (txState.time === 'last30days') { const s = new Date(now); s.setDate(s.getDate()-30); if (td < s) return false; }
            if (txState.time === 'morning' && !(h>=6 && h<12)) return false;
            if (txState.time === 'afternoon' && !(h>=12 && h<18)) return false;
            if (txState.time === 'evening' && !(h>=18 || h<6)) return false;
        }
        if (txState.day !== 'all' && String(t.date.getDay()) !== txState.day) return false;
        return true;
    });
}

function auditEntryHtml(entry) {
    const eventLabels = {
        ITEM_CREATED: 'Added to order',
        BASELINE_IMPORTED: 'Baseline recorded',
        ITEM_ADDED: 'Item added',
        ITEM_UPDATED: 'Item edited',
        ITEM_REMOVED: 'Item removed',
        STATUS_CHANGED: 'Order status changed'
    };
    const quantity = value => value == null ? '—' : `×${Number(value)}`;
    const price = value => value == null ? '—' : peso2(Number(value));
    let change;
    if (entry.action === 'STATUS_CHANGED') {
        change = `${escapeHtml(entry.previous_status || 'Unknown')} → ${escapeHtml(entry.new_status || 'Unknown')}`;
    } else if (entry.action === 'ITEM_CREATED' || entry.action === 'BASELINE_IMPORTED' || entry.action === 'ITEM_ADDED') {
        change = `${entry.new_status ? `${escapeHtml(entry.new_status)} · ` : ''}${quantity(entry.new_quantity)} · ${price(entry.new_price)} each`;
    } else if (entry.action === 'ITEM_REMOVED') {
        change = `${quantity(entry.previous_quantity)} · ${price(entry.previous_price)} each`;
    } else {
        change = `Quantity ${quantity(entry.previous_quantity)} → ${quantity(entry.new_quantity)} · Unit price ${price(entry.previous_price)} → ${price(entry.new_price)}`;
    }
    const createdAt = entry.created_at instanceof Date && !Number.isNaN(entry.created_at.getTime())
        ? entry.created_at.toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' })
        : 'Time not recorded';
    return `<li class="item-audit-entry">
        <span class="item-audit-dot" aria-hidden="true"></span>
        <div class="item-audit-copy">
            <div><b>${escapeHtml(eventLabels[entry.action] || entry.action || 'Order activity')}</b><span>${change}</span></div>
            <small>${escapeHtml(entry.source || 'System')}${entry.actor ? ` · ${escapeHtml(entry.actor)}` : ''} · ${escapeHtml(createdAt)}</small>
        </div>
    </li>`;
}

function renderTransactions() {
    const list = filterTransactions();
    const total = list.reduce((s,t) => s + (t.status !== 'Void' ? t.total : 0), 0);
    $('#tx-count').textContent = list.length;
    $('#tx-total').textContent = peso(total);
    $('#tx-avg').textContent   = peso(list.length ? Math.round(total/list.length) : 0);

    const tbody = $('#tx-table tbody');
    tbody.innerHTML = list.map(t => {
        const pillCls = (t.status||'').toLowerCase();
        const expanded = txState.expanded === t.id;
        const detailId = `tx-details-${t.rawId}`;
        let row = `<tr>
            <td><b>${t.id}</b></td>
            <td>${t.date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} ${t.date.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</td>
            <td>${t.cashierId}</td>
            <td>${t.items.join(', ')}</td>
            <td><b>${peso2(t.total)}</b></td>
            <td>${peso2(t.amountChange||0)}</td>
            <td><span class="pill ${pillCls}">${t.status}</span></td>
            <td style="text-align:center"><button class="icon-btn" data-tx="${t.id}" title="${expanded ? 'Hide' : 'View'} order details" aria-label="${expanded ? 'Hide' : 'View'} details for order ${escapeHtml(t.id)}" aria-expanded="${expanded}" aria-controls="${detailId}">${expanded?'▲':'▼'}</button></td>
        </tr>`;
        if (expanded) {
            const orderItems = Array.isArray(t.itemDetails) ? t.itemDetails : [];
            const orderDate = t.date.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
            const orderTime = t.date.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
            const servedTime = t.timeServed
                ? t.timeServed.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true })
                : 'Not recorded';
            const discountAmount = t.discount ? Number(t.discount.amount || 0) : 0;
            const itemRows = orderItems.map(item => {
                const name = escapeHtml(item.name || 'Menu item');
                const size = escapeHtml(item.size_name || '');
                const quantity = Number(item.quantity) || 0;
                const unitPrice = Number(item.price_at_purchase) || 0;
                const auditKey = `${t.rawId}-${item.variant_id}`;
                const auditId = `tx-audit-${t.rawId}-${item.variant_id}`;
                const auditExpanded = txState.auditItem === auditKey;
                const itemAuditLogs = Array.isArray(item.auditLogs) ? item.auditLogs : [];
                return `<div class="order-item-row">
                    <div class="order-item-name">
                        <div class="order-item-title"><b>${name}</b><button class="icon-btn item-audit-toggle" data-item-audit="${escapeHtml(auditKey)}" title="View item edit history" aria-label="View edit history for ${name}" aria-expanded="${auditExpanded}" aria-controls="${auditId}">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12z"/></svg>
                        </button></div>
                        <span>${size ? `${size} · ` : ''}${peso2(unitPrice)} each</span>
                        ${Array.isArray(item.add_ons) && item.add_ons.length ? `<span>Add-ons: ${item.add_ons.map(addon => escapeHtml(typeof addon === 'string' ? addon : `${addon.name}${addon.quantity > 1 ? ` ×${addon.quantity}` : ''}`)).join(', ')}</span>` : ''}
                        <ol class="item-audit-list" id="${auditId}"${auditExpanded ? '' : ' hidden'}>${itemAuditLogs.length ? itemAuditLogs.slice().reverse().map(auditEntryHtml).join('') : '<li class="item-audit-empty">No item activity recorded.</li>'}</ol>
                    </div>
                    <span class="order-item-qty">× ${quantity}</span>
                    <b class="order-item-total">${peso2(unitPrice * quantity)}</b>
                </div>`;
            }).join('');
            const activeVariants = new Set(orderItems.map(item => Number(item.variant_id)));
            const removedItemLogs = (Array.isArray(t.auditLogs) ? t.auditLogs : [])
                .filter(log => log.variant_id != null && !activeVariants.has(Number(log.variant_id)));
            const removedGroups = new Map();
            removedItemLogs.forEach(log => {
                const key = String(log.variant_id);
                if (!removedGroups.has(key)) removedGroups.set(key, { name: log.product_name, size: log.size_name, logs: [] });
                removedGroups.get(key).logs.push(log);
            });
            const removedItemActivity = Array.from(removedGroups.values()).map(group => `
                <div class="removed-item-audit">
                    <b>${escapeHtml(group.name)}${group.size ? ` · ${escapeHtml(group.size)}` : ''}</b>
                    <ol class="item-audit-list">${group.logs.slice().reverse().map(auditEntryHtml).join('')}</ol>
                </div>
            `).join('');
            const statusClass = escapeHtml(String(t.status || '').toLowerCase().replace(/[^a-z0-9-]/g, ''));
            row += `<tr class="detail-row"><td colspan="8">
                <section class="order-detail" id="${detailId}" aria-label="Details for order ${escapeHtml(t.id)}">
                    <div class="order-detail-head">
                        <div>
                            <span class="order-detail-eyebrow">ORDER SUMMARY</span>
                            <h3>Order ${escapeHtml(t.id)}</h3>
                            <p>${escapeHtml(orderDate)} <span aria-hidden="true">·</span> ${escapeHtml(orderTime)}</p>
                        </div>
                        <span class="pill ${statusClass}">${escapeHtml(t.status || 'Unknown')}</span>
                    </div>
                    <div class="order-detail-layout">
                        <section class="order-items-panel" aria-label="Items in this order">
                            <div class="order-section-head">
                                <h4>Items ordered</h4>
                                <span>${orderItems.length} line${orderItems.length === 1 ? '' : 's'}</span>
                            </div>
                            <div class="order-item-list">
                                ${itemRows || '<p class="order-no-items">No item details were recorded for this order.</p>'}
                            </div>
                            ${removedItemActivity ? `<section class="removed-audit-section" aria-label="Removed item history"><div class="order-section-head"><h4>Removed item history</h4></div>${removedItemActivity}</section>` : ''}
                            <div class="order-totals">
                                <div><span>Subtotal</span><b>${peso2(t.subtotal ?? t.total)}</b></div>
                                ${t.discount ? `<div class="order-discount"><span>${escapeHtml(t.discount.type)} discount</span><b>−${peso2(discountAmount)}</b></div>` : ''}
                                <div class="order-grand-total"><span>Order total</span><b>${peso2(t.total)}</b></div>
                                <div><span>Change</span><b>${peso2(t.amountChange || 0)}</b></div>
                            </div>
                        </section>
                        <section class="order-info-panel" aria-label="Order information">
                            <div class="order-section-head"><h4>Order information</h4></div>
                            <dl class="order-info-list">
                                <div><dt>Payment method</dt><dd>${escapeHtml(t.paymentMethod || 'Not recorded')}</dd></div>
                                <div><dt>Order source</dt><dd>${escapeHtml(t.cashierId || 'Not recorded')}</dd></div>
                                <div><dt>Order type</dt><dd>${escapeHtml(t.orderType || 'Not recorded')}</dd></div>
                                <div><dt>Last updated</dt><dd>${escapeHtml(servedTime)}</dd></div>
                                ${t.voidReason ? `<div class="order-void-reason"><dt>Void reason</dt><dd>${escapeHtml(t.voidReason.type)}</dd></div>` : ''}
                            </dl>
                        </section>
                    </div>
                </section>
            </td></tr>`;
        }
        return row;
    }).join('');

    $('#tx-empty').hidden = list.length > 0;
    tbody.querySelectorAll('[data-tx]').forEach(b => b.addEventListener('click', () => {
        txState.expanded = txState.expanded === b.dataset.tx ? null : b.dataset.tx;
        txState.auditItem = null;
        renderTransactions();
    }));
    tbody.querySelectorAll('[data-item-audit]').forEach(b => b.addEventListener('click', () => {
        txState.auditItem = txState.auditItem === b.dataset.itemAudit ? null : b.dataset.itemAudit;
        renderTransactions();
    }));
}

// Export Transactions CSV
$('#export-tx-btn')?.addEventListener('click', () => {
    const list = filterTransactions();
    if (!list.length) return alert('No transactions to export.');
    let csv = 'Order ID,Date,Cashier,Items,Total,Change,Status,Payment Method\n';
    list.forEach(t => {
        csv += `"${t.id}","${t.date.toISOString()}","${t.cashierId}","${t.items.join('; ')}",${t.total},${t.amountChange||0},"${t.status}","${t.paymentMethod}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions_${Date.now()}.csv`;
    a.click();
});

/* ---------- Menu Management ---------- */
let menuCategory = 'all';
function renderMenu() {
    const chips = ['all','BEST_SELLERS','PREMIUM','BASIC','SEASONAL'];
    $('#menu-chips').innerHTML = chips.map(c => {
        const count = c === 'all' ? menuItems.length : menuItems.filter(i => i.category === c).length;
        return `<button class="chip ${menuCategory===c?'active':''}" data-cat="${c}" aria-pressed="${menuCategory===c}">${escapeHtml(categoryLabels[c])} <span class="count">${count}</span></button>`;
    }).join('');
    $$('#menu-chips .chip').forEach(b => b.addEventListener('click', () => { menuCategory = b.dataset.cat; renderMenu(); }));

    const list = menuCategory === 'all' ? menuItems : menuItems.filter(i => i.category === menuCategory);
    const resultCount = $('#menu-result-count');
    if (resultCount) resultCount.textContent = `${list.length} ${list.length === 1 ? 'item' : 'items'}`;

    if (list.length === 0) {
        $('#menu-grid').innerHTML = `<div class="menu-empty"><span class="menu-empty-icon" aria-hidden="true">◇</span><strong>No menu items yet</strong><span>There are no products in this category.</span></div>`;
        return;
    }

    $('#menu-grid').innerHTML = list.map(i => {
        const imgSrc = i.image ? (i.image.startsWith('http') ? i.image : `${API_BASE}/images/${i.image}`) : 'MangoRoyal.png';
        return `
        <article class="menu-card ${i.available ? '' : 'unavailable'}">
            <div class="menu-card-image">
                <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(i.name)}" loading="lazy" onerror="this.onerror=null;this.src='MangoRoyal.png';">
                <span class="menu-availability ${i.available ? 'is-available' : 'is-unavailable'}">
                    <span class="availability-dot" aria-hidden="true"></span>${i.available ? 'Available' : 'Out of stock'}
                </span>
            </div>
            <div class="menu-body">
                <span class="menu-cat">${escapeHtml(categoryLabels[i.category] || i.category)}</span>
                <h3 class="menu-name">${escapeHtml(i.name)}</h3>
                <p class="menu-desc">${escapeHtml(i.description || 'No description provided.')}</p>
                <div class="menu-price">
                    <span><span class="price-size">Tall</span><b>${peso(i.price?.tall || 0)}</b></span>
                    <span><span class="price-size">Grande</span><b>${peso(i.price?.grande || 0)}</b></span>
                </div>
            </div>
            <div class="menu-actions">
                <button class="menu-action-toggle ${i.available ? '' : 'is-unavailable'}" data-toggle="${escapeHtml(i.id)}" aria-label="Mark ${escapeHtml(i.name)} ${i.available ? 'out of stock' : 'available'}">
                    <span aria-hidden="true">${i.available ? '●' : '○'}</span>${i.available ? 'Available' : 'Unavailable'}
                </button>
                <button class="menu-action-edit" data-edit="${escapeHtml(i.id)}" aria-label="Edit ${escapeHtml(i.name)}">Edit</button>
                <button class="menu-action-delete" data-del="${escapeHtml(i.id)}" aria-label="Delete ${escapeHtml(i.name)}" title="Delete item"><span aria-hidden="true">×</span></button>
            </div>
        </article>
        `;
    }).join('');

    // Toggle Availability (persists to DB via API)
    $$('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
        const id = b.dataset.toggle;
        const it = menuItems.find(x => x.id === id);
        if (!it) return;
        it.available = !it.available;
        renderMenu();

        try {
            await fetch(`${API_BASE}/api/admin/menu/${id}/toggle`, { method: 'PATCH' });
        } catch (e) {
            console.warn('Toggle failed on server', e);
        }
    }));

    // Edit Item Modal
    $$('[data-edit]').forEach(b => b.addEventListener('click', () => openMenuModal(menuItems.find(x => x.id === b.dataset.edit))));

    // Delete Item
    $$('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const id = b.dataset.del;
        const it = menuItems.find(x => x.id === id);
        if (confirm(`Are you sure you want to delete "${it.name}"?`)) {
            menuItems = menuItems.filter(x => x.id !== id);
            renderMenu();
            try {
                await fetch(`${API_BASE}/api/admin/menu/${id}`, { method: 'DELETE' });
            } catch (e) {
                console.warn('Delete failed on server', e);
            }
        }
    }));
}
$('#menu-add').addEventListener('click', () => openMenuModal(null));

function openMenuModal(item) {
    const isNew = !item;
    const it = item || { id:'', name:'', description:'', category:'BEST_SELLERS', price:{tall:120,grande:145}, available:true, image:'MangoRoyal.png' };
    const existingImage = it.image
        ? (it.image.startsWith('http')
            ? it.image
            : `${API_BASE}/images/${encodeURIComponent(it.image.replace(/^\/?images\//, ''))}`)
        : `${API_BASE}/images/MangoRoyal.png`;
    openModal(`${isNew ? 'Add New' : 'Edit'} Menu Item`, `
        <div class="form-grid">
            <label class="span2">Product Name<input id="m-name" value="${escapeHtml(it.name)}" placeholder="e.g. Mango Caramel"></label>
            <label class="span2">Description<input id="m-desc" value="${escapeHtml(it.description||'')}" placeholder="Short product summary"></label>
            <label>Category<select id="m-cat">
                ${['BEST_SELLERS','PREMIUM','BASIC','SEASONAL'].map(c => `<option value="${c}" ${c===it.category?'selected':''}>${categoryLabels[c]}</option>`).join('')}
            </select></label>
            <div class="menu-image-upload span2">
                <label for="m-image-file">Product image</label>
                <div class="menu-image-upload-row">
                    <img id="m-image-preview" src="${escapeHtml(existingImage)}" alt="Current product image">
                    <div class="menu-image-upload-controls">
                        <input id="m-image-file" type="file" accept="image/png,image/jpeg,image/webp">
                        <span id="m-image-name" class="menu-image-name">${escapeHtml(it.image || 'MangoRoyal.png')}</span>
                        <small>PNG, JPG, or WebP · up to 10 MB. Stored in the shared product image assets.</small>
                    </div>
                </div>
            </div>
            <label>Tall Price (₱)<input type="number" id="m-tall" value="${it.price?.tall||120}"></label>
            <label>Grande Price (₱)<input type="number" id="m-grande" value="${it.price?.grande||145}"></label>
            <label class="span2" style="flex-direction:row;align-items:center;gap:10px">
                <input type="checkbox" id="m-avail" ${it.available?'checked':''} style="width:18px;height:18px"> 
                <span>Mark as Available for Ordering</span>
            </label>
            <p id="m-error" class="menu-image-error span2" role="alert"></p>
        </div>
    `, [
        { label:'Cancel', cls:'btn-ghost', action: closeModal },
        { label:'Save Item', cls:'btn-primary', action: async () => {
            const name = $('#m-name').value.trim();
            if (!name) return alert('Product name is required');
            const saveButton = $('#modal [data-mb="1"]');
            const error = $('#m-error');
            saveButton.disabled = true;
            error.textContent = '';
            try {
                let image = it.image || 'MangoRoyal.png';
                const selectedFile = $('#m-image-file').files[0];
                if (selectedFile) {
                    const formData = new FormData();
                    formData.append('image', selectedFile);
                    const uploadResponse = await fetch(`${API_BASE}/api/admin/menu/images`, {
                        method: 'POST',
                        body: formData,
                    });
                    const uploadResult = await uploadResponse.json().catch(() => ({}));
                    if (!uploadResponse.ok) {
                        throw new Error(uploadResult.error || `Image upload failed (HTTP ${uploadResponse.status}).`);
                    }
                    image = uploadResult.filename;
                }
                const updated = {
                    name,
                    description: $('#m-desc').value.trim(),
                    category: $('#m-cat').value,
                    image,
                    price: { tall: +$('#m-tall').value || 120, grande: +$('#m-grande').value || 145 },
                    available: $('#m-avail').checked,
                };

                if (isNew) {
                    const response = await fetch(`${API_BASE}/api/admin/menu`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updated)
                    });
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok) throw new Error(result.error || `Save failed (HTTP ${response.status}).`);
                    updated.id = String(result.product_id);
                    menuItems.push(updated);
                } else {
                    updated.id = it.id;
                    const response = await fetch(`${API_BASE}/api/admin/menu/${it.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updated)
                    });
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok) throw new Error(result.error || `Update failed (HTTP ${response.status}).`);
                    menuItems = menuItems.map(x => x.id === it.id ? updated : x);
                }
                closeModal();
                renderMenu();
            } catch (e) {
                error.textContent = e.message || 'Could not save the menu item.';
            } finally {
                if (saveButton.isConnected) saveButton.disabled = false;
            }
        }}
    ]);
    const imageInput = $('#m-image-file');
    imageInput.addEventListener('change', () => {
        const file = imageInput.files[0];
        if (!file) return;
        const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
        const error = $('#m-error');
        if (!allowedTypes.includes(file.type) || file.size > 10 * 1024 * 1024) {
            imageInput.value = '';
            error.textContent = file.size > 10 * 1024 * 1024
                ? 'Image must be 10 MB or smaller.'
                : 'Choose a PNG, JPG, or WebP image.';
            return;
        }
        error.textContent = '';
        $('#m-image-name').textContent = file.name;
        const preview = $('#m-image-preview');
        const previewUrl = URL.createObjectURL(file);
        preview.onload = () => {
            URL.revokeObjectURL(previewUrl);
            preview.onload = null;
        };
        preview.src = previewUrl;
    });
}

/* ---------- Reports ---------- */
function renderReports() {
    applyReportSections();
    const list = (overviewData.topProducts || []);
    const totalSales = overviewData.todaySales || 0;
    const totalOrders = overviewData.totalOrders || 0;
    const avgVal = Number(overviewData.averageOrderValue || 0);
    const paymentMethods = Array.isArray(overviewData.paymentMethods) ? overviewData.paymentMethods : [];

    $('#rep-total-sales').textContent = peso(totalSales);
    $('#rep-total-tx').textContent    = totalOrders;
    $('#rep-avg-val').textContent     = peso(avgVal);

    if (list.length > 0) {
        const top = list[0];
        const low = list[list.length - 1];
        $('#rep-top-name').textContent = top.name;
        $('#rep-top-sub').textContent  = `${top.sold} units sold · ${peso(top.revenue)}`;
        $('#rep-low-name').textContent = low.name;
        $('#rep-low-sub').textContent  = `${low.sold} units sold · ${peso(low.revenue)}`;

        $('#rep-table tbody').innerHTML = list.map((p,i) => `
            <tr>
                <td><b>#${i+1}</b></td>
                <td>${p.name}</td>
                <td><b>${p.sold}</b></td>
                <td>${peso(p.revenue)}</td>
                <td><div class="perf-bar"><div style="width:${Math.round((p.sold / top.sold) * 100)}%"></div></div></td>
            </tr>
        `).join('');
    } else {
        $('#rep-top-name').textContent = 'None yet';
        $('#rep-top-sub').textContent  = '0 units sold';
        $('#rep-low-name').textContent = 'None yet';
        $('#rep-low-sub').textContent  = '0 units sold';
        $('#rep-table tbody').innerHTML = `<tr><td colspan="5" class="empty">No sales data recorded yet. Place orders via Kiosk/POS to generate reports.</td></tr>`;
    }

    $('#rep-payment-table tbody').innerHTML = paymentMethods.length
        ? paymentMethods.map(payment => `
            <tr><td>${escapeHtml(payment.method || 'Unknown')}</td>
                <td>${Number(payment.transactions) || 0}</td>
                <td>${peso(payment.sales || 0)}</td></tr>
        `).join('')
        : '<tr><td colspan="3" class="empty">No payment transactions recorded today.</td></tr>';

    destroyChart('hour');
    const hoursLabels = dailyHourLabels;
    const hourlySales = hoursLabels.map((_, hour) => {
        const match = overviewData.hourly?.find(item => Number(item.hour) === hour || item.time === hourLabel(hour));
        return match ? Number(match.sales) : 0;
    });
    const hourlyOrders = hoursLabels.map((_, hour) => {
        const match = overviewData.hourly?.find(item => Number(item.hour) === hour || item.time === hourLabel(hour));
        return match ? Number(match.orders) : 0;
    });

    const reportChartOptions = chartBase();
    reportChartOptions.scales.y.title = { display: true, text: 'Sales (₱)' };
    reportChartOptions.scales.orders = {
        beginAtZero: true,
        position: 'right',
        title: { display: true, text: 'Orders' },
        ticks: { precision: 0, color: '#3B82F6' },
        grid: { drawOnChartArea: false }
    };
    charts.hour = new Chart($('#chart-hour'), {
        type: 'bar',
        data: {
            labels: hoursLabels,
            datasets: [
                { label:'Sales (₱)', yAxisID:'y', data: hourlySales,  backgroundColor:'#F97316', borderRadius: 4, maxBarThickness: 28 },
                { label:'Orders',    yAxisID:'orders', data: hourlyOrders, backgroundColor:'#3B82F6', borderRadius: 4, maxBarThickness: 28 },
            ]
        },
        options: reportChartOptions
    });

    // Dynamic Key Insights based on real orders
    const insSales = $('#ins-sales');
    const insSalesTag = $('#ins-sales-tag');
    const insPeak = $('#ins-peak');
    const insPeakTag = $('#ins-peak-tag');
    const insTop = $('#ins-top');
    const insTopTag = $('#ins-top-tag');
    const insStaff = $('#ins-staff');
    const insStaffTag = $('#ins-staff-tag');

    if (totalOrders > 0) {
        if (insSales) insSales.textContent = `Today's revenue is ${peso(totalSales)} across ${totalOrders} order(s) with an average ticket size of ${peso(avgVal)}.`;
        if (insSalesTag) { insSalesTag.textContent = 'Active Revenue'; insSalesTag.className = 'tag green'; }

        if (insPeak) insPeak.textContent = `Most order activity recorded during: ${overviewData.peakTime || 'recent hours'}.`;
        if (insPeakTag) { insPeakTag.textContent = overviewData.peakTime || 'Active Shift'; insPeakTag.className = 'tag orange'; }

        const topItem = list.length ? list[0] : null;
        if (insTop && topItem) insTop.textContent = `${topItem.name} leads product sales with ${topItem.sold} unit(s) generating ${peso(topItem.revenue)}.`;
        if (insTopTag && topItem) { insTopTag.textContent = topItem.name; insTopTag.className = 'tag purple'; }

        if (insStaff) insStaff.textContent = `Kitchen order transitions are smooth. Maintain preparation readiness during ${overviewData.peakTime || 'active periods'}.`;
        if (insStaffTag) { insStaffTag.textContent = 'Optimal Prep'; insStaffTag.className = 'tag blue'; }
    } else {
        if (insSales) insSales.textContent = 'No sales recorded yet for today. Start placing customer orders to view trends.';
        if (insSalesTag) { insSalesTag.textContent = 'Awaiting Orders'; insSalesTag.className = 'tag orange'; }

        if (insPeak) insPeak.textContent = 'Peak traffic will automatically be calculated as orders come in throughout the day.';
        if (insPeakTag) { insPeakTag.textContent = 'No Peak Yet'; insPeakTag.className = 'tag orange'; }

        if (insTop) insTop.textContent = 'Top performing items will appear here once orders are verified.';
        if (insTopTag) { insTopTag.textContent = 'Pending Data'; insTopTag.className = 'tag purple'; }

        if (insStaff) insStaff.textContent = 'Kitchen and Cashier POS are linked and ready to receive customer orders.';
        if (insStaffTag) { insStaffTag.textContent = 'Ready'; insStaffTag.className = 'tag green'; }
    }
}

// End-of-Day (Z-Reading) Report
$('#eod-report-btn')?.addEventListener('click', () => {
    const totalSales = overviewData.todaySales || 0;
    const totalOrders = overviewData.totalOrders || 0;
    const avgVal = totalOrders ? (totalSales / totalOrders).toFixed(2) : '0.00';
    const top = overviewData.topProducts || [];
    
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) return alert('Popups blocked. Please allow popups to view the End-of-Day report.');
    w.document.write(`
        <html>
        <head>
            <title>Mango Royal - End of Day Report (Z-Reading)</title>
            <style>
                body { font-family: monospace; padding: 24px; font-size: 13px; color: #111; }
                h2 { margin: 0; text-align: center; font-size: 18px; }
                p { margin: 4px 0; text-align: center; }
                .line { border-top: 1px dashed #333; margin: 12px 0; }
                .row { display: flex; justify-content: space-between; padding: 3px 0; }
                .bold { font-weight: bold; }
                .header-box { text-align: center; margin-bottom: 8px; }
            </style>
        </head>
        <body>
            <div class="header-box">
                <h2>MANGO ROYAL</h2>
                <p>END-OF-DAY FINANCIAL SUMMARY (Z-READING)</p>
                <p>Date Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
            </div>
            <div class="line"></div>
            <div class="row bold"><span>METRIC</span><span>VALUE</span></div>
            <div class="line"></div>
            <div class="row"><span>Total Completed Orders:</span><span>${totalOrders}</span></div>
            <div class="row bold"><span>Gross Sales Revenue:</span><span>₱${Number(totalSales).toFixed(2)}</span></div>
            <div class="row"><span>Average Ticket Size:</span><span>₱${avgVal}</span></div>
            <div class="row"><span>Peak Time Window:</span><span>${overviewData.peakTime || 'N/A'}</span></div>
            <div class="line"></div>
            <div class="bold" style="margin-bottom:6px">ITEM BREAKDOWN:</div>
            ${top.length ? top.map(p => `<div class="row"><span>${p.name} (x${p.sold})</span><span>₱${Number(p.revenue).toFixed(2)}</span></div>`).join('') : '<div class="row"><span>No items sold today</span><span>₱0.00</span></div>'}
            <div class="line"></div>
            <div class="row bold"><span>NET REGISTER TOTAL:</span><span>₱${Number(totalSales).toFixed(2)}</span></div>
            <div class="line"></div>
            <p style="font-size:11px;color:#555">Official System Generated Audit Document<br>Generated by Admin Dashboard</p>
            <div style="text-align:center;margin-top:20px;">
                <button onclick="window.print()" style="padding:8px 18px;font-weight:bold;cursor:pointer;">🖨 Print / Save as PDF</button>
            </div>
        </body>
        </html>
    `);
    w.document.close();
});

function getReportExportData() {
    const sections = adminSettings.reportSections;
    const report = { generatedAt: new Date().toISOString() };
    if (sections.salesSummary) {
        report.salesSummary = {
            sales: Number(overviewData.todaySales || 0),
            transactions: Number(overviewData.totalOrders || 0),
            averageOrderValue: Number(overviewData.averageOrderValue || 0)
        };
    }
    if (sections.productPerformance) report.productPerformance = overviewData.topProducts || [];
    if (sections.paymentMethods) report.paymentMethods = overviewData.paymentMethods || [];
    if (sections.hourlySalesTrend) report.hourlySalesTrend = overviewData.hourly || [];
    return report;
}

function reportRows(report) {
    const rows = [['Section', 'Metric', 'Value', 'Details']];
    if (report.salesSummary) {
        rows.push(['Sales Summary', 'Total sales', report.salesSummary.sales, '']);
        rows.push(['Sales Summary', 'Transactions', report.salesSummary.transactions, '']);
        rows.push(['Sales Summary', 'Average order value', report.salesSummary.averageOrderValue, '']);
    }
    (report.productPerformance || []).forEach(product => {
        rows.push(['Product Performance', product.name, product.sold, `Revenue: ${product.revenue}`]);
    });
    (report.paymentMethods || []).forEach(payment => {
        rows.push(['Payment Methods', payment.method, payment.transactions, `Sales: ${payment.sales}`]);
    });
    (report.hourlySalesTrend || []).forEach(hour => {
        rows.push(['Hourly Sales Trend', hour.time, hour.orders, `Sales: ${hour.sales}`]);
    });
    return rows;
}

function reportCsv(report) {
    return reportRows(report)
        .map(row => row.map(value => {
            const text = String(value ?? '');
            const safeText = typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(text)
                ? `'${text}`
                : text;
            return `"${safeText.replace(/"/g, '""')}"`;
        }).join(','))
        .join('\r\n');
}

function downloadReport(content, type, extension) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `mango_royal_report_${Date.now()}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
}

$('#export-rep-btn')?.addEventListener('click', () => {
    const report = getReportExportData();
    if (adminSettings.defaultFormat === 'json') {
        downloadReport(JSON.stringify(report, null, 2), 'application/json', 'json');
        return;
    }
    if (adminSettings.defaultFormat === 'pdf') {
        const printableRows = reportRows(report).map(row => `
            <tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>
        `).join('');
        const windowRef = window.open('', '_blank', 'width=900,height=700');
        if (!windowRef) return alert('Popups blocked. Allow popups to print or save the report as PDF.');
        windowRef.document.write(`<!doctype html><html><head><title>Mango Royal Sales Report</title>
            <style>body{font:14px Arial,sans-serif;padding:28px;color:#1f2937}h1{font-size:20px}
            table{border-collapse:collapse;width:100%;margin-top:18px}td{border:1px solid #d1d5db;padding:8px}
            tr:first-child{font-weight:bold;background:#f3f4f6}@media print{button{display:none}}</style>
            </head><body><h1>Mango Royal Sales Report</h1><p>Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString())}</p>
            <table>${printableRows}</table><button onclick="window.print()">Print / Save as PDF</button></body></html>`);
        windowRef.document.close();
        return;
    }
    downloadReport(reportCsv(report), 'text/csv;charset=utf-8', 'csv');
});

/* ---------- Users ---------- */
function renderUsers() {
    const active = users.filter(u => u.status === 'Active').length;
    $('#usr-total').textContent    = users.length;
    $('#usr-active').textContent   = active;
    $('#usr-inactive').textContent = users.length - active;

    const roleCls = { Admin:'admin', Manager:'manager', Cashier:'cashier', 'Kitchen Staff':'kitchen' };
    $('#user-table tbody').innerHTML = users.map(u => `
        <tr>
            <td><b>${u.id}</b></td>
            <td>${u.name}</td>
            <td>${u.email}</td>
            <td><span class="pill ${roleCls[u.role]||''}">${u.role}</span></td>
            <td><span class="pill ${u.status.toLowerCase()}">${u.status}</span></td>
            <td>${u.lastLogin.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
            <td>
                <button class="btn btn-sm btn-ghost" data-u-toggle="${u.id}">${u.status==='Active'?'Deactivate':'Activate'}</button>
                <button class="btn btn-sm btn-info" data-u-edit="${u.id}">Edit</button>
                <button class="btn btn-sm btn-danger" data-u-del="${u.id}">✕</button>
            </td>
        </tr>
    `).join('');

    $$('[data-u-toggle]').forEach(b => b.addEventListener('click', () => {
        const u = users.find(x => x.id === b.dataset.uToggle);
        u.status = u.status === 'Active' ? 'Inactive' : 'Active';
        renderUsers();
    }));
    $$('[data-u-edit]').forEach(b => b.addEventListener('click', () => openUserModal(users.find(x => x.id === b.dataset.uEdit))));
    $$('[data-u-del]').forEach(b => b.addEventListener('click', () => {
        const u = users.find(x => x.id === b.dataset.uDel);
        if (confirm(`Delete user "${u.name}"?`)) {
            users = users.filter(x => x.id !== u.id);
            renderUsers();
        }
    }));
}
$('#user-add').addEventListener('click', () => openUserModal(null));

function openUserModal(user) {
    const isNew = !user;
    const u = user || { id:'', name:'', email:'', role:'Kitchen Staff', status:'Active', lastLogin: new Date() };
    openModal(`${isNew?'Add New':'Edit'} Staff User`, `
        <div class="form-grid">
            <label class="span2">Full Name<input id="u-name" value="${u.name}" placeholder="e.g. Maria Santos"></label>
            <label class="span2">Email<input type="email" id="u-email" value="${u.email}" placeholder="maria@mangoroyal.com"></label>
            <label>Role<select id="u-role">
                ${['Admin','Manager','Cashier','Kitchen Staff'].map(r => `<option ${r===u.role?'selected':''}>${r}</option>`).join('')}
            </select></label>
            <label>Status<select id="u-status">
                <option ${u.status==='Active'?'selected':''}>Active</option>
                <option ${u.status==='Inactive'?'selected':''}>Inactive</option>
            </select></label>
        </div>
    `, [
        { label:'Cancel', cls:'btn-ghost', action: closeModal },
        { label:'Save User', cls:'btn-primary', action: () => {
            const name = $('#u-name').value.trim(); const email = $('#u-email').value.trim();
            if (!name || !email) return alert('Name and email required');
            const role = $('#u-role').value; const status = $('#u-status').value;
            if (isNew) {
                const prefix = role === 'Admin' ? 'A' : role === 'Cashier' ? 'C' : role === 'Kitchen Staff' ? 'K' : 'M';
                const n = users.filter(x => x.id.startsWith(prefix)).length + 1;
                users.push({ id: `${prefix}-${String(n).padStart(3,'0')}`, name, email, role, status, lastLogin: new Date() });
            } else {
                Object.assign(u, { name, email, role, status });
            }
            closeModal();
            renderUsers();
        }}
    ]);
}

/* ---------- Royal Insights ---------- */
const assistantPanel = $('#assistant-panel');
const assistantInput = $('#assistant-input');
const assistantMessages = $('#assistant-messages');
const assistantForm = $('#assistant-form');

function setAssistantOpen(isOpen) {
    assistantDock.classList.toggle('is-open', isOpen);
    $('#assistant-open').setAttribute('aria-expanded', String(isOpen));
    assistantPanel.setAttribute('aria-hidden', String(!isOpen));
    if (isOpen) requestAnimationFrame(() => assistantInput.focus());
}

function answerAnalyticsQuestion(question) {
    const query = question.toLowerCase();
    const bestProduct = overviewData.topProducts?.[0];
    const completed = Number(overviewData.completedOrders || 0);
    const inProgress = Number(overviewData.inProgressOrders || 0);
    const voided = Number(overviewData.voidedOrders || 0);
    const dineIn = Number(overviewData.dineInOrders || 0);
    const takeOut = Number(overviewData.takeOutOrders || 0);

    if (!operationalMetricsAvailable && /average|avg|ticket|void|cancel|progress|pending|waiting|status|complete|ready|dine.?in|take.?out|order mix/.test(query)) {
        return 'These operations metrics are not available from the running backend yet. Restart the Mango Royal backend, then reload the dashboard.';
    }

    if (/best|top|popular|seller|product|item/.test(query)) {
        return bestProduct
            ? `${bestProduct.name} is today's best seller with ${bestProduct.sold} item${bestProduct.sold === 1 ? '' : 's'} sold (${peso(bestProduct.revenue)} in sales).`
            : 'There are no completed item sales recorded today yet.';
    }
    if (/average|avg|ticket/.test(query)) {
        return `Today's average order value, excluding voided orders, is ${peso(overviewData.averageOrderValue || 0)}.`;
    }
    if (/void|cancel/.test(query)) {
        return `${voided} order${voided === 1 ? '' : 's'} ${voided === 1 ? 'has' : 'have'} been voided today.`;
    }
    if (/progress|pending|waiting|status|complete|ready/.test(query)) {
        return `Today's order status: ${inProgress} in progress, ${completed} ready for pickup, and ${voided} voided.`;
    }
    if (/dine.?in|take.?out|order mix/.test(query)) {
        return `Today's non-voided order mix is ${dineIn} dine-in and ${takeOut} take-out.`;
    }
    if (/peak|busy|hour|time/.test(query)) {
        return overviewData.peakTime && overviewData.peakTime !== 'None yet'
            ? `${overviewData.peakTime} is today's busiest hour based on order count.`
            : 'There is not enough order activity today to identify a peak hour yet.';
    }
    if (/sales|revenue|performance|today/.test(query)) {
        const averageOrder = operationalMetricsAvailable
            ? ` The average non-voided order is ${peso(overviewData.averageOrderValue)}.`
            : '';
        return `Today's sales are ${peso(overviewData.todaySales || 0)} from ${overviewData.totalOrders || 0} order${overviewData.totalOrders === 1 ? '' : 's'}.${averageOrder}`;
    }
    const operationsSummary = operationalMetricsAvailable ? `${inProgress} in progress` : 'operations metrics unavailable';
    return `Today's snapshot: ${peso(overviewData.todaySales || 0)} in sales, ${overviewData.totalOrders || 0} orders, ${operationsSummary}, and ${bestProduct ? `${bestProduct.name} is the top seller` : 'no top seller yet'}. Try asking about sales, average order, order status, order mix, best seller, or peak time.`;
}

function appendAssistantMessage(text, sender) {
    const message = document.createElement('div');
    message.className = `assistant-message ${sender}`;
    message.textContent = text;
    assistantMessages.appendChild(message);
    assistantMessages.scrollTop = assistantMessages.scrollHeight;
    return message;
}

function sendInsightQuestion(question) {
    const message = question.trim();
    if (!message) return;

    assistantDock.classList.add('has-conversation');
    $('#assistant-welcome')?.remove();
    $('#assistant-prompts')?.remove();
    appendAssistantMessage(message, 'user');
    const thinking = appendAssistantMessage('Checking today’s dashboard data…', 'thinking');
    window.setTimeout(() => {
        thinking.remove();
        appendAssistantMessage(answerAnalyticsQuestion(message), 'assistant');
    }, 220);
}

$('#assistant-open').addEventListener('click', () => setAssistantOpen(true));
$('#assistant-close').addEventListener('click', () => setAssistantOpen(false));
assistantForm.addEventListener('submit', event => {
    event.preventDefault();
    const question = assistantInput.value;
    if (!question.trim()) return;
    assistantInput.value = '';
    sendInsightQuestion(question);
});
$('#assistant-prompts').addEventListener('click', event => {
    const prompt = event.target.closest('button');
    if (prompt) sendInsightQuestion(prompt.textContent);
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && assistantDock.classList.contains('is-open')) {
        setAssistantOpen(false);
    }
});

/* ---------- Modal Helper ---------- */
function openModal(title, bodyHtml, buttons=[]) {
    $('#modal-body').innerHTML = `
        <div class="modal-head"><h3>${title}</h3><button class="modal-close" data-close>✕</button></div>
        <div class="modal-content">${bodyHtml}</div>
        <div class="modal-foot">${buttons.map((b,i) => `<button class="btn ${b.cls||''}" data-mb="${i}">${b.label}</button>`).join('')}</div>
    `;
    $('#modal').classList.add('open');
    $$('#modal [data-close]').forEach(b => b.addEventListener('click', closeModal));
    buttons.forEach((b,i) => $(`#modal [data-mb="${i}"]`).addEventListener('click', b.action));
}
function closeModal() { $('#modal').classList.remove('open'); }
$('.modal-backdrop').addEventListener('click', closeModal);

/* Color swatch selection previews until settings are saved. */
document.addEventListener('click', e => {
    const swatch = e.target.closest('.swatch[data-color]');
    if (!swatch) return;
    $$('.swatch[data-color]').forEach(item => item.classList.remove('active'));
    swatch.classList.add('active');
    adminSettings.appearance = { ...adminSettings.appearance, accentColor: swatch.dataset.color };
    applyAppearance(adminSettings.appearance);
});

/* Window resize trigger for Chart.js */
window.addEventListener('resize', () => {
    Object.values(charts).forEach(c => { if (c) c.resize(); });
});

/* ---------- Initialization ---------- */
switchView('dashboard');
loadAdminSettings();
loadTransactionsData();
loadMenuData();
