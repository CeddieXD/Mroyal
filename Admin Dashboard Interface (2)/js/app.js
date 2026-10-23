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
    posFeatures: { endOfDayReceiptEnabled: false },
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
    intervalSummary: null,
    topProducts: [],
    hourly: []
};

let recentTransactions = [];
let menuItems = [];
const preloadedMenuImages = new Set();
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
let activityLogs = [];
try {
    const savedLogs = JSON.parse(localStorage.getItem(ACTIVITY_LOG_STORAGE_KEY) || '[]');
    if (Array.isArray(savedLogs)) {
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
    fetch(`${API_BASE}/api/admin/activity-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, details, category })
    }).then(async response => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        const index = activityLogs.findIndex(log => log.id === entry.id);
        if (index !== -1) {
            activityLogs[index] = { ...result, timestamp: new Date(result.timestamp) };
            try {
                localStorage.setItem(ACTIVITY_LOG_STORAGE_KEY, JSON.stringify(activityLogs.slice(0, 200)));
            } catch (storageError) {
                console.warn('Could not update the local activity cache:', storageError);
            }
            if (document.getElementById('view-activity')?.classList.contains('active')) renderActivityLog();
        }
    }).catch(error => console.error('Could not record activity on the server:', error));
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
$('#report-range')?.addEventListener('change', event => {
    salesInterval = event.target.value;
    persistAdminInterval();
    loadOverviewData();
});
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

function preloadMenuImages(items) {
    items.forEach(item => {
        if (!item.image) return;
        const src = item.image.startsWith('http')
            ? item.image
            : `${API_BASE}/images/${encodeURIComponent(item.image.replace(/^\/?images\//, ''))}`;
        if (preloadedMenuImages.has(src)) return;
        preloadedMenuImages.add(src);
        const image = new Image();
        image.decoding = 'async';
        image.fetchPriority = 'low';
        image.onerror = () => {
            console.warn(`Could not preload menu image for "${item.name}": ${src}`);
            preloadedMenuImages.delete(src);
        };
        image.src = src;
    });
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
    if (activeView === 'activity') void loadActivityLog();
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
                'voidedOrders'
            ];
            operationalMetricsAvailable = operationalFields.every(key => Number.isFinite(Number(data[key])));
            if (!operationalMetricsAvailable) {
                console.warn('Operations analytics are missing from the overview API. Restart the backend to load the latest metrics.');
            }
            overviewData = {
                ...overviewData,
                ...data,
                intervalSummary: data.salesInterval === requestedInterval ? data.intervalSummary || null : null,
                topProducts: data.salesInterval === requestedInterval && Array.isArray(data.topProducts) ? data.topProducts : [],
                paymentMethods: data.salesInterval === requestedInterval && Array.isArray(data.paymentMethods) ? data.paymentMethods : [],
                salesTimeline: data.salesInterval === requestedInterval && Array.isArray(data.salesTimeline) ? data.salesTimeline : [],
            };
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
                preloadMenuImages(menuItems);
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
        posFeatures: {
            ...DEFAULT_ADMIN_SETTINGS.posFeatures,
            ...(settings.posFeatures || {})
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
    $('#setting-eod-receipt').checked = settings.posFeatures.endOfDayReceiptEnabled;
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
        posFeatures: {
            endOfDayReceiptEnabled: $('#setting-eod-receipt').checked
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
            const vatExemptAmount = t.discount ? Number(t.discount.vatExemptAmount || 0) : 0;
            const discountDetails = t.discount?.details;
            const eligibleGross = Number(discountDetails?.eligibleGross || 0);
            const vatExclusiveEligible = Number(discountDetails?.vatExclusiveAmount || 0);
            const discountBasis = discountDetails?.scope === 'individual_share'
                ? `Individual share: ${Number(discountDetails.cardholderCount)} of ${Number(discountDetails.totalPeople)} people`
                : discountDetails?.scope === 'selected_items'
                    ? `Selected for ${Number(discountDetails.cardholderCount)} cardholder(s): ${(Array.isArray(discountDetails.eligibleItems)
                        ? discountDetails.eligibleItems.map(eligible => {
                            const item = orderItems.find(orderItem => Number(orderItem.order_item_id) === Number(eligible.orderItemId));
                            const itemName = item ? `${item.name}${item.size_name ? ` (${item.size_name})` : ''}` : 'Order item';
                            return `${itemName} ×${Number(eligible.servings)} serving(s)`;
                        })
                        : []).join(', ')}`
                    : '';
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
                                ${t.discount && discountDetails ? `<div><span>Eligible gross portion</span><b>${peso2(eligibleGross)}</b></div>` : ''}
                                ${t.discount && discountDetails ? `<div><span>VAT-exclusive eligible portion</span><b>${peso2(vatExclusiveEligible)}</b></div>` : ''}
                                ${t.discount ? `<div class="order-discount"><span>${escapeHtml(t.discount.type)} discount</span><b>−${peso2(discountAmount)}</b></div>` : ''}
                                ${t.discount && vatExemptAmount ? `<div class="order-discount"><span>VAT exemption</span><b>−${peso2(vatExemptAmount)}</b></div>` : ''}
                                ${discountBasis ? `<div class="order-discount"><span>${escapeHtml(discountBasis)}</span></div>` : ''}
                                <div class="order-grand-total"><span>Amount due</span><b>${peso2(Math.max(0, Number(t.total) - discountAmount - vatExemptAmount))}</b></div>
                                ${t.paymentAmount != null ? `<div><span>Payment received</span><b>${peso2(t.paymentAmount)}</b></div>` : ''}
                                <div><span>Change</span><b>${peso2(t.amountChange || 0)}</b></div>
                            </div>
                        </section>
                        <section class="order-info-panel" aria-label="Order information">
                            <div class="order-section-head"><h4>Order information</h4></div>
                            <dl class="order-info-list">
                                <div><dt>Payment method</dt><dd>${escapeHtml(t.paymentMethod || 'Not recorded')}</dd></div>
                                <div><dt>Order source</dt><dd>${escapeHtml(t.cashierId || 'Not recorded')}</dd></div>
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

function buildTransactionsPreviewHtml(list, generatedAt, filterSummary) {
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

    const totalSales = list.reduce((sum, transaction) => sum + Number(transaction.total || 0), 0);
    const averageOrder = list.length ? totalSales / list.length : 0;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Mango Royal Transaction Report</title>
        <style>
        :root{font-family:Inter,"Segoe UI",Arial,sans-serif;color:#172033;background:#f1f5f9}
        *{box-sizing:border-box}body{margin:0;padding:32px 20px}.report{max-width:1200px;margin:0 auto;background:#fff;padding:40px;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 14px 40px #0f172a12}
        .masthead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:24px;border-bottom:2px solid #f97316}
        h1{margin:0;font-size:26px;letter-spacing:-.03em}.subtitle{margin:8px 0 0;color:#64748b}.meta{text-align:right;color:#64748b;font-size:13px;line-height:1.7}
        section{margin-top:28px}h2{font-size:18px;margin:0 0 14px}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
        .metric{padding:18px;border:1px solid #e2e8f0;border-radius:14px;background:linear-gradient(145deg,#fff,#fff7ed)}.metric span{display:block;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}.metric strong{display:block;margin-top:8px;font-size:24px}
        .table-wrap{overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:9px 10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#fff7ed;color:#9a3412;font-size:10px;text-transform:uppercase;letter-spacing:.05em}tbody tr:last-child td{border-bottom:0}
        .footer{margin-top:30px;padding-top:16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px}
        @media(max-width:640px){body{padding:0}.report{padding:22px 16px;border-radius:0}.masthead{display:block}.meta{text-align:left;margin-top:14px}.summary{grid-template-columns:1fr}}
        @page{size:A4 landscape;margin:10mm}
        @media print{:root{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{padding:0;background:#fff}.report{max-width:none;border:0;border-radius:0;box-shadow:none;padding:0}.table-wrap{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}}
        </style></head><body><main class="report">
        <header class="masthead"><div><h1>Mango Royal Transaction Report</h1><p class="subtitle">${escapeHtml(filterSummary)}</p></div>
        <div class="meta"><div><strong>Transactions</strong>: ${list.length.toLocaleString('en-US')}</div><div><strong>Generated</strong>: ${escapeHtml(generatedAt)}</div></div></header>
        <section><h2>Transaction Summary</h2><div class="summary">
            <div class="metric"><span>Transactions</span><strong>${list.length.toLocaleString('en-US')}</strong></div>
            <div class="metric"><span>Total Amount</span><strong>${escapeHtml(peso(totalSales))}</strong></div>
            <div class="metric"><span>Average Order</span><strong>${escapeHtml(peso(averageOrder))}</strong></div>
        </div></section>
        <section><h2>Transaction Details</h2><div class="table-wrap"><table><thead><tr><th>Order ID</th><th>Date &amp; Time</th><th>Cashier</th><th>Items</th><th>Total</th><th>Change</th><th>Status</th><th>Payment</th></tr></thead><tbody>${rows}</tbody></table></div></section>
        <footer class="footer">Mango Royal · Transaction Report · Generated ${escapeHtml(generatedAt)}</footer>
        </main></body></html>`;
}

function runTransactionsExport(mode = 'digital') {
    const list = filterTransactions();
    if (!list.length) return alert('No transactions to export.');

    const generatedAt = new Date().toLocaleString();
    const selectedLabel = selector => {
        const element = document.querySelector(selector);
        return element?.selectedOptions?.[0]?.textContent.trim() || 'All';
    };
    const filters = [
        `Time: ${selectedLabel('#tx-time')}`,
        `Status: ${selectedLabel('#tx-status')}`,
        `Payment: ${selectedLabel('#tx-payment')}`,
        `Day: ${selectedLabel('#tx-day')}`
    ];
    const search = $('#tx-search')?.value.trim();
    if (search) filters.push(`Search: ${search}`);
    const filterSummary = `Filters — ${filters.join(' · ')}`;
    const csvRows = [
        ['Order ID', 'Date', 'Cashier', 'Items', 'Total', 'Change', 'Status', 'Payment Method'],
        ...list.map(t => [
            t.id,
            new Date(t.date).toISOString(),
            t.cashierId || 'Unknown',
            (t.items || []).join('; '),
            Number(t.total || 0),
            Number(t.amountChange || 0),
            t.status || 'Completed',
            t.paymentMethod || 'Cash'
        ])
    ];
    const csv = csvRows.map(row => row.map(value => {
        const text = String(value ?? '');
        const safeText = typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
        return `"${safeText.replace(/"/g, '""')}"`;
    }).join(',')).join('\r\n');
    const activityAction = mode === 'digital' ? 'Downloaded transaction CSV'
        : mode === 'json' ? 'Downloaded transaction JSON'
            : mode === 'preview' ? 'Previewed transactions'
                : mode === 'digital-print' ? 'Exported transactions'
                    : 'Opened transaction print preview';
    const activityDetails = mode === 'digital-print'
        ? 'Transaction CSV was downloaded and its print preview was opened.'
        : `${list.length} filtered transaction(s) ${mode === 'print' ? 'were opened in print preview' : mode === 'preview' ? 'were previewed' : 'were downloaded'}.`;
    recordActivity({
        user: 'Admin User',
        action: activityAction,
        details: activityDetails,
        category: 'Transactions'
    });

    if (mode === 'digital' || mode === 'digital-print') {
        downloadReport(csv, 'text/csv;charset=utf-8', 'csv');
    }
    if (mode === 'json') {
        downloadReport(JSON.stringify({
            title: 'Mango Royal Transaction Report',
            generatedAt: new Date().toISOString(),
            transactions: list.map(t => ({ ...t, date: new Date(t.date).toISOString() }))
        }, null, 2), 'application/json', 'json');
    }
    if (mode === 'preview' || mode === 'print' || mode === 'digital-print') {
        const report = {
            generatedAt,
            intervalLabel: `${list.length.toLocaleString('en-US')} filtered transactions`
        };
        openReportPreview(report, {
            title: 'Transaction Report Preview',
            html: buildTransactionsPreviewHtml(list, generatedAt, filterSummary),
            frameTitle: 'Transaction report preview',
            printLabel: 'Print Transactions',
            category: 'Transactions',
            action: 'Printed transaction report',
            activityDetails: `Transaction report for ${list.length} filtered transaction(s) was opened in the browser print dialog.`
        });
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
        <button type="button" class="report-export-option is-primary" data-tx-export-mode="preview">Preview Transactions</button>
        <button type="button" class="report-export-option" data-tx-export-mode="print">Print Transactions</button>
        <button type="button" class="report-export-option" data-tx-export-mode="digital">Download CSV</button>
        <button type="button" class="report-export-option" data-tx-export-mode="json">Download JSON</button>
        <button type="button" class="report-export-option" data-tx-export-mode="digital-print">Download CSV + Preview</button>
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

function getMenuItemSizes(item) {
    if (Array.isArray(item?.sizes)) {
        return item.sizes
            .filter(size => size?.size && Number.isFinite(Number(size.price)))
            .map(size => ({ ...size, size: String(size.size), price: Number(size.price) }));
    }
    return Object.entries(item?.price || {})
        .filter(([, price]) => Number.isFinite(Number(price)))
        .map(([size, price]) => ({ size, price: Number(price) }));
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
            if (icon) icon.innerHTML = '<span class="archive-icon-shape"></span>';
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
        const sizes = getMenuItemSizes(i);
        return `
        <article class="menu-card ${i.available ? '' : 'unavailable'} ${isMenuArchived(i) ? 'is-archived' : ''}">
            <div class="menu-card-image">
                <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(i.name)}" decoding="async" fetchpriority="low" onerror="this.onerror=null;this.src='MangoRoyal.png';">
                <span class="menu-availability ${status.className}">
                    <span class="availability-dot" aria-hidden="true"></span>${status.label}
                </span>
            </div>
            <div class="menu-body">
                <span class="menu-cat">${escapeHtml(categoryLabels[i.category] || i.category)}</span>
                <h3 class="menu-name">${escapeHtml(i.name)}</h3>
                <p class="menu-desc">${escapeHtml(i.description || 'No description provided.')}</p>
                <div class="menu-price">
                    ${sizes.map(size => `<span><span class="price-size">${escapeHtml(size.size)}</span><b>${peso(size.price)}</b></span>`).join('')}
                </div>
            </div>
            <div class="menu-actions">
                <button class="menu-action-toggle ${i.available ? '' : 'is-unavailable'}" data-toggle="${escapeHtml(i.id)}" aria-label="Mark ${escapeHtml(i.name)} ${i.available ? 'out of stock' : 'available'}" ${isMenuArchived(i) ? 'disabled' : ''}>
                    <span aria-hidden="true">${i.available ? '●' : '○'}</span>${i.available ? 'Available' : 'Unavailable'}
                </button>
                <button class="menu-action-edit" data-edit="${escapeHtml(i.id)}" aria-label="Edit ${escapeHtml(i.name)}">Edit</button>
                <button class="menu-action-delete ${isMenuArchived(i) ? 'is-archived' : ''}" data-archive="${escapeHtml(i.id)}" aria-label="Archive ${escapeHtml(i.name)}" title="${isMenuArchived(i) ? 'Archived item' : 'Archive item'}">
                    <span class="archive-mark" aria-hidden="true"><span class="archive-icon-shape"></span></span>
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
                <div class="archive-confirmation-icon" aria-hidden="true"><span class="archive-icon-shape"></span></div>
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
    const it = item || { id:'', name:'', description:'', category:'BEST_SELLERS', available:true, image:'MangoRoyal.png' };
    const sizes = isNew
        ? [{ size: 'Tall', price: 120 }, { size: 'Grande', price: 145 }]
        : getMenuItemSizes(it);
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
            ${sizes.map((size, index) => `<label>${escapeHtml(size.size)} Price (₱)<input type="number" min="0" step="0.01" id="m-price-${index}" value="${size.price}"></label>`).join('')}
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
                const updatedSizes = sizes.map((size, index) => ({
                    ...size,
                    price: Number($(`#m-price-${index}`).value)
                }));
                if (updatedSizes.some(size => !Number.isFinite(size.price) || size.price < 0)) {
                    throw new Error('Enter a valid price for every available size.');
                }
                const updated = {
                    name,
                    description: $('#m-desc').value.trim(),
                    category: $('#m-cat').value,
                    image,
                    sizes: updatedSizes,
                    price: Object.fromEntries(updatedSizes.map(size => [size.size.toLowerCase(), size.price])),
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
                    preloadMenuImages([updated]);
                    menuItems.push(updated);
                    recordActivity({
                        user: 'Admin User',
                        action: 'Added menu item',
                        details: `${updated.name} was added to the menu.`,
                        category: 'Menu'
                    });
                } else {
                    updated.id = it.id;
                    const oldPrices = getMenuItemSizes(it).map(size => `${size.size}: ${peso(size.price)}`).join(' / ');
                    const newPrices = updatedSizes.map(size => `${size.size}: ${peso(size.price)}`).join(' / ');
                    const response = await fetch(`${API_BASE}/api/admin/menu/${it.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updated)
                    });
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok) throw new Error(result.error || `Update failed (HTTP ${response.status}).`);
                    preloadMenuImages([updated]);
                    menuItems = menuItems.map(x => x.id === it.id ? updated : x);

                    if (oldPrices !== newPrices) {
                        recordActivity({
                            user: 'Admin User',
                            action: 'Updated menu item',
                            details: `${updated.name} price changed from ${oldPrices || 'no sizes'} to ${newPrices || 'no sizes'}.`,
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
    const intervalDataMatches = overviewData.salesInterval === salesInterval && overviewData.intervalSummary !== null;
    const list = intervalDataMatches && Array.isArray(overviewData.topProducts) ? overviewData.topProducts : [];
    const intervalSummary = intervalDataMatches
        ? overviewData.intervalSummary || { sales: 0, transactions: 0, averageOrderValue: 0 }
        : { sales: 0, transactions: 0, averageOrderValue: 0 };
    const totalSales = Number(intervalSummary.sales || 0);
    const totalOrders = Number(intervalSummary.transactions || 0);
    const avgVal = Number(intervalSummary.averageOrderValue || 0);
    const paymentMethods = intervalDataMatches && Array.isArray(overviewData.paymentMethods)
        ? overviewData.paymentMethods
        : [];
    const intervalLabelMap = {
        day: 'Today',
        yesterday: 'Yesterday',
        week: 'This Week',
        month: 'This Month',
        year: 'This Year'
    };
    const currentLabel = intervalLabelMap[salesInterval] || 'Selected Interval';
    const timeline = intervalDataMatches && Array.isArray(overviewData.salesTimeline) ? overviewData.salesTimeline : [];
    const peakPoint = timeline
        .filter(point => Number(point.orders) > 0)
        .sort((a, b) => Number(b.orders) - Number(a.orders) || Number(b.sales) - Number(a.sales))[0];
    const peakPeriod = peakPoint?.label || 'No peak yet';

    $('#rep-total-sales').textContent = peso(totalSales);
    $('#rep-total-tx').textContent    = totalOrders;
    $('#rep-avg-val').textContent     = peso(avgVal);
    $('#rep-payment-subtitle').textContent = `${currentLabel} transactions by payment type`;

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
    const trendLabels = timeline.map(point => point.label);
    const trendSales = timeline.map(point => Number(point.sales) || 0);
    const trendOrders = timeline.map(point => Number(point.orders) || 0);
    $('#rep-trend-subtitle').textContent = `Sales trend for ${currentLabel}`;

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
            labels: trendLabels,
            datasets: [
                { label:'Sales (₱)', yAxisID:'y', data: trendSales, backgroundColor:'#F97316', borderRadius: 4, maxBarThickness: 28 },
                { label:'Orders', yAxisID:'orders', data: trendOrders, backgroundColor:'#3B82F6', borderRadius: 4, maxBarThickness: 28 },
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

        if (insPeak) insPeak.textContent = `Most order activity recorded during: ${peakPeriod}.`;
        if (insPeakTag) { insPeakTag.textContent = peakPeriod; insPeakTag.className = 'tag orange'; }

        const topItem = list.length ? list[0] : null;
        if (insTop && topItem) insTop.textContent = `${topItem.name} leads product sales with ${topItem.sold} unit(s) generating ${peso(topItem.revenue)}.`;
        if (insTopTag && topItem) { insTopTag.textContent = topItem.name; insTopTag.className = 'tag purple'; }

        if (insStaff) insStaff.textContent = `Kitchen order transitions are smooth. Maintain preparation readiness during ${peakPeriod}.`;
        if (insStaffTag) { insStaffTag.textContent = 'Optimal Prep'; insStaffTag.className = 'tag blue'; }
    } else {
        if (insSales) insSales.textContent = `No sales recorded yet for ${currentLabel.toLowerCase()}. Start placing customer orders to view trends.`;
        if (insSalesTag) { insSalesTag.textContent = 'Awaiting Orders'; insSalesTag.className = 'tag orange'; }

        if (insPeak) insPeak.textContent = `Peak activity for ${currentLabel.toLowerCase()} will appear when orders are recorded.`;
        if (insPeakTag) { insPeakTag.textContent = 'No Peak Yet'; insPeakTag.className = 'tag orange'; }

        if (insTop) insTop.textContent = 'Top performing items will appear here once orders are verified.';
        if (insTopTag) { insTopTag.textContent = 'Pending Data'; insTopTag.className = 'tag purple'; }

        if (insStaff) insStaff.textContent = `Kitchen and Cashier POS are linked and ready to receive ${currentLabel.toLowerCase()} orders.`;
        if (insStaffTag) { insStaffTag.textContent = 'Ready'; insStaffTag.className = 'tag green'; }
    }
}

// End-of-Day (Z-Reading) Report
$('#eod-report-btn')?.addEventListener('click', async () => {
    recordActivity({
        user: 'Admin User',
        action: 'Previewed end-of-day report',
        details: 'End-of-Day (Z-Reading) report was prepared for preview.',
        category: 'Reports'
    });

    const totalSales = overviewData.todaySales || 0;
    const totalOrders = overviewData.totalOrders || 0;
    const avgVal = totalOrders ? (totalSales / totalOrders).toFixed(2) : '0.00';
    const top = overviewData.topProducts || [];
    const report = {
        title: 'End-of-Day Financial Summary (Z-Reading)',
        generatedAt: new Date().toLocaleString(),
        rows: [
            ['Metric', 'Value'],
            ['Total Completed Orders', totalOrders],
            ['Gross Sales Revenue', `PHP ${Number(totalSales).toFixed(2)}`],
            ['Average Ticket Size', `PHP ${avgVal}`],
            ['Peak Time Window', overviewData.peakTime || 'N/A'],
            ['Item Breakdown', ''],
            ...(top.length
                ? top.map(product => [`${product.name} (x${product.sold})`, `PHP ${Number(product.revenue).toFixed(2)}`])
                : [['No items sold today', 'PHP 0.00']]),
            ['NET REGISTER TOTAL', `PHP ${Number(totalSales).toFixed(2)}`],
            ['Document', 'Official system generated audit document'],
        ],
    };
    openReportPreview(report);
});

function getReportExportData() {
    const interval = salesInterval;
    const intervalLabel = {
        day: 'Today',
        yesterday: 'Yesterday',
        week: 'This Week',
        month: 'This Month',
        year: 'This Year'
    }[interval] || 'Selected interval';
    if (overviewData.salesInterval !== interval || !overviewData.intervalSummary) {
        throw new Error(`Report data for ${intervalLabel.toLowerCase()} is still loading. Please try again shortly.`);
    }
    const products = Array.isArray(overviewData.topProducts) ? overviewData.topProducts : [];
    const payments = Array.isArray(overviewData.paymentMethods) ? overviewData.paymentMethods : [];
    const intervalSummary = overviewData.intervalSummary;

    return {
        title: 'Mango Royal Sales Report & Analytics',
        generatedAt: new Date().toISOString(),
        interval,
        intervalLabel,
        salesSummary: {
            period: intervalLabel,
            sales: Number(intervalSummary.sales || 0),
            transactions: Number(intervalSummary.transactions || 0),
            averageOrderValue: Number(intervalSummary.averageOrderValue || 0)
        },
        productPerformance: {
            top: products[0] || null,
            least: products[products.length - 1] || null,
            products
        },
        paymentMethods: payments,
        insights: [
            {
                title: 'Sales Performance',
                text: $('#ins-sales')?.textContent || 'No sales insight available.',
                tag: $('#ins-sales-tag')?.textContent || ''
            },
            {
                title: 'Peak Period',
                text: $('#ins-peak')?.textContent || 'No peak-period insight available.',
                tag: $('#ins-peak-tag')?.textContent || ''
            },
            {
                title: 'Top Product',
                text: $('#ins-top')?.textContent || 'No product insight available.',
                tag: $('#ins-top-tag')?.textContent || ''
            },
            {
                title: 'Staffing & Operations',
                text: $('#ins-staff')?.textContent || 'No operations insight available.',
                tag: $('#ins-staff-tag')?.textContent || ''
            }
        ]
    };
}

function reportRows(report) {
    const rows = [
        ['Section', 'Metric', 'Value', 'Details'],
        ['Report', 'Interval', report.intervalLabel, ''],
        ['Report', 'Generated', new Date(report.generatedAt).toLocaleString(), '']
    ];
    const summary = report.salesSummary;
    rows.push(
        ['Basic Sales Report', 'Reporting period', summary.period, ''],
        ['Basic Sales Report', 'Total Sales', summary.sales, ''],
        ['Basic Sales Report', 'Transactions', summary.transactions, 'Non-voided orders'],
        ['Basic Sales Report', 'Avg Order Value', summary.averageOrderValue, 'Per transaction']
    );
    const performance = report.productPerformance;
    rows.push(
        ['Product Performance', 'Top Selling Product', performance.top?.name || 'None yet', performance.top ? `${performance.top.sold} units sold; revenue ${performance.top.revenue}` : '0 units sold'],
        ['Product Performance', 'Least Selling Product', performance.least?.name || 'None yet', performance.least ? `${performance.least.sold} units sold; revenue ${performance.least.revenue}` : '0 units sold']
    );
    performance.products.forEach((product, index) => {
        rows.push(['Product Performance', `#${index + 1} ${product.name}`, product.sold, `Revenue: ${product.revenue}`]);
    });
    if (!performance.products.length) {
        rows.push(['Product Performance', 'Items sold', 0, 'No sales data recorded']);
    }
    report.paymentMethods.forEach(payment => {
        rows.push(['Payment Methods', payment.method || 'Unknown', payment.transactions, `Sales: ${payment.sales}`]);
    });
    if (!report.paymentMethods.length) {
        rows.push(['Payment Methods', 'Payment methods', 'No data', `No payment transactions recorded for ${report.intervalLabel}`]);
    }
    report.insights.forEach(insight => {
        rows.push(['Key Insights & Recommendations', insight.title, insight.text, insight.tag ? `Tag: ${insight.tag}` : '']);
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

function buildReportPreviewHtml(report) {
    if (Array.isArray(report.rows)) {
        const [headers, ...rows] = report.rows;
        const tableRows = rows.map(row => `
            <tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>
        `).join('');
        const generatedAt = new Date(report.generatedAt).toLocaleString();
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
            <title>${escapeHtml(report.title)}</title>
            <style>
            :root{font-family:Inter,"Segoe UI",Arial,sans-serif;color:#172033;background:#f1f5f9}
            *{box-sizing:border-box}body{margin:0;padding:32px 20px}.report{max-width:900px;margin:0 auto;background:#fff;padding:40px;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 14px 40px #0f172a12}
            header{padding-bottom:22px;border-bottom:2px solid #f97316}h1{margin:0;font-size:25px}header p{color:#64748b;font-size:13px}
            table{border-collapse:collapse;width:100%;margin-top:24px;font-size:13px}th,td{padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#fff7ed;color:#9a3412;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
            @media(max-width:640px){body{padding:0}.report{padding:22px 16px;border-radius:0}}
            </style></head><body><main class="report"><header><h1>${escapeHtml(report.title)}</h1><p>Generated ${escapeHtml(generatedAt)}</p></header>
            <table><thead><tr>${headers.map(cell => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table></main></body></html>`;
    }
    const formatCurrency = value => peso(Number(value) || 0);
    const table = (headers, rows, emptyText) => `
        <div class="table-wrap"><table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${rows.length
            ? rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${headers.length}" class="empty">${escapeHtml(emptyText)}</td></tr>`}</tbody></table></div>`;
    const summary = report.salesSummary;
    const products = report.productPerformance.products;
    const productRows = products.map((product, index) => [
        `#${index + 1}`,
        product.name,
        Number(product.sold).toLocaleString('en-US'),
        formatCurrency(product.revenue)
    ]);
    const paymentRows = report.paymentMethods.map(payment => [
        payment.method || 'Unknown',
        Number(payment.transactions || 0).toLocaleString('en-US'),
        formatCurrency(payment.sales)
    ]);
    const insightCards = report.insights.map(insight => `
        <article class="insight"><h3>${escapeHtml(insight.title)}</h3><p>${escapeHtml(insight.text)}</p>
        ${insight.tag ? `<span>${escapeHtml(insight.tag)}</span>` : ''}</article>`).join('');
    const generatedAt = new Date(report.generatedAt).toLocaleString();

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(report.title)}</title>
        <style>
        :root{font-family:Inter,"Segoe UI",Arial,sans-serif;color:#172033;background:#f1f5f9}
        *{box-sizing:border-box}body{margin:0;padding:32px 20px}.report{max-width:1050px;margin:0 auto;background:#fff;padding:40px;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 14px 40px #0f172a12}
        .masthead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:24px;border-bottom:2px solid #f97316}
        h1{margin:0;font-size:26px;letter-spacing:-.03em}.subtitle{margin:8px 0 0;color:#64748b}.meta{text-align:right;color:#64748b;font-size:13px;line-height:1.7}
        section{margin-top:28px;break-inside:avoid}h2{font-size:18px;margin:0 0 14px}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
        .metric{padding:18px;border:1px solid #e2e8f0;border-radius:14px;background:linear-gradient(145deg,#fff,#fff7ed)}.metric span{display:block;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}.metric strong{display:block;margin-top:8px;font-size:24px}
        .highlight-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.highlight{padding:14px 16px;border:1px solid #e2e8f0;border-radius:12px}.highlight span{display:block;color:#64748b;font-size:12px}.highlight strong{display:block;margin-top:6px;font-size:16px}
        .table-wrap{overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#fff7ed;color:#9a3412;font-size:11px;text-transform:uppercase;letter-spacing:.05em}tbody tr:last-child td{border-bottom:0}.empty{color:#64748b;text-align:center}
        .insights{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.insight{padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0}.insight h3{font-size:14px;margin:0 0 8px}.insight p{margin:0;color:#475569;line-height:1.55}.insight span{display:inline-block;margin-top:10px;padding:4px 8px;border-radius:999px;background:#ffedd5;color:#9a3412;font-size:11px;font-weight:700}
        .footer{margin-top:30px;padding-top:16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px}
        @media(max-width:640px){body{padding:0}.report{padding:22px 16px;border-radius:0}.masthead{display:block}.meta{text-align:left;margin-top:14px}.summary{grid-template-columns:1fr}.highlight-grid,.insights{grid-template-columns:1fr}}
        @page{size:A4;margin:14mm}
        @media print{:root{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{padding:0;background:#fff}.report{max-width:none;border:0;border-radius:0;box-shadow:none;padding:0}.table-wrap{overflow:visible}section{break-inside:avoid}.insight{break-inside:avoid}}
        </style></head><body><main class="report">
        <header class="masthead"><div><h1>${escapeHtml(report.title)}</h1><p class="subtitle">Sales performance, product mix, payment breakdown, and operating insights.</p></div>
        <div class="meta"><div><strong>Reporting interval</strong>: ${escapeHtml(report.intervalLabel)}</div><div><strong>Generated</strong>: ${escapeHtml(generatedAt)}</div></div></header>
        <section><h2>Basic Sales Report · ${escapeHtml(summary.period)}</h2><div class="summary">
            <div class="metric"><span>Total Sales</span><strong>${escapeHtml(formatCurrency(summary.sales))}</strong></div>
            <div class="metric"><span>Transactions</span><strong>${escapeHtml(Number(summary.transactions).toLocaleString('en-US'))}</strong></div>
            <div class="metric"><span>Avg Order Value</span><strong>${escapeHtml(formatCurrency(summary.averageOrderValue))}</strong></div>
        </div></section>
        <section><h2>Product Performance · ${escapeHtml(report.intervalLabel)}</h2><div class="highlight-grid">
            <div class="highlight"><span>Top Selling Product</span><strong>${escapeHtml(report.productPerformance.top?.name || 'None yet')}</strong>
            <span>${report.productPerformance.top ? `${escapeHtml(Number(report.productPerformance.top.sold).toLocaleString('en-US'))} units sold · ${escapeHtml(formatCurrency(report.productPerformance.top.revenue))}` : '0 units sold'}</span></div>
            <div class="highlight"><span>Least Selling Product</span><strong>${escapeHtml(report.productPerformance.least?.name || 'None yet')}</strong>
            <span>${report.productPerformance.least ? `${escapeHtml(Number(report.productPerformance.least.sold).toLocaleString('en-US'))} units sold · ${escapeHtml(formatCurrency(report.productPerformance.least.revenue))}` : '0 units sold'}</span></div>
        </div><h3>QTY Sold per Item</h3>${table(['Rank', 'Product', 'Qty', 'Revenue'], productRows, 'No sales data recorded for this interval.')}</section>
        <section><h2>Payment Methods · ${escapeHtml(report.intervalLabel)}</h2><p class="subtitle">${escapeHtml(report.intervalLabel)} transactions by payment type.</p>
            ${table(['Payment Method', 'Transactions', 'Sales'], paymentRows, `No payment transactions recorded for ${report.intervalLabel.toLowerCase()}.`)}</section>
        <section><h2>Key Insights &amp; Recommendations</h2><div class="insights">${insightCards}</div></section>
        <footer class="footer">Mango Royal · Sales Report &amp; Analytics · Generated ${escapeHtml(generatedAt)}</footer>
        </main></body></html>`;
}

function openReportPreview(report, options = {}) {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'report-preview-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'report-preview-title');
    overlay.innerHTML = `
        <div class="report-preview-toolbar">
            <h2 id="report-preview-title">${escapeHtml(options.title || 'Report Preview')}</h2>
            <div class="report-preview-actions">
                <button type="button" class="btn btn-primary" data-print-report-preview>${escapeHtml(options.printLabel || 'Print Report')}</button>
                <button type="button" class="btn btn-ghost" data-close-report-preview>Close Preview</button>
            </div>
        </div>
        <iframe class="report-preview-frame" title="${escapeHtml(options.frameTitle || 'Full sales report preview')}"></iframe>
    `;
    const frame = overlay.querySelector('iframe');
    frame.srcdoc = options.html || buildReportPreviewHtml(report);
    const closeButton = overlay.querySelector('[data-close-report-preview]');
    const printButton = overlay.querySelector('[data-print-report-preview]');
    printButton.addEventListener('click', () => {
        try {
            frame.contentWindow.focus();
            frame.contentWindow.print();
            recordActivity({
                user: 'Admin User',
                action: options.action || 'Printed sales report',
                details: options.activityDetails || `Report${report.intervalLabel ? ` for ${report.intervalLabel}` : ''} was opened in the browser print dialog.`,
                category: options.category || 'Reports'
            });
        } catch (error) {
            alert(`Could not open the print dialog: ${error.message}`);
        }
    });
    const closePreview = () => {
        overlay.remove();
        document.body.classList.remove('report-preview-open');
        document.removeEventListener('keydown', handlePreviewKeydown);
        previousFocus?.focus?.();
    };
    const handlePreviewKeydown = event => {
        if (event.key === 'Escape') closePreview();
    };
    closeButton.addEventListener('click', closePreview);
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closePreview();
    });
    document.addEventListener('keydown', handlePreviewKeydown);
    document.body.classList.add('report-preview-open');
    document.body.appendChild(overlay);
    closeButton.focus();
    return overlay;
}

function runReportExport(mode = 'preview') {
    let report;
    try {
        report = getReportExportData();
    } catch (error) {
        alert(error.message);
        return;
    }
    const resolvedMode = mode === 'default'
        ? adminSettings.defaultFormat === 'csv'
            ? 'csv'
            : adminSettings.defaultFormat === 'json'
                ? 'json'
                : 'preview'
        : mode;
    const exportLabels = {
        print: 'Printer',
        preview: 'Full Report Preview',
        default: `Default Format (${adminSettings.defaultFormat.toUpperCase()})`,
        csv: 'CSV Download',
        json: 'JSON Download'
    };

    if (resolvedMode === 'print') {
        openReportPreview(report);
        return;
    }

    recordActivity({
        user: 'Admin User',
        action: 'Exported sales report',
        details: `Sales report was prepared via ${exportLabels[mode] || exportLabels.preview}.`,
        category: 'Reports'
    });

    if (resolvedMode === 'csv') {
        downloadReport(reportCsv(report), 'text/csv;charset=utf-8', 'csv');
        return;
    }
    if (resolvedMode === 'json') {
        downloadReport(JSON.stringify(report, null, 2), 'application/json', 'json');
        return;
    }
    openReportPreview(report);
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
        <button type="button" class="report-export-option" data-export-mode="print">Print Report</button>
        <button type="button" class="report-export-option is-primary" data-export-mode="preview">Preview Full Report</button>
        <button type="button" class="report-export-option" data-export-mode="default">Export Default Format</button>
        <button type="button" class="report-export-option" data-export-mode="csv">Download CSV</button>
        <button type="button" class="report-export-option" data-export-mode="json">Download JSON</button>
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
async function loadActivityLog() {
    try {
        const response = await fetch(`${API_BASE}/api/admin/activity-logs`);
        const result = await response.json().catch(() => []);
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (!Array.isArray(result)) throw new Error('The activity log response is invalid.');
        activityLogs = result.map(log => ({ ...log, timestamp: new Date(log.timestamp) }));
        localStorage.setItem(ACTIVITY_LOG_STORAGE_KEY, JSON.stringify(activityLogs.slice(0, 200)));
        renderActivityLog();
    } catch (error) {
        console.error('Could not load the server activity log:', error);
        renderActivityLog();
    }
}
$('#activity-refresh')?.addEventListener('click', () => void loadActivityLog());

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
            if (icon) icon.innerHTML = '<span class="archive-icon-shape"></span>';
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
                    <button class="btn btn-sm btn-danger" data-u-del="${u.id}" title="Archive user" aria-label="Archive ${escapeHtml(u.name)}"><span class="archive-icon-shape" aria-hidden="true"></span></button>
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
                <div class="archive-confirmation-icon" aria-hidden="true"><span class="archive-icon-shape"></span></div>
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
const assistantOpenButton = $('#assistant-open');
let draggedDashboardCard = null;

function setAssistantOpen(isOpen) {
    assistantDock.classList.toggle('is-open', isOpen);
    $('#assistant-open').setAttribute('aria-expanded', String(isOpen));
    assistantPanel.setAttribute('aria-hidden', String(!isOpen));
    if (isOpen) requestAnimationFrame(() => assistantInput.focus());
}

function highlightAssistantDropTarget() {
    assistantDock.classList.add('is-drag-target');
    const hint = $('#assistant-capsule-hint');
    if (hint) {
        hint.dataset.defaultText ||= hint.textContent;
        hint.textContent = `Drop “${draggedDashboardCard?.dataset.cardLabel || 'card'}” to send to AI`;
    }
}

function createDashboardDragPreview(card, dataTransfer) {
    const preview = document.createElement('div');
    preview.className = 'dashboard-drag-preview';

    const mark = document.createElement('span');
    mark.className = 'dashboard-drag-preview-mark';
    mark.textContent = 'AI';

    const copy = document.createElement('span');
    copy.className = 'dashboard-drag-preview-copy';
    const title = document.createElement('strong');
    title.textContent = 'Send to Royal Insights';
    const key = document.createElement('small');
    key.textContent = `Card key: ${card.dataset.cardType || 'dashboard-card'}`;
    copy.append(title, key);
    preview.append(mark, copy);
    document.body.appendChild(preview);
    dataTransfer.setDragImage(preview, 18, 18);
    window.setTimeout(() => preview.remove(), 0);
}

function resetDashboardCardDrag() {
    draggedDashboardCard?.classList.remove('is-dragging');
    draggedDashboardCard = null;
    assistantDock.classList.remove('is-drag-target', 'is-drop-target');
    const hint = $('#assistant-capsule-hint');
    if (hint?.dataset.defaultText) hint.textContent = hint.dataset.defaultText;
}

function appendAssistantInlineMarkdown(parent, text) {
    const tokenPattern = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\*[^*\n]+?\*|_[^_\n]+?_)/g;
    let lastIndex = 0;

    for (const match of text.matchAll(tokenPattern)) {
        const index = match.index;
        if (index > lastIndex) parent.appendChild(document.createTextNode(text.slice(lastIndex, index)));

        const token = match[0];
        const isBold = token.startsWith('**') || token.startsWith('__');
        const isCode = token.startsWith('`');
        const wrapper = document.createElement(isBold ? 'strong' : isCode ? 'code' : 'em');
        const delimiterLength = isBold ? 2 : 1;
        wrapper.textContent = token.slice(delimiterLength, -delimiterLength);
        parent.appendChild(wrapper);
        lastIndex = index + token.length;
    }

    if (lastIndex < text.length) parent.appendChild(document.createTextNode(text.slice(lastIndex)));
}

function renderAssistantMarkdown(parent, text) {
    let paragraphLines = [];
    let currentList = null;

    const flushParagraph = () => {
        if (!paragraphLines.length) return;
        const paragraph = document.createElement('p');
        appendAssistantInlineMarkdown(paragraph, paragraphLines.join(' '));
        parent.appendChild(paragraph);
        paragraphLines = [];
    };

    const flushList = () => {
        if (!currentList) return;
        parent.appendChild(currentList);
        currentList = null;
    };

    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        const unorderedItem = /^\s*[-*]\s+(.+)$/.exec(line);
        const orderedItem = /^\s*\d+[.)]\s+(.+)$/.exec(line);

        if (!line.trim()) {
            flushParagraph();
            flushList();
            continue;
        }

        if (heading) {
            flushParagraph();
            flushList();
            const element = document.createElement(`h${Math.min(4, heading[1].length + 1)}`);
            appendAssistantInlineMarkdown(element, heading[2]);
            parent.appendChild(element);
            continue;
        }

        if (unorderedItem || orderedItem) {
            flushParagraph();
            const listTag = unorderedItem ? 'ul' : 'ol';
            if (currentList?.tagName.toLowerCase() !== listTag) {
                flushList();
                currentList = document.createElement(listTag);
            }
            const item = document.createElement('li');
            appendAssistantInlineMarkdown(item, (unorderedItem || orderedItem)[1]);
            currentList.appendChild(item);
            continue;
        }

        flushList();
        paragraphLines.push(line.trim());
    }

    flushParagraph();
    flushList();
}

const salesIntervalLabels = {
    day: 'Today · hourly',
    yesterday: 'Yesterday · hourly',
    week: 'Last 7 days · daily',
    month: 'Month to date · daily',
    year: 'Year to date · monthly'
};

function createDashboardCardSnapshot(card) {
    const type = card.dataset.cardType || 'dashboard-card';
    const cardKey = type;
    const label = card.dataset.cardLabel || 'Dashboard';
    const interval = overviewData.salesInterval || salesInterval;
    const intervalLabel = salesIntervalLabels[interval] || 'Selected interval';
    const topProducts = Array.isArray(overviewData.topProducts) ? overviewData.topProducts : [];
    const timeline = Array.isArray(overviewData.salesTimeline) ? overviewData.salesTimeline : [];
    let metrics = [];
    let dataSummary = '';
    let periodLabel = 'Today';

    if (type === 'sales-chart') {
        periodLabel = intervalLabel;
        const totalSales = timeline.reduce((sum, point) => sum + Number(point.sales || 0), 0);
        const totalOrders = timeline.reduce((sum, point) => sum + Number(point.orders || 0), 0);
        metrics = [
            { label: 'Sales', value: peso(totalSales) },
            { label: 'Orders', value: String(totalOrders) }
        ];
        dataSummary = timeline.length
            ? timeline.map(point => `${point.label}: ${peso(Number(point.sales || 0))}, ${Number(point.orders || 0)} orders`).join('; ')
            : 'No chart data is currently available.';
    } else if (type === 'todays-sales') {
        const todaySales = Number(overviewData.todaySales || 0);
        const salesDelta = Number(overviewData.salesDelta || 0);
        metrics = [
            { label: 'Sales today', value: peso(todaySales) },
            { label: 'Vs yesterday', value: `${salesDelta > 0 ? '+' : ''}${peso(salesDelta)}` }
        ];
        dataSummary = `Sales today: ${peso(todaySales)}; sales difference from yesterday: ${peso(salesDelta)}.`;
    } else if (type === 'total-orders') {
        const totalOrders = Number(overviewData.totalOrders || 0);
        const ordersDelta = Number(overviewData.ordersDelta || 0);
        metrics = [
            { label: 'Orders today', value: String(totalOrders) },
            { label: 'Vs yesterday', value: `${ordersDelta > 0 ? '+' : ''}${ordersDelta}` }
        ];
        dataSummary = `Orders today: ${totalOrders}; order difference from yesterday: ${ordersDelta}.`;
    } else if (type === 'best-seller') {
        periodLabel = intervalLabel;
        const best = topProducts[0];
        metrics = best
            ? [
                { label: 'Top item', value: best.name },
                { label: 'Sold', value: String(Number(best.sold || 0)) },
                { label: 'Revenue', value: peso(Number(best.revenue || 0)) }
            ]
            : [{ label: 'Top item', value: 'No sales yet' }];
        dataSummary = topProducts.length
            ? topProducts.map((item, index) =>
                `${index + 1}. ${item.name}: ${Number(item.sold || 0)} sold, ${peso(Number(item.revenue || 0))} revenue`
            ).join('; ')
            : 'No product sales are recorded for this interval.';
    } else if (type === 'items-sold') {
        periodLabel = intervalLabel;
        const best = topProducts[0];
        metrics = best
            ? [
                { label: 'Top item', value: best.name },
                { label: 'Quantity', value: String(Number(best.sold || 0)) }
            ]
            : [{ label: 'Items sold', value: '0' }];
        dataSummary = topProducts.length
            ? topProducts.map((item, index) =>
                `${index + 1}. ${item.name}: ${Number(item.sold || 0)} sold, ${peso(Number(item.revenue || 0))} revenue`
            ).join('; ')
            : 'No item sales are recorded for this interval.';
    } else if (type === 'operations') {
        metrics = [
            { label: 'Average order', value: operationalMetricsAvailable ? peso(Number(overviewData.averageOrderValue || 0)) : 'Unavailable' },
            { label: 'In progress', value: operationalMetricsAvailable ? String(Number(overviewData.inProgressOrders || 0)) : 'Unavailable' },
            { label: 'Completed', value: operationalMetricsAvailable ? String(Number(overviewData.completedOrders || 0)) : 'Unavailable' },
            { label: 'Voided', value: operationalMetricsAvailable ? String(Number(overviewData.voidedOrders || 0)) : 'Unavailable' }
        ];
        dataSummary = operationalMetricsAvailable
            ? `Average order: ${peso(Number(overviewData.averageOrderValue || 0))}; in progress: ${Number(overviewData.inProgressOrders || 0)}; completed: ${Number(overviewData.completedOrders || 0)}; voided: ${Number(overviewData.voidedOrders || 0)}.`
            : 'Operations metrics are currently unavailable.';
    } else {
        const details = card.innerText.replace(/\s+/g, ' ').trim();
        metrics = [{ label: 'Card data', value: details || label }];
        dataSummary = details || 'No card data is currently available.';
    }

    return {
        cardKey,
        label,
        intervalLabel: periodLabel,
        metrics,
        analysisPrompt: `Dashboard card identifier: ${cardKey}. Display name: "${label}". `
            + `Analyze this identified card for ${periodLabel}. `
            + `Use only the following live dashboard data: ${dataSummary} `
            + 'Summarize the key takeaway and give one practical action. Do not infer missing data.'
    };
}

function appendDashboardCardCapsule(snapshot) {
    const capsule = document.createElement('div');
    capsule.className = 'assistant-message dashboard-context-capsule';
    capsule.setAttribute(
        'aria-label',
        `Sent to AI: ${snapshot.label}, card key ${snapshot.cardKey}, for ${snapshot.intervalLabel}: ${snapshot.metrics.map(metric => `${metric.label}: ${metric.value}`).join(', ')}`
    );

    const mark = document.createElement('span');
    mark.className = 'dashboard-context-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = 'AI';

    const content = document.createElement('span');
    content.className = 'dashboard-context-content';
    const title = document.createElement('strong');
    title.textContent = snapshot.label;
    const interval = document.createElement('small');
    interval.textContent = snapshot.intervalLabel;
    const key = document.createElement('code');
    key.textContent = `Card key: ${snapshot.cardKey}`;
    content.append(title, interval, key);

    const metrics = document.createElement('span');
    metrics.className = 'dashboard-context-metrics';
    snapshot.metrics.forEach(metric => {
        const chip = document.createElement('span');
        chip.textContent = `${metric.label}: ${metric.value}`;
        metrics.appendChild(chip);
    });

    capsule.append(mark, content, metrics);
    assistantMessages.appendChild(capsule);
    assistantMessages.scrollTop = assistantMessages.scrollHeight;
}

function appendAssistantMessage(text, sender) {
    const message = document.createElement('div');
    message.className = `assistant-message ${sender}`;
    if (sender === 'assistant') {
        renderAssistantMarkdown(message, text);
    } else {
        message.textContent = text;
    }
    assistantMessages.appendChild(message);
    assistantMessages.scrollTop = assistantMessages.scrollHeight;
    return message;
}

let assistantRequestPending = false;

async function sendInsightQuestion(question, { dashboardCardSnapshot } = {}) {
    const message = question.trim();
    if (!message || assistantRequestPending) return;

    assistantRequestPending = true;
    assistantDock.classList.add('has-conversation');
    $('#assistant-welcome')?.remove();
    $('#assistant-prompts')?.remove();
    if (dashboardCardSnapshot) {
        appendDashboardCardCapsule(dashboardCardSnapshot);
    } else {
        appendAssistantMessage(message, 'user');
    }
    const sendButton = assistantForm.querySelector('button[type="submit"]');
    sendButton.disabled = true;
    const thinking = appendAssistantMessage('Checking live dashboard data with Royal Insights...', 'thinking');

    try {
        const response = await fetch(`${API_BASE}/api/admin/assistant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `Royal Insights request failed (HTTP ${response.status}).`);
        }
        if (typeof result.reply !== 'string' || !result.reply.trim()) {
            throw new Error('Royal Insights returned an empty response. Please try again.');
        }
        thinking.remove();
        appendAssistantMessage(result.reply.trim(), 'assistant');
    } catch (error) {
        console.error('Royal Insights request failed:', error);
        thinking.remove();
        appendAssistantMessage(error.message || 'Could not reach Royal Insights. Please try again.', 'assistant error');
    } finally {
        assistantRequestPending = false;
        sendButton.disabled = false;
    }
}

document.addEventListener('dragstart', event => {
    const card = event.target.closest?.('#view-dashboard [data-card-type][draggable="true"]');
    if (!card || !event.dataTransfer) return;

    draggedDashboardCard = card;
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', card.dataset.cardType);
    createDashboardDragPreview(card, event.dataTransfer);
    highlightAssistantDropTarget();
});

assistantOpenButton.addEventListener('dragover', event => {
    if (!draggedDashboardCard) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    assistantDock.classList.add('is-drop-target');
});

assistantOpenButton.addEventListener('dragleave', event => {
    if (event.relatedTarget && assistantOpenButton.contains(event.relatedTarget)) return;
    assistantDock.classList.remove('is-drop-target');
});

assistantOpenButton.addEventListener('drop', event => {
    if (!draggedDashboardCard) return;
    event.preventDefault();

    const card = draggedDashboardCard;
    resetDashboardCardDrag();

    const snapshot = createDashboardCardSnapshot(card);
    void sendInsightQuestion(snapshot.analysisPrompt, { dashboardCardSnapshot: snapshot });
});

document.addEventListener('dragend', resetDashboardCardDrag);

$('#assistant-open').addEventListener('click', () => setAssistantOpen(true));
$('#assistant-close').addEventListener('click', () => setAssistantOpen(false));
assistantForm.addEventListener('submit', event => {
    event.preventDefault();
    const question = assistantInput.value;
    if (!question.trim()) return;
    assistantInput.value = '';
    void sendInsightQuestion(question);
});
$('#assistant-prompts').addEventListener('click', event => {
    const prompt = event.target.closest('button');
    if (prompt) void sendInsightQuestion(prompt.textContent);
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
