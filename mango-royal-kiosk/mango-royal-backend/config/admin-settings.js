const db = require('./db');

const DEFAULT_ADMIN_SETTINGS = {
    reportFrequency: 'daily',
    defaultFormat: 'csv',
    recipients: '',
    reportSections: {
        salesSummary: true,
        productPerformance: true,
        paymentMethods: true,
        hourlySalesTrend: false,
    },
    security: {
        sessionTimeoutMinutes: 480,
    },
    appearance: {
        theme: 'light',
        accentColor: '#f97316',
    },
};

let settingsTableReady;

class SettingsValidationError extends Error {}

function ensureAdminSettingsTable() {
    if (!settingsTableReady) {
        settingsTableReady = db.query(`
            CREATE TABLE IF NOT EXISTS admin_settings (
                settings_id TINYINT PRIMARY KEY,
                settings_json JSON NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `).catch(err => {
            settingsTableReady = null;
            throw err;
        });
    }
    return settingsTableReady;
}

async function readAdminSettings() {
    await ensureAdminSettingsTable();
    const [rows] = await db.query(
        'SELECT settings_json FROM admin_settings WHERE settings_id = 1'
    );
    if (!rows.length) return structuredClone(DEFAULT_ADMIN_SETTINGS);
    const stored = typeof rows[0].settings_json === 'string'
        ? JSON.parse(rows[0].settings_json)
        : rows[0].settings_json;
    return {
        ...structuredClone(DEFAULT_ADMIN_SETTINGS),
        ...stored,
        reportSections: {
            ...DEFAULT_ADMIN_SETTINGS.reportSections,
            ...(stored.reportSections || {}),
        },
        security: {
            ...DEFAULT_ADMIN_SETTINGS.security,
            ...(stored.security || {}),
        },
        appearance: {
            ...DEFAULT_ADMIN_SETTINGS.appearance,
            ...(stored.appearance || {}),
        },
    };
}

function normalizeAdminSettings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new SettingsValidationError('Settings must be an object.');
    }
    const { reportFrequency, defaultFormat, recipients, reportSections, security, appearance } = value;
    if (!['daily', 'weekly', 'monthly', 'quarterly'].includes(reportFrequency)) {
        throw new SettingsValidationError('Choose a valid report frequency.');
    }
    if (!['csv', 'json', 'pdf'].includes(defaultFormat)) {
        throw new SettingsValidationError('Choose a supported report format.');
    }
    if (typeof recipients !== 'string' || recipients.length > 2000) {
        throw new SettingsValidationError('Report recipients must be a comma-separated email list under 2000 characters.');
    }
    const emails = recipients.split(',').map(email => email.trim()).filter(Boolean);
    if (emails.some(email => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email))) {
        throw new SettingsValidationError('Enter valid email addresses separated by commas.');
    }
    const sectionKeys = Object.keys(DEFAULT_ADMIN_SETTINGS.reportSections);
    if (!reportSections || sectionKeys.some(key => typeof reportSections[key] !== 'boolean')) {
        throw new SettingsValidationError('Choose a value for every report section.');
    }
    const timeout = Number(security?.sessionTimeoutMinutes);
    if (!Number.isInteger(timeout) || timeout < 5 || timeout > 480) {
        throw new SettingsValidationError('Session timeout must be between 5 and 480 minutes.');
    }
    const themes = ['light', 'dark', 'auto'];
    const accents = ['#f97316', '#2563eb', '#16a34a', '#9333ea'];
    if (!themes.includes(appearance?.theme) || !accents.includes(appearance?.accentColor)) {
        throw new SettingsValidationError('Choose a valid theme and accent color.');
    }
    return {
        reportFrequency,
        defaultFormat,
        recipients: emails.join(', '),
        reportSections: Object.fromEntries(sectionKeys.map(key => [key, reportSections[key]])),
        security: { sessionTimeoutMinutes: timeout },
        appearance: {
            theme: appearance.theme,
            accentColor: appearance.accentColor,
        },
    };
}

async function saveAdminSettings(settings) {
    await ensureAdminSettingsTable();
    await db.query(
        `INSERT INTO admin_settings (settings_id, settings_json)
         VALUES (1, ?)
         ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)`,
        [JSON.stringify(settings)]
    );
    return settings;
}

module.exports = {
    DEFAULT_ADMIN_SETTINGS,
    SettingsValidationError,
    ensureAdminSettingsTable,
    normalizeAdminSettings,
    readAdminSettings,
    saveAdminSettings,
};
