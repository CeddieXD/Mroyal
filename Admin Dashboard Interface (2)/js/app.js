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
let salesInterval = getStoredAdminInterval();
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
    { id:'A-001', name:'John Dela Cruz', email:'john.delacruz@mangoroyal.com', role:'Admin',         status:'Active', lastLogin:new Date(), archived:false },
    { id:'C-001', name:'Carlos Reyes',   email:'carlos.reyes@mangoroyal.com',   role:'Cashier',       status:'Active', lastLogin:new Date(), archived:false },
    { id:'K-001', name:'Anna Garcia',    email:'anna.garcia@mangoroyal.com',    role:'Kitchen Staff', status:'Active', lastLogin:new Date(), archived:false },
];
let archivedUsers = [];
let showArchivedUsers = false;

const ACTIVITY_LOG_STORAGE_KEY = 'mango-royal-admin-activity';
const MENU_ARCHIVE_STORAGE_KEY = 'mango-royal-menu-archive';
const activityLogSeed = [
    { id: 1, timestamp: new Date(Date.now() - 1000 * 60 * 27), user: 'Admin User', action: 'Updated menu item', details: 'Mango Royal price changed from ₱59 to ₱65.', category: 'Menu' },
    { id: 2, timestamp: new Date(Date.now() - 1000 * 60 * 64), user: 'Admin User', action: 'Toggled item availability', details: 'Fresh Juice set to unavailable for online ordering.', category: 'Menu' },
    { id: 3, timestamp: new Date(Date.now() - 1000 * 60 * 132), user: 'System', action: 'Report generated', details: 'Daily sales report exported to CSV.', category: 'Reports' },
    { id: 4, timestamp: new Date(Date.now() - 1000 * 60 * 190), user: 'Admin User', action: 'Updated settings', details: 'Report frequency changed to Daily.', category: 'System' },
    { id: 5, timestamp: new Date(Date.now() - 1000 * 60 * 340), user: 'Admin User', action: 'Updated user role', details: 'Carlos Reyes assigned to Cashier access.', category: 'Users' },
    { id: 6, timestamp: new Date(Date.now() - 1000 * 60 * 520), user: 'System', action: 'Order status changed', details: 'Order A771 moved to Completed.', category: 'Transactions' }
];
let activityLogs = activityLogSeed.map(log => ({ ...log, timestamp: new Date(log.timestamp) }));
try {
    const savedLogs = JSON.parse(localStorage.getItem(ACTIVITY_LOG_STORAGE_KEY) || '[]');
    if (Array.isArray(savedLogs) && savedLogs.length) {
        activityLogs = savedLogs.map(log => ({ ...log, timestamp: new Date(log.timestamp) }));
    }
} catch (e) {
    // Ignore localStorage read issues.
}

function recordActivity({ user = 'Admin User', action, details, category = 'System' }) {
    const entry = {
        id: Date.now() + Math.random(),
        timestamp: new Date(),
        user,
        action,
        details,
        category
    };
    activityLogs.unshift(entry);
    try {
        localStorage.setItem(ACTIVITY_LOG_STORAGE_KEY, JSON.stringify(activityLogs.slice(0, 200)));
    } catch (e) {
        // Ignore storage restrictions in private browsing or locked-down environments.
    }
    if (document.getElementById('view-activity')?.classList.contains('active')) {
        renderActivityLog();
    }
}
window.MangoRoyalAdminAudit = { currentUserName: '', recordActivity };

/* ---------- Nav ---------- */
const charts = {};
function triggerDashboardIntervalAnimation() {
    const dashboardView = document.getElementById('view-dashboard');
    if (!dashboardView) return;

    dashboardView.classList.remove('dashboard-refreshing');
    void dashboardView.offsetWidth;
    dashboardView.classList.add('dashboard-refreshing');

    const graphTargets = dashboardView.querySelectorAll('#chart-sales, #chart-items, .stat-sparkline svg, .stat-sparkline .spark-line, .stat-sparkline .spark-area');
    graphTargets.forEach(element => {
        element.classList.remove('graph-refreshing');
        void element.getBoundingClientRect();
        element.classList.add('graph-refreshing');
    });

    if (triggerDashboardIntervalAnimation.timeoutId) {
        clearTimeout(triggerDashboardIntervalAnimation.timeoutId);
    }

    triggerDashboardIntervalAnimation.timeoutId = setTimeout(() => {
        dashboardView.classList.remove('dashboard-refreshing');
        graphTargets.forEach(element => element.classList.remove('graph-refreshing'));
    }, 650);
}

function setupCustomIntervalDropdown(dropdownEl, onChange) {
    if (!dropdownEl) return;
    const trigger = dropdownEl.querySelector('.interval-trigger');
    const menu = dropdownEl.querySelector('.interval-menu');
    const hiddenSelect = dropdownEl.querySelector('select');
    if (!trigger || !menu || !hiddenSelect) return;

    const updateDisplay = () => {
        const value = hiddenSelect.value;
        const selected = dropdownEl.querySelector(`.interval-option[data-value="${CSS.escape(value)}"]`);
        const display = dropdownEl.querySelector('.interval-value');
        if (display && selected) display.textContent = selected.textContent.trim();
        dropdownEl.querySelectorAll('.interval-option').forEach(option => {
            option.classList.toggle('active', option.dataset.value === value);
        });
    };

    hiddenSelect.value = salesInterval;
    updateDisplay();

    trigger.addEventListener('click', event => {
        event.stopPropagation();
        const isOpen = dropdownEl.classList.contains('open');
        document.querySelectorAll('.interval-dropdown').forEach(item => {
            item.classList.remove('open');
            const btn = item.querySelector('.interval-trigger');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
            dropdownEl.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
        }
    });

    menu.addEventListener('click', event => {
        const option = event.target.closest('.interval-option');
        if (!option) return;
        hiddenSelect.value = option.dataset.value;
        updateDisplay();
        dropdownEl.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        if (typeof onChange === 'function') onChange(hiddenSelect.value);
    });

    document.addEventListener('click', event => {
        if (!dropdownEl.contains(event.target)) {
            dropdownEl.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
        }
    });

    updateDisplay();
}

const salesIntervalDropdown = document.querySelector('.interval-dropdown[data-target="sales-interval"]');
if (salesIntervalDropdown) {
    salesIntervalDropdown.addEventListener('change', () => {});
    setupCustomIntervalDropdown(salesIntervalDropdown, (value) => {
        salesInterval = value;
        persistAdminInterval();
        triggerDashboardIntervalAnimation();
        loadOverviewData();
    });
}

const txIntervalDropdown = document.querySelector('.interval-dropdown[data-target="tx-time"]');
if (txIntervalDropdown) {
    setupCustomIntervalDropdown(txIntervalDropdown, (value) => {
        txState.time = value;
        txState.page = 1;
        syncTxIntervalControls();
        renderTransactions();
    });
}
$$('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
});

const ADMIN_LAST_VIEW_KEY = 'mango-royal-admin-last-view';
const ADMIN_LAST_INTERVAL_KEY = 'mango-royal-admin-last-interval';
function getStoredAdminView() {
    try {
        const stored = localStorage.getItem(ADMIN_LAST_VIEW_KEY);
        const allowed = ['dashboard', 'transactions', 'menu', 'reports', 'activity', 'users', 'settings'];
        return stored && allowed.includes(stored) ? stored : 'dashboard';
    } catch (e) {
        return 'dashboard';
    }
}

function getStoredAdminInterval() {
    try {
        const stored = localStorage.getItem(ADMIN_LAST_INTERVAL_KEY);
        const allowed = ['day', 'yesterday', 'week', 'month', 'year'];
        return stored && allowed.includes(stored) ? stored : 'day';
    } catch (e) {
        return 'day';
    }
}

function persistAdminInterval() {
    try {
        localStorage.setItem(ADMIN_LAST_INTERVAL_KEY, salesInterval);
    } catch (e) {
        // Ignore storage restrictions in private browsing or locked-down environments.
    }
}

function normalizeMenuArchiveState(items) {
    try {
        const saved = JSON.parse(localStorage.getItem(MENU_ARCHIVE_STORAGE_KEY) || '{}');
        return (Array.isArray(items) ? items : []).map(item => {
            const archived = Boolean(saved[item.id]);
            return {
                ...item,
                archived,
                available: archived ? false : Boolean(item.available)
            };
        });
    } catch (e) {
        return (Array.isArray(items) ? items : []).map(item => ({ ...item, archived: false, available: Boolean(item.available) }));
    }
}

function persistMenuArchiveState() {
    try {
        const archiveState = {};
        menuItems.forEach(item => {
            if (item.archived) archiveState[item.id] = true;
        });
        localStorage.setItem(MENU_ARCHIVE_STORAGE_KEY, JSON.stringify(archiveState));
    } catch (e) {
        // Ignore storage restrictions in private browsing or locked-down environments.
    }
}

function switchView(view) {
    const activeView = view || getStoredAdminView();
    salesInterval = getStoredAdminInterval();
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === activeView));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + activeView));
    const showDashboardAssistant = activeView === 'dashboard';
    if (!showDashboardAssistant && assistantDock.classList.contains('is-open')) {
        setAssistantOpen(false);
    }
    assistantDock.hidden = !showDashboardAssistant;
    document.body.classList.toggle('dashboard-active', showDashboardAssistant);
    try {
        localStorage.setItem(ADMIN_LAST_VIEW_KEY, activeView);
    } catch (e) {
        // Ignore storage restrictions in private browsing or locked-down environments.
    }
    if (activeView === 'dashboard' || activeView === 'reports') loadOverviewData();
    if (activeView === 'transactions') loadTransactionsData();
    if (activeView === 'menu') loadMenuData();
    if (activeView === 'reports') {
        if (!adminSettingsLoaded) loadAdminSettings();
        renderReports();
    }
    if (activeView === 'activity') renderActivityLog();
    if (activeView === 'settings') loadAdminSettings();
    if (activeView === 'users') renderUsers();
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
    if (document.getElementById('view-reports')?.classList.contains('active')) {
        renderReports();
    }
    setupItemsSoldInsightToggle();
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
                menuItems = normalizeMenuArchiveState(data);
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

function setTrendChip(element, value, type) {
    if (!element) return;

    const sign = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
    const icon = sign === 'up' ? '↗' : sign === 'down' ? '↘' : '→';
    const prefix = sign === 'up' ? '+' : sign === 'down' ? '-' : '';
    const text = `${prefix}${Math.abs(value).toFixed(type === 'percent' ? 1 : 0)}%`;

    element.classList.remove('trend-up', 'trend-down', 'trend-flat');
    element.classList.add(sign === 'up' ? 'trend-up' : sign === 'down' ? 'trend-down' : 'trend-flat');

    const iconEl = element.querySelector('.trend-icon');
    const textEl = element.querySelector('.trend-text');
    if (iconEl) iconEl.textContent = icon;
    if (textEl) textEl.textContent = text;
}

function buildSparklinePath(values, width = 110, height = 42, padding = 4) {
    const safeValues = Array.isArray(values) && values.length ? values.map(value => Number(value) || 0) : [0, 0, 0, 0];
    const max = Math.max(...safeValues, 1);
    const min = Math.min(...safeValues, 0);
    const range = max - min || 1;
    const usableWidth = width - padding * 2;
    const usableHeight = height - padding * 2;

    return safeValues.map((value, index) => {
        const x = padding + (safeValues.length === 1 ? 0 : (index / (safeValues.length - 1)) * usableWidth);
        const y = height - padding - ((value - min) / range) * usableHeight;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
}

function buildThreeDaySummary(values) {
    const series = Array.isArray(values) && values.length ? values.map(value => Number(value) || 0) : [0, 0, 0];
    const lastThree = series.slice(-3);
    const padded = [...Array(Math.max(0, 3 - lastThree.length)).fill(0), ...lastThree].slice(-3);
    return padded;
}

function getThreeDayTrend(values) {
    const summary = buildThreeDaySummary(values);
    const previous = summary.slice(0, 2);
    const current = summary[summary.length - 1] || 0;
    const priorHigh = Math.max(...previous);
    const priorLow = Math.min(...previous);

    let status = 'orange';
    if (current > priorHigh) status = 'green';
    else if (current < priorLow) status = 'red';

    const denominator = Math.max(Math.abs(priorHigh - priorLow), 1);
    const deltaPercent = ((current - priorHigh) / denominator) * 100;
    const lowDeltaPercent = ((current - priorLow) / denominator) * 100;

    return {
        summary,
        current,
        high: priorHigh,
        low: priorLow,
        status,
        deltaPercent,
        lowDeltaPercent
    };
}

function updateSparklineTooltip(targetId, value, status = 'orange', type = 'sales') {
    const tooltip = document.getElementById(targetId);
    if (!tooltip) return;
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    const formatValue = type === 'sales'
        ? `₱${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
        : `${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    tooltip.textContent = `${sign}${formatValue}`;
    tooltip.style.background = status === 'green' ? 'rgba(22, 163, 74, 0.95)' : status === 'red' ? 'rgba(220, 38, 38, 0.95)' : 'rgba(249, 115, 22, 0.95)';
    tooltip.style.borderColor = status === 'green' ? 'rgba(22, 163, 74, 0.35)' : status === 'red' ? 'rgba(220, 38, 38, 0.35)' : 'rgba(249, 115, 22, 0.35)';
}

function bindSparklineTooltip(elementId) {
    const sparkline = document.getElementById(elementId);
    if (!sparkline) return;
    const tooltip = sparkline.querySelector('.stat-tooltip');
    if (!tooltip) return;

    sparkline.addEventListener('pointermove', event => {
        tooltip.style.left = `${event.clientX}px`;
        tooltip.style.top = `${event.clientY - 10}px`;
        tooltip.classList.add('visible');
    });

    sparkline.addEventListener('pointerleave', () => tooltip.classList.remove('visible'));
}

function renderSparkline(elementId, values, color = '#f97316') {
    const el = document.getElementById(elementId);
    if (!el) return;

    const numericValues = Array.isArray(values) && values.length ? values.map(Number) : [0, 0, 0];
    const paddedValues = numericValues.length >= 3 ? numericValues.slice(-3) : [...Array(Math.max(0, 3 - numericValues.length)).fill(0), ...numericValues];
    const path = buildSparklinePath(paddedValues);
    const fillPath = `${path} L 106 38 L 4 38 Z`;

    const line = el.querySelector('.spark-line');
    const area = el.querySelector('.spark-area');
    if (line && area) {
        line.setAttribute('d', path);
        line.setAttribute('stroke', color);
        area.setAttribute('d', fillPath);
        area.setAttribute('fill', color === '#3b82f6' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(249, 115, 22, 0.12)');
    }

    const segmentMarkup = paddedValues.map((value, index) => {
        const segmentWidth = 100 / paddedValues.length;
        const label = paddedValues.length === 3
            ? index === 0 ? 'Day 1' : index === 1 ? 'Day 2' : 'Day 3'
            : `Point ${index + 1}`;
        return `
            <span class="spark-segment" tabindex="0" style="width:${segmentWidth}%" aria-label="${label}">
                <span class="spark-segment-tooltip">${label}</span>
            </span>
        `;
    }).join('');

    const overlay = el.querySelector('.spark-segment-overlay');
    if (overlay) {
        overlay.innerHTML = segmentMarkup;
    } else {
        const newOverlay = document.createElement('div');
        newOverlay.className = 'spark-segment-overlay';
        newOverlay.innerHTML = segmentMarkup;
        el.appendChild(newOverlay);
    }
}

/* ---------- Dashboard ---------- */
function renderDashboard() {
    const salesDelta = Number(overviewData.salesDelta || 0);
    const orderDelta = Number(overviewData.ordersDelta || 0);
    const salesPct = Number(overviewData.salesDeltaPct || 0);
    const orderPct = Number(overviewData.ordersDeltaPct || 0);

    const statSalesEl = $('#stat-sales');
    const statOrdersEl = $('#stat-orders');
    const statBestEl = $('#stat-best');
    const statPeakEl = $('#stat-peak');
    const avgOrderEl = $('#metric-average-order');
    const inProgressEl = $('#metric-in-progress');
    const completedEl = $('#metric-completed');
    const voidedEl = $('#metric-voided');

    if (statSalesEl) statSalesEl.textContent = peso(overviewData.todaySales || 0);
    if (statOrdersEl) statOrdersEl.textContent = overviewData.totalOrders || 0;
    setTrendChip(document.getElementById('sales-trend'), salesPct, 'percent');
    setTrendChip(document.getElementById('orders-trend'), orderPct, 'percent');
    if (statBestEl) statBestEl.textContent = overviewData.bestSeller || 'No sales yet';
    if (statPeakEl) statPeakEl.textContent = overviewData.peakTime || 'None yet';
    const unavailableMetric = '—';
    if (avgOrderEl) avgOrderEl.textContent = operationalMetricsAvailable ? peso(overviewData.averageOrderValue) : unavailableMetric;
    if (inProgressEl) inProgressEl.textContent = operationalMetricsAvailable ? overviewData.inProgressOrders : unavailableMetric;
    if (completedEl) completedEl.textContent = operationalMetricsAvailable ? overviewData.completedOrders : unavailableMetric;
    if (voidedEl) voidedEl.textContent = operationalMetricsAvailable ? overviewData.voidedOrders : unavailableMetric;

    const dineInOrders = operationalMetricsAvailable ? Number(overviewData.dineInOrders) : 0;
    const takeOutOrders = operationalMetricsAvailable ? Number(overviewData.takeOutOrders) : 0;
    const orderMixTotal = dineInOrders + takeOutOrders;
    const dineInPercent = orderMixTotal ? dineInOrders / orderMixTotal * 100 : 0;
    const orderMixTotalEl = $('#order-mix-total');
    const mixDineInCountEl = $('#mix-dine-in-count');
    const mixTakeOutCountEl = $('#mix-take-out-count');
    const mixDineInBar = $('#mix-dine-in');
    const mixTakeOutBar = $('#mix-take-out');

    if (orderMixTotalEl) {
        orderMixTotalEl.textContent = operationalMetricsAvailable
            ? `${orderMixTotal} order${orderMixTotal === 1 ? '' : 's'}`
            : 'Metrics unavailable';
    }
    if (mixDineInCountEl) mixDineInCountEl.textContent = operationalMetricsAvailable ? dineInOrders : unavailableMetric;
    if (mixTakeOutCountEl) mixTakeOutCountEl.textContent = operationalMetricsAvailable ? takeOutOrders : unavailableMetric;
    if (mixDineInBar) mixDineInBar.style.width = `${dineInPercent}%`;
    if (mixTakeOutBar) mixTakeOutBar.style.width = `${100 - dineInPercent}%`;
    renderPrescriptiveInsights();
    updateClock();

    const salesTimeline = Array.isArray(overviewData.salesTimeline) ? overviewData.salesTimeline : [];
    const fallbackLabels = Array.from({ length: 7 }, (_, index) => `D${index + 1}`);
    const fallbackSales = Array(7).fill(0);
    const hasSalesData = salesTimeline.length > 0;
    const salesTotal = salesTimeline.reduce((sum, point) => sum + Number(point.sales || 0), 0);
    const orderTotal = salesTimeline.reduce((sum, point) => sum + Number(point.orders || 0), 0);
    const displayedInterval = overviewData.salesInterval || salesInterval;
    const intervalLabels = { day: 'today', yesterday: 'yesterday', week: 'the last 7 days', month: 'month to date', year: 'year to date' };
    const salesSummaryEl = $('#sales-chart-summary');
    if (salesSummaryEl) {
        salesSummaryEl.textContent = hasSalesData
            ? `${intervalLabels[displayedInterval] || 'selected interval'} · ${peso(salesTotal)} sales · ${orderTotal} orders`
            : `No sales activity yet · ${peso(0)} sales · 0 orders`;
    }
    const salesLabels = hasSalesData ? salesTimeline.map(point => point.label) : fallbackLabels;
    const intervalSales = hasSalesData ? salesTimeline.map(point => Number(point.sales || 0)) : fallbackSales;
    const intervalOrders = hasSalesData ? salesTimeline.map(point => Number(point.orders || 0)) : fallbackSales;

    const dayTrendSales = Array.isArray(overviewData.dailyTrend) && overviewData.dailyTrend.length
        ? overviewData.dailyTrend.map(point => Number(point.sales || 0))
        : [0, 0, 0];
    const dayTrendOrders = Array.isArray(overviewData.dailyTrend) && overviewData.dailyTrend.length
        ? overviewData.dailyTrend.map(point => Number(point.orders || 0))
        : [0, 0, 0];

    const salesTrend = getThreeDayTrend(dayTrendSales);
    const ordersTrend = getThreeDayTrend(dayTrendOrders);
    const previousSalesValue = Array.isArray(dayTrendSales) && dayTrendSales.length > 1 ? Number(dayTrendSales[dayTrendSales.length - 2]) : 0;
    const previousOrdersValue = Array.isArray(dayTrendOrders) && dayTrendOrders.length > 1 ? Number(dayTrendOrders[dayTrendOrders.length - 2]) : 0;
    const currentSalesValue = Number(overviewData.todaySales || 0);
    const currentOrdersValue = Number(overviewData.totalOrders || 0);
    const salesDeltaValue = currentSalesValue - previousSalesValue;
    const ordersDeltaValue = currentOrdersValue - previousOrdersValue;

    renderSparkline('sales-sparkline', salesTrend.summary, '#f97316');
    renderSparkline('orders-sparkline', ordersTrend.summary, '#3b82f6');
    updateSparklineTooltip('sales-tooltip', salesDeltaValue, salesTrend.status, 'sales');
    updateSparklineTooltip('orders-tooltip', ordersDeltaValue, ordersTrend.status, 'orders');
    bindSparklineTooltip('sales-sparkline');
    bindSparklineTooltip('orders-sparkline');

    // 1. Sales Analytics Line Chart
    destroyChart('sales');
    const salesChartOptions = chartBase();
    salesChartOptions.animation = {
        duration: 700,
        easing: 'easeOutQuart'
    };
    salesChartOptions.responsiveAnimationDuration = 550;
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

    // 2. Items Sold Bar Chart (respects the selected interval)
    destroyChart('items');
    const itemsIntervalLabels = { day: 'Today', yesterday: 'Yesterday', week: 'Last 7 days', month: 'Month to date', year: 'Year to date' };
    const itemsTitle = $('#items-sold-title');
    if (itemsTitle) {
        itemsTitle.textContent = `Items Sold · ${itemsIntervalLabels[displayedInterval] || 'Selected interval'}`;
    }

    const topItems = (overviewData.topProducts || []);
    const hasItems = topItems.length > 0;
    const fallbackItemNames = ['Item A', 'Item B', 'Item C', 'Item D'];
    const fallbackItemCounts = [0, 0, 0, 0];
    const itemNames = hasItems ? topItems.map(d => d.name) : fallbackItemNames;
    const itemCounts = hasItems ? topItems.map(d => d.sold) : fallbackItemCounts;
    const itemColors = itemNames.map((_, index) => (hasItems && index === 0) ? '#f97316' : '#fdba74');

    charts.items = new Chart($('#chart-items'), {
        type: 'bar',
        data: {
            labels: itemNames,
            datasets: [{
                label: 'Quantity Sold',
                data: itemCounts,
                backgroundColor: itemColors,
                borderColor: itemColors,
                borderWidth: 1,
                borderRadius: 8,
                borderSkipped: false,
                maxBarThickness: 36
            }]
        },
        options: {
            ...chartBase(),
            plugins: {
                ...chartBase().plugins,
                tooltip: {
                    callbacks: {
                        label: context => `Sold: ${context.parsed.y} item${context.parsed.y === 1 ? '' : 's'}`
                    }
                }
            }
        }
    });
}

function getItemsSoldInsightText() {
    const topProducts = (overviewData.topProducts || []).filter(Boolean);
    const intervalMap = {
        day: 'today',
        yesterday: 'yesterday',
        week: 'this week',
        month: 'this month',
        year: 'this year'
    };
    const selectedInterval = intervalMap[salesInterval] || 'this period';
    const best = topProducts[0] || null;
    const second = topProducts[1] || null;
    const low = topProducts.length > 1 ? topProducts[topProducts.length - 1] : null;
    const peakWindow = overviewData.peakTime && overviewData.peakTime !== 'None yet' ? overviewData.peakTime : '12:00 PM - 2:00 PM';

    if (!best) {
        return {
            title: 'No strong demand signal yet',
            text: `For ${selectedInterval}, the menu has not built a clear leader yet. Keep your best movers visible and refresh the combo board to generate early demand.`
        };
    }

    const hero = best.name;
    const challenger = second && second.name && second.name !== hero ? `${second.name} is close behind.` : 'The rest of the menu is still settling into a cadence.';
    const quiet = low && low.name && low.name !== hero ? `${low.name} is the quietest performer right now.` : 'Nothing is showing a major dip in demand.';

    return {
        title: `${hero} is leading the menu`,
        text: `For ${selectedInterval}, ${hero} is clearly the star performer and the pattern is telling: it spikes around ${peakWindow}. ${challenger} ${quiet} The best move is to spotlight ${hero} in a combo push and front-load it before the rush window so demand converts into faster sell-through.`
    };
}

function renderPrescriptiveInsights() {
    const topProducts = (overviewData.topProducts || []).filter(Boolean);
    const topProduct = topProducts[0] || null;
    const lowProduct = topProducts.length > 1 ? topProducts[topProducts.length - 1] : null;
    const peakWindow = overviewData.peakTime && overviewData.peakTime !== 'None yet' ? overviewData.peakTime : '12:00 PM - 2:00 PM';
    const currentHour = new Date().getHours();
    const demandPattern = currentHour >= 11 && currentHour <= 17
        ? 'Afternoon demand remains strong and highly predictable.'
        : currentHour >= 18
            ? 'Evening demand is trending upward with stronger repeat orders.'
            : 'Morning demand remains steady and predictable.';
    const seasonalLabel = salesInterval === 'day' ? 'day' : salesInterval === 'week' ? 'week' : salesInterval === 'month' ? 'month' : 'period';

    const forecastName = $('#forecast-item-name');
    const forecastDetail = $('#forecast-item-detail');
    const forecastLowDemand = $('#forecast-low-demand');
    const forecastBestWindow = $('#forecast-best-window');
    const forecastWeatherTrend = $('#forecast-weather-trend');
    const forecastAction = $('#forecast-action');

    if (forecastName) {
        forecastName.textContent = topProduct ? topProduct.name : 'No sales data yet';
    }
    if (forecastDetail) {
        forecastDetail.textContent = topProduct
            ? `Forecasted to peak during ${peakWindow} based on prior demand and current trends.`
            : 'Forecast data will populate after items are sold.';
    }
    if (forecastLowDemand) {
        forecastLowDemand.textContent = lowProduct && lowProduct.name
            ? `${lowProduct.name} has been low on sales for this ${seasonalLabel}. Consider a promo bundle or menu highlight.`
            : 'No low-demand product is visible yet. Keep the menu mix balanced.';
    }
    if (forecastBestWindow) forecastBestWindow.textContent = peakWindow;
    if (forecastWeatherTrend) forecastWeatherTrend.textContent = demandPattern;
    if (forecastAction) {
        forecastAction.textContent = topProduct
            ? `Promote ${topProduct.name} before ${peakWindow} to capture peak demand.`
            : 'Review item-level demand and adjust bundles before peak hours.';
    }

    const itemsInsightPanel = document.getElementById('items-ai-panel');
    if (itemsInsightPanel) {
        const insight = getItemsSoldInsightText();
        itemsInsightPanel.innerHTML = `
            <span class="items-ai-tag">AI Insight</span>
            <h4>${insight.title}</h4>
            <p>${insight.text}</p>
        `;
    }
}

function setupItemsSoldInsightToggle() {
    const card = document.getElementById('items-sold-card');
    if (!card || card.dataset.bound === 'true') return;

    const badge = document.getElementById('items-card-badge');
    const setCardState = (isOpen) => {
        card.classList.toggle('is-open', isOpen);
        card.setAttribute('aria-expanded', String(isOpen));
        if (badge) badge.textContent = isOpen ? 'AI Insight' : 'Graph';
        const chartWrap = card.querySelector('.chart-wrap');
        if (chartWrap) {
            chartWrap.style.display = isOpen ? 'none' : 'block';
        }
        const itemInsightPanel = document.getElementById('items-ai-panel');
        if (itemInsightPanel) {
            if (isOpen) {
                const insight = getItemsSoldInsightText();
                itemInsightPanel.innerHTML = `
                    <span class="items-ai-tag">AI Insight</span>
                    <h4>${insight.title}</h4>
                    <p>${insight.text}</p>
                `;
            } else {
                itemInsightPanel.innerHTML = '';
            }
        }
    };

    const toggle = () => {
        const isOpen = !card.classList.contains('is-open');
        setCardState(isOpen);
    };

    card.dataset.bound = 'true';
    setCardState(false);
    card.addEventListener('click', toggle);
    card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
        }
    });
}

function updateClock() {
    // Reserved for dashboard time-based refreshes without the removed weather widget.
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
const txState = { search:'', status:'all', payment:'all', time:'today', day:'all', expanded:null, auditItem:null, page:1, perPage:8 };
function syncTxIntervalControls() {
    const filterSelect = $('#tx-time');
    const txDropdown = document.querySelector('.interval-dropdown[data-target="tx-time"]');
    if (filterSelect && Array.from(filterSelect.options).some(opt => opt.value === txState.time)) filterSelect.value = txState.time;
    if (txDropdown) {
        const selected = txDropdown.querySelector(`.interval-option[data-value="${CSS.escape(txState.time)}"]`);
        const valueText = txDropdown.querySelector('.interval-value');
        if (selected && valueText) valueText.textContent = selected.textContent.trim();
        txDropdown.querySelectorAll('.interval-option').forEach(option => {
            option.classList.toggle('active', option.dataset.value === txState.time);
        });
    }
}
syncTxIntervalControls();
['tx-search','tx-status','tx-payment','tx-time','tx-day'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) { txState[id.slice(3)] = e.target.value; txState.page = 1; syncTxIntervalControls(); renderTransactions(); } });
    document.addEventListener('change', e => { if (e.target.id === id) { txState[id.slice(3)] = e.target.value; txState.page = 1; syncTxIntervalControls(); renderTransactions(); } });
});
$('#tx-prev-page')?.addEventListener('click', () => {
    if (txState.page > 1) {
        txState.page -= 1;
        renderTransactions();
    }
});
$('#tx-next-page')?.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(filterTransactions().length / txState.perPage));
    if (txState.page < totalPages) {
        txState.page += 1;
        renderTransactions();
    }
});

function normalizeStatusValue(value) {
    return String(value ?? '').trim().toLowerCase();
}

function filterTransactions() {
    return recentTransactions.filter(t => {
        const q = txState.search.toLowerCase();
        if (q && !t.id.toLowerCase().includes(q) && !t.items.some(i => i.toLowerCase().includes(q))) return false;
        if (txState.status !== 'all' && normalizeStatusValue(t.status) !== normalizeStatusValue(txState.status)) return false;
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
    const totalPages = Math.max(1, Math.ceil(list.length / txState.perPage));
    txState.page = Math.min(txState.page, totalPages);

    const pagedList = list.slice((txState.page - 1) * txState.perPage, txState.page * txState.perPage);
    const total = list.reduce((s,t) => s + (t.status !== 'Void' ? t.total : 0), 0);
    $('#tx-count').textContent = list.length;
    $('#tx-total').textContent = peso(total);
    $('#tx-avg').textContent   = peso(list.length ? Math.round(total/list.length) : 0);

    const prevBtn = $('#tx-prev-page');
    const nextBtn = $('#tx-next-page');
    const pageIndicator = $('#tx-page-indicator');
    if (prevBtn) prevBtn.disabled = txState.page <= 1;
    if (nextBtn) nextBtn.disabled = txState.page >= totalPages;
    if (pageIndicator) pageIndicator.textContent = `Page ${txState.page} of ${totalPages}`;

    const tbody = $('#tx-table tbody');
    tbody.innerHTML = pagedList.map(t => {
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

function buildPrintableTransactionsHtml(list) {
    const rows = list.map(t => `
        <tr>
            <td>${escapeHtml(t.id)}</td>
            <td>${escapeHtml(new Date(t.date).toLocaleString('en-US'))}</td>
            <td>${escapeHtml(t.cashierId || 'Unknown')}</td>
            <td>${escapeHtml((t.items || []).join(', '))}</td>
            <td>${escapeHtml(peso2(t.total || 0))}</td>
            <td>${escapeHtml(peso2(t.amountChange || 0))}</td>
            <td>${escapeHtml(t.status || 'Completed')}</td>
            <td>${escapeHtml(t.paymentMethod || 'Cash')}</td>
        </tr>
    `).join('');

    return `<!doctype html><html><head><title>Mango Royal Transactions Export</title>
        <style>body{font:14px Arial,sans-serif;padding:28px;color:#1f2937}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin-top:18px}td,th{border:1px solid #d1d5db;padding:8px;text-align:left}th{background:#f3f4f6}@media print{button{display:none}}</style>
        </head><body><h1>Transaction Export</h1><p>Generated ${escapeHtml(new Date().toLocaleString())}</p>
        <table><thead><tr><th>Order ID</th><th>Date &amp; Time</th><th>Cashier</th><th>Items</th><th>Total</th><th>Change</th><th>Status</th><th>Payment</th></tr></thead><tbody>${rows}</tbody></table><button onclick="window.print()">Print / Save as PDF</button></body></html>`;
}

function runTransactionsExport(mode = 'digital') {
    const list = filterTransactions();
    if (!list.length) return alert('No transactions to export.');

    const exportLabel = mode === 'digital' ? 'Digital Export' : mode === 'print' ? 'Print' : 'Digital + Print Export';
    recordActivity({
        user: 'Admin User',
        action: 'Exported transactions',
        details: `Transaction list exported via ${exportLabel}.`,
        category: 'Transactions'
    });

    if (mode === 'digital' || mode === 'digital-print') {
        let csv = 'Order ID,Date,Cashier,Items,Total,Change,Status,Payment Method\n';
        list.forEach(t => {
            csv += `"${t.id}","${new Date(t.date).toISOString()}","${t.cashierId}","${(t.items || []).join('; ')}",${t.total},${t.amountChange||0},"${t.status}","${t.paymentMethod}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transactions_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    if (mode === 'print' || mode === 'digital-print') {
        const w = window.open('', '_blank', 'width=1000,height=700');
        if (!w) return alert('Popups blocked. Please allow popups to print or save the transaction export.');
        w.document.write(buildPrintableTransactionsHtml(list));
        w.document.close();
    }
}

const exportTxButton = $('#export-tx-btn');
if (exportTxButton) {
    const exportWrap = document.createElement('div');
    exportWrap.className = 'report-export-wrap';
    exportTxButton.parentNode.insertBefore(exportWrap, exportTxButton);
    exportWrap.appendChild(exportTxButton);

    const exportMenu = document.createElement('div');
    exportMenu.className = 'report-export-menu';
    exportMenu.innerHTML = `
        <button type="button" class="report-export-option is-primary" data-tx-export-mode="digital">Digital Export</button>
        <button type="button" class="report-export-option" data-tx-export-mode="print">Print</button>
        <button type="button" class="report-export-option is-danger" data-tx-export-mode="digital-print">Digital + Print Export</button>
    `;
    exportWrap.appendChild(exportMenu);

    const toggleMenu = () => {
        const isOpen = exportWrap.classList.contains('open');
        document.querySelectorAll('.report-export-wrap').forEach(item => item.classList.remove('open'));
        if (!isOpen) exportWrap.classList.add('open');
        exportTxButton.setAttribute('aria-expanded', String(exportWrap.classList.contains('open')));
    };

    exportTxButton.addEventListener('click', event => {
        event.stopPropagation();
        toggleMenu();
    });

    exportMenu.querySelectorAll('[data-tx-export-mode]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const mode = button.dataset.txExportMode;
            runTransactionsExport(mode);
            exportWrap.classList.remove('open');
            exportTxButton.setAttribute('aria-expanded', 'false');
        });
    });

    document.addEventListener('click', event => {
        if (!exportWrap.contains(event.target)) {
            exportWrap.classList.remove('open');
            exportTxButton.setAttribute('aria-expanded', 'false');
        }
    });
}

/* ---------- Menu Management ---------- */
let menuCategory = 'all';
let menuShowArchived = false;

function isMenuArchived(item) {
    return Boolean(item?.archived);
}

function getMenuState(item) {
    if (isMenuArchived(item)) {
        return { label: 'Archived', className: 'is-archived' };
    }
    return item?.available ? { label: 'Available', className: 'is-available' } : { label: 'Unavailable', className: 'is-unavailable' };
}

function renderMenu() {
    const chips = ['all','BEST_SELLERS','PREMIUM','BASIC','SEASONAL'];
    const visibleItems = menuItems.filter(i => menuShowArchived ? isMenuArchived(i) : !isMenuArchived(i));
    $('#menu-chips').innerHTML = chips.map(c => {
        const count = c === 'all' ? visibleItems.length : visibleItems.filter(i => i.category === c).length;
        return `<button class="chip ${menuCategory===c?'active':''}" data-cat="${c}" aria-pressed="${menuCategory===c}">${escapeHtml(categoryLabels[c])} <span class="count">${count}</span></button>`;
    }).join('');
    $$('#menu-chips .chip').forEach(b => b.addEventListener('click', () => { menuCategory = b.dataset.cat; renderMenu(); }));

    const archiveBtn = $('#menu-archive-toggle');
    const archiveBadge = $('#menu-archive-badge');
    const archivedCount = menuItems.filter(i => isMenuArchived(i)).length;
    if (archiveBtn) {
        archiveBtn.classList.toggle('is-active', menuShowArchived);
        archiveBtn.setAttribute('aria-pressed', String(menuShowArchived));
        const icon = archiveBtn.querySelector('.menu-archive-icon');
        const text = archiveBtn.querySelector('.menu-archive-text');
        if (menuShowArchived) {
            if (icon) icon.textContent = '←';
            if (text) text.textContent = 'Back';
        } else {
            if (icon) icon.textContent = 'A';
            if (text) text.textContent = 'Archived';
        }
    }
    if (archiveBadge) archiveBadge.textContent = archivedCount;

    const list = menuCategory === 'all' ? visibleItems : visibleItems.filter(i => i.category === menuCategory);
    const resultCount = $('#menu-result-count');
    const label = menuShowArchived ? (list.length === 1 ? 'archived item' : 'archived items') : (list.length === 1 ? 'item' : 'items');
    if (resultCount) resultCount.textContent = `${list.length} ${label}`;

    if (list.length === 0) {
        const emptyText = menuShowArchived ? 'No archived items in this category.' : 'There are no products in this category.';
        $('#menu-grid').innerHTML = `<div class="menu-empty"><span class="menu-empty-icon" aria-hidden="true">◇</span><strong>${menuShowArchived ? 'No archived items' : 'No menu items yet'}</strong><span>${emptyText}</span></div>`;
        return;
    }

    $('#menu-grid').innerHTML = list.map(i => {
        const imgSrc = i.image ? (i.image.startsWith('http') ? i.image : `${API_BASE}/images/${i.image}`) : 'MangoRoyal.png';
        const status = getMenuState(i);
        return `
        <article class="menu-card ${i.available ? '' : 'unavailable'} ${isMenuArchived(i) ? 'is-archived' : ''}">
            <div class="menu-card-image">
                <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(i.name)}" loading="lazy" onerror="this.onerror=null;this.src='MangoRoyal.png';">
                <span class="menu-availability ${status.className}">
                    <span class="availability-dot" aria-hidden="true"></span>${status.label}
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
                <button class="menu-action-toggle ${i.available ? '' : 'is-unavailable'}" data-toggle="${escapeHtml(i.id)}" aria-label="Mark ${escapeHtml(i.name)} ${i.available ? 'out of stock' : 'available'}" ${isMenuArchived(i) ? 'disabled' : ''}>
                    <span aria-hidden="true">${i.available ? '●' : '○'}</span>${i.available ? 'Available' : 'Unavailable'}
                </button>
                <button class="menu-action-edit" data-edit="${escapeHtml(i.id)}" aria-label="Edit ${escapeHtml(i.name)}">Edit</button>
                <button class="menu-action-delete ${isMenuArchived(i) ? 'is-archived' : ''}" data-archive="${escapeHtml(i.id)}" aria-label="Archive ${escapeHtml(i.name)}" title="${isMenuArchived(i) ? 'Archived item' : 'Archive item'}">
                    <span class="archive-mark" aria-hidden="true">A</span>
                    <span class="archive-loading" aria-hidden="true"></span>
                </button>
            </div>
        </article>
        `;
    }).join('');

    // Toggle Availability (persists to DB via API)
    $$('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
        const id = b.dataset.toggle;
        const it = menuItems.find(x => x.id === id);
        if (!it || isMenuArchived(it)) return;
        const previousState = it.available;
        it.available = !it.available;
        renderMenu();

        try {
            await fetch(`${API_BASE}/api/admin/menu/${id}/toggle`, { method: 'PATCH' });
            recordActivity({
                user: 'Admin User',
                action: 'Toggled item availability',
                details: `${it.name} set to ${it.available ? 'available' : 'unavailable'} for ordering.`,
                category: 'Menu'
            });
        } catch (e) {
            it.available = previousState;
            renderMenu();
            console.warn('Toggle failed on server', e);
        }
    }));

    // Edit Item Modal
    $$('[data-edit]').forEach(b => b.addEventListener('click', () => openMenuModal(menuItems.find(x => x.id === b.dataset.edit))));

    // Archive Item (no permanent delete)
    $$('[data-archive]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.archive;
        const it = menuItems.find(x => x.id === id);
        if (!it || isMenuArchived(it)) return;

        openModal('Archive Item', `
            <div class="archive-confirmation">
                <div class="archive-confirmation-icon" aria-hidden="true">A</div>
                <div class="archive-confirmation-copy">
                    <h4>Archive "${escapeHtml(it.name)}"?</h4>
                    <p>This will keep it in the catalog but remove it from active sales.</p>
                </div>
            </div>
        `, [
            { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
            {
                label: 'Archive Item',
                cls: 'btn btn-danger',
                action: async () => {
                    closeModal();
                    b.disabled = true;
                    b.classList.add('is-loading');
                    const previousState = { archived: it.archived, available: it.available };
                    it.archived = true;
                    it.available = false;
                    persistMenuArchiveState();
                    renderMenu();
                    try {
                        await fetch(`${API_BASE}/api/admin/menu/${id}`, { method: 'DELETE' });
                        recordActivity({
                            user: 'Admin User',
                            action: 'Archived item',
                            details: `${it.name} was archived and removed from active ordering.`,
                            category: 'Menu'
                        });
                    } catch (e) {
                        it.archived = previousState.archived;
                        it.available = previousState.available;
                        persistMenuArchiveState();
                        renderMenu();
                        console.warn('Archive failed on server', e);
                    } finally {
                        b.disabled = false;
                        b.classList.remove('is-loading');
                    }
                }
            }
        ]);
    }));
}
$('#menu-archive-toggle')?.addEventListener('click', () => {
    menuShowArchived = !menuShowArchived;
    renderMenu();
});
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
                    recordActivity({
                        user: 'Admin User',
                        action: 'Added menu item',
                        details: `${updated.name} was added to the menu.`,
                        category: 'Menu'
                    });
                } else {
                    updated.id = it.id;
                    const oldTall = Number(it.price?.tall ?? 0);
                    const oldGrande = Number(it.price?.grande ?? 0);
                    const newTall = Number(updated.price?.tall ?? 0);
                    const newGrande = Number(updated.price?.grande ?? 0);
                    const response = await fetch(`${API_BASE}/api/admin/menu/${it.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updated)
                    });
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok) throw new Error(result.error || `Update failed (HTTP ${response.status}).`);
                    menuItems = menuItems.map(x => x.id === it.id ? updated : x);

                    if (oldTall !== newTall || oldGrande !== newGrande) {
                        recordActivity({
                            user: 'Admin User',
                            action: 'Updated menu item',
                            details: `${updated.name} price changed from ₱${oldTall} / ₱${oldGrande} to ₱${newTall} / ₱${newGrande}.`,
                            category: 'Menu'
                        });
                    }
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
function syncReportRangeControl() {
    const reportRange = $('#report-range');
    if (!reportRange) return;
    const mappedValue = salesInterval === 'day' ? 'day' : salesInterval;
    if (reportRange.value !== mappedValue) {
        reportRange.value = mappedValue;
    }
}

function renderReports() {
    applyReportSections();
    syncReportRangeControl();
    const list = (overviewData.topProducts || []);
    const totalSales = overviewData.todaySales || 0;
    const totalOrders = overviewData.totalOrders || 0;
    const avgVal = Number(overviewData.averageOrderValue || 0);
    const paymentMethods = Array.isArray(overviewData.paymentMethods) ? overviewData.paymentMethods : [];
    const intervalLabelMap = {
        day: 'Today',
        yesterday: 'Yesterday',
        week: 'This Week',
        month: 'This Month',
        year: 'This Year'
    };
    const currentLabel = intervalLabelMap[salesInterval] || 'Selected Interval';

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
        : `<tr><td colspan="3" class="empty">No payment transactions recorded for ${currentLabel.toLowerCase()}.</td></tr>`;

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
        if (insSales) insSales.textContent = `${currentLabel} revenue is ${peso(totalSales)} across ${totalOrders} order(s) with an average ticket size of ${peso(avgVal)}.`;
        if (insSalesTag) { insSalesTag.textContent = 'Active Revenue'; insSalesTag.className = 'tag green'; }

        if (insPeak) insPeak.textContent = `Most order activity recorded during: ${overviewData.peakTime || 'recent hours'}.`;
        if (insPeakTag) { insPeakTag.textContent = overviewData.peakTime || 'Active Shift'; insPeakTag.className = 'tag orange'; }

        const topItem = list.length ? list[0] : null;
        if (insTop && topItem) insTop.textContent = `${topItem.name} leads product sales with ${topItem.sold} unit(s) generating ${peso(topItem.revenue)}.`;
        if (insTopTag && topItem) { insTopTag.textContent = topItem.name; insTopTag.className = 'tag purple'; }

        if (insStaff) insStaff.textContent = `Kitchen order transitions are smooth. Maintain preparation readiness during ${overviewData.peakTime || 'active periods'}.`;
        if (insStaffTag) { insStaffTag.textContent = 'Optimal Prep'; insStaffTag.className = 'tag blue'; }
    } else {
        if (insSales) insSales.textContent = `No sales recorded yet for ${currentLabel.toLowerCase()}. Start placing customer orders to view trends.`;
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
    recordActivity({
        user: 'Admin User',
        action: 'Exported end-of-day report',
        details: 'End-of-Day (Z-Reading) report was generated for review/printing.',
        category: 'Reports'
    });

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

function buildPrintableReportHtml(report) {
    const printableRows = reportRows(report).map(row => `
        <tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>
    `).join('');
    return `<!doctype html><html><head><title>Mango Royal Sales Report</title>
        <style>body{font:14px Arial,sans-serif;padding:28px;color:#1f2937}h1{font-size:20px}
        table{border-collapse:collapse;width:100%;margin-top:18px}td{border:1px solid #d1d5db;padding:8px}
        tr:first-child{font-weight:bold;background:#f3f4f6}@media print{button{display:none}}</style>
        </head><body><h1>Mango Royal Sales Report</h1><p>Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString())}</p>
        <table>${printableRows}</table><button onclick="window.print()">Print / Save as PDF</button></body></html>`;
}

function openPrintableReport(report) {
    const windowRef = window.open('', '_blank', 'width=900,height=700');
    if (!windowRef) return alert('Popups blocked. Allow popups to print or save the report.');
    windowRef.document.write(buildPrintableReportHtml(report));
    windowRef.document.close();
    return windowRef;
}

function runReportExport(mode = 'digital') {
    const report = getReportExportData();
    const doDigital = mode === 'digital' || mode === 'digital-print';
    const doPrint = mode === 'print' || mode === 'digital-print';
    const exportLabel = mode === 'digital' ? 'Digital Export' : mode === 'print' ? 'Print' : 'Digital + Print Export';

    recordActivity({
        user: 'Admin User',
        action: 'Exported sales report',
        details: `Sales report was exported via ${exportLabel}.`,
        category: 'Reports'
    });

    if (doDigital) {
        if (adminSettings.defaultFormat === 'json') {
            downloadReport(JSON.stringify(report, null, 2), 'application/json', 'json');
        } else if (adminSettings.defaultFormat === 'pdf') {
            openPrintableReport(report);
        } else {
            downloadReport(reportCsv(report), 'text/csv;charset=utf-8', 'csv');
        }
    }

    if (doPrint) {
        openPrintableReport(report);
    }
}

const exportRepButton = $('#export-rep-btn');
if (exportRepButton) {
    const exportWrap = document.createElement('div');
    exportWrap.className = 'report-export-wrap';
    exportRepButton.parentNode.insertBefore(exportWrap, exportRepButton);
    exportWrap.appendChild(exportRepButton);

    const exportMenu = document.createElement('div');
    exportMenu.className = 'report-export-menu';
    exportMenu.innerHTML = `
        <button type="button" class="report-export-option is-primary" data-export-mode="digital">Digital Export</button>
        <button type="button" class="report-export-option" data-export-mode="print">Print</button>
        <button type="button" class="report-export-option is-danger" data-export-mode="digital-print">Digital + Print Export</button>
    `;
    exportWrap.appendChild(exportMenu);

    const toggleMenu = () => {
        const isOpen = exportWrap.classList.contains('open');
        document.querySelectorAll('.report-export-wrap').forEach(item => item.classList.remove('open'));
        if (!isOpen) exportWrap.classList.add('open');
        exportRepButton.setAttribute('aria-expanded', String(exportWrap.classList.contains('open')));
    };

    exportRepButton.addEventListener('click', event => {
        event.stopPropagation();
        toggleMenu();
    });

    exportMenu.querySelectorAll('[data-export-mode]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            runReportExport(button.dataset.exportMode);
            closeReportExportMenu();
        });
    });

    function closeReportExportMenu() {
        document.querySelectorAll('.report-export-wrap').forEach(item => item.classList.remove('open'));
        exportRepButton.setAttribute('aria-expanded', 'false');
    }

    document.addEventListener('click', event => {
        if (!exportWrap.contains(event.target)) closeReportExportMenu();
    });
}

/* ---------- Activity Log ---------- */
function renderActivityLog() {
    const tbody = $('#activity-table tbody');
    const total = activityLogs.length;
    const menu = activityLogs.filter(item => item.category === 'Menu').length;
    const system = activityLogs.filter(item => item.category === 'System').length;
    const today = activityLogs.filter(item => item.timestamp.toDateString() === new Date().toDateString()).length;

    $('#activity-total').textContent = total;
    $('#activity-menu').textContent = menu;
    $('#activity-system').textContent = system;
    $('#activity-today').textContent = today;

    tbody.innerHTML = activityLogs
        .slice()
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .map(log => `
            <tr>
                <td>${log.timestamp.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td>${escapeHtml(log.user)}</td>
                <td>${escapeHtml(log.action)}</td>
                <td>${escapeHtml(log.details)}</td>
                <td><span class="pill ${log.category.toLowerCase()}">${escapeHtml(log.category)}</span></td>
            </tr>
        `).join('');
}
$('#activity-refresh')?.addEventListener('click', renderActivityLog);

/* ---------- Users ---------- */
function renderUsers() {
    const active = users.filter(u => u.status === 'Active' && !u.archived).length;
    const archivedCount = archivedUsers.length;
    const visibleUsers = showArchivedUsers ? archivedUsers : users.filter(u => !u.archived);

    $('#usr-total').textContent    = users.length + archivedUsers.length;
    $('#usr-active').textContent   = active;
    $('#usr-inactive').textContent = users.length - active;
    const archiveToggle = $('#user-archive-toggle');
    const archiveBadge = $('#user-archive-badge');
    if (archiveToggle) {
        archiveToggle.classList.toggle('is-active', showArchivedUsers);
        archiveToggle.setAttribute('aria-pressed', String(showArchivedUsers));
        const icon = archiveToggle.querySelector('.menu-archive-icon');
        const text = archiveToggle.querySelector('.menu-archive-text');
        if (showArchivedUsers) {
            if (icon) icon.textContent = '←';
            if (text) text.textContent = 'Back';
        } else {
            if (icon) icon.textContent = 'A';
            if (text) text.textContent = 'Archived';
        }
    }
    if (archiveBadge) archiveBadge.textContent = archivedCount;

    const roleCls = { Admin:'admin', Manager:'manager', Cashier:'cashier', 'Kitchen Staff':'kitchen' };
    $('#user-table tbody').innerHTML = visibleUsers.map(u => `
        <tr>
            <td><b>${u.id}</b></td>
            <td>${u.name}</td>
            <td>${u.email}</td>
            <td><span class="pill ${roleCls[u.role]||''}">${u.role}</span></td>
            <td><span class="pill ${u.status.toLowerCase()}">${u.status}</span></td>
            <td>${u.lastLogin.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
            <td>
                ${showArchivedUsers ? '<button class="btn btn-sm btn-ghost" data-u-restore="' + u.id + '">Restore</button>' : `
                    <button class="btn btn-sm btn-ghost" data-u-toggle="${u.id}">${u.status==='Active'?'Deactivate':'Activate'}</button>
                    <button class="btn btn-sm btn-info" data-u-edit="${u.id}">Edit</button>
                    <button class="btn btn-sm btn-danger" data-u-del="${u.id}" title="Archive user">A</button>
                `}
            </td>
        </tr>
    `).join('');

    $$('[data-u-toggle]').forEach(b => b.addEventListener('click', () => {
        const u = users.find(x => x.id === b.dataset.uToggle);
        if (!u) return;
        u.status = u.status === 'Active' ? 'Inactive' : 'Active';
        renderUsers();
    }));
    $$('[data-u-edit]').forEach(b => b.addEventListener('click', () => openUserModal(users.find(x => x.id === b.dataset.uEdit))));
    $$('[data-u-del]').forEach(b => b.addEventListener('click', () => {
        const u = users.find(x => x.id === b.dataset.uDel);
        if (!u) return;
        openModal('Archive User', `
            <div class="archive-confirmation">
                <div class="archive-confirmation-icon" aria-hidden="true">A</div>
                <div class="archive-confirmation-copy">
                    <h4>Archive "${escapeHtml(u.name)}"?</h4>
                    <p>This will keep the user record on file but remove them from active access.</p>
                </div>
            </div>
        `, [
            { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
            {
                label: 'Archive User',
                cls: 'btn btn-danger',
                action: () => {
                    closeModal();
                    const archivedEntry = { ...u, archived: true, status: 'Archived' };
                    archivedUsers.unshift(archivedEntry);
                    users = users.filter(x => x.id !== u.id);
                    renderUsers();
                    recordActivity({
                        user: 'Admin User',
                        action: 'Archived user',
                        details: `${u.name} was archived and removed from active access.`,
                        category: 'Users'
                    });
                }
            }
        ]);
    }));
    $$('[data-u-restore]').forEach(b => b.addEventListener('click', () => {
        const u = archivedUsers.find(x => x.id === b.dataset.uRestore);
        if (!u) return;
        const restoredUser = { ...u, archived: false, status: 'Active' };
        users.push(restoredUser);
        archivedUsers = archivedUsers.filter(x => x.id !== u.id);
        showArchivedUsers = false;
        renderUsers();
        recordActivity({
            user: 'Admin User',
            action: 'Restored archived user',
            details: `${u.name} was restored and returned to active access.`,
            category: 'Users'
        });
    }));
}
$('#user-add').addEventListener('click', () => openUserModal(null));
$('#user-archive-toggle')?.addEventListener('click', () => {
    showArchivedUsers = !showArchivedUsers;
    renderUsers();
});

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
                users.push({ id: `${prefix}-${String(n).padStart(3,'0')}`, name, email, role, status, lastLogin: new Date(), archived: false });
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
    const thinking = appendAssistantMessage("Checking today's dashboard data...", 'thinking');
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
switchView(getStoredAdminView());
loadAdminSettings();
loadTransactionsData();
loadMenuData();
