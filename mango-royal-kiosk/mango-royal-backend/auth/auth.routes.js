const crypto = require('crypto');
const express = require('express');
const { promisify } = require('util');
const { readAdminSettings } = require('../config/admin-settings');

const router = express.Router();
const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

const configuredUsers = [
    {
        username: process.env.STAFF_ADMIN_USERNAME || 'admin',
        password: process.env.STAFF_ADMIN_PASSWORD || 'MangoAdmin2026!',
        displayName: 'Mango Royal Admin',
        role: 'admin',
    },
    {
        username: process.env.STAFF_CASHIER_USERNAME || 'cashier',
        password: process.env.STAFF_CASHIER_PASSWORD || 'MangoCashier2026!',
        displayName: 'Mango Royal Cashier',
        role: 'pos',
    },
    {
        username: process.env.STAFF_KITCHEN_USERNAME || 'kitchen',
        password: process.env.STAFF_KITCHEN_PASSWORD || 'MangoKitchen2026!',
        displayName: 'Mango Royal Kitchen',
        role: 'kitchen',
    },
];

if (new Set(configuredUsers.map(user => user.username.trim().toLowerCase())).size !== configuredUsers.length) {
    throw new Error('Staff login usernames must be unique.');
}
if (configuredUsers.some(user => user.password.length < 12)) {
    throw new Error('Staff login passwords must contain at least 12 characters.');
}

const credentialStore = Promise.all(configuredUsers.map(async user => {
    const salt = crypto.randomBytes(16);
    return {
        username: user.username.trim().toLowerCase(),
        displayName: user.displayName,
        role: user.role,
        salt,
        passwordHash: await scrypt(user.password, salt, 64),
    };
}));
const sessions = new Map();
const loginAttempts = new Map();

function getClientAddress(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

function getSession(req) {
    const header = req.get('authorization') || '';
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
    if (!match) return null;

    const session = sessions.get(match[1]);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(match[1]);
        return null;
    }
    return session;
}

function requireRole(role) {
    return (req, res, next) => {
        const session = getSession(req);
        if (!session) return res.status(401).json({ error: 'Login required' });
        if (session.role !== role) return res.status(403).json({ error: 'Your account cannot access this app' });
        req.staff = session;
        next();
    };
}

router.post('/login', async (req, res) => {
    const address = getClientAddress(req);
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (session.expiresAt <= now) sessions.delete(token);
    }
    for (const [client, state] of loginAttempts) {
        if (state.resetAt <= now) loginAttempts.delete(client);
    }
    const attempt = loginAttempts.get(address);
    if (attempt && attempt.resetAt > now && attempt.count >= MAX_LOGIN_ATTEMPTS) {
        return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }
    const currentAttempt = attempt && attempt.resetAt > now
        ? attempt
        : { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    currentAttempt.count += 1;
    loginAttempts.set(address, currentAttempt);

    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const users = await credentialStore;
    const user = users.find(candidate => candidate.username === username);
    const comparisonUser = user || users[0];
    const submittedHash = await scrypt(password, comparisonUser.salt, 64);
    const passwordMatches = crypto.timingSafeEqual(submittedHash, comparisonUser.passwordHash);

    if (!user || !passwordMatches) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (req.body?.appRole && req.body.appRole !== user.role) {
        return res.status(403).json({ error: 'This account cannot access the selected app' });
    }

    loginAttempts.delete(address);
    const settings = await readAdminSettings();
    const token = crypto.randomBytes(32).toString('base64url');
    const session = {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        expiresAt: now + Math.min(
            SESSION_TTL_MS,
            settings.security.sessionTimeoutMinutes * 60 * 1000
        ),
    };
    sessions.set(token, session);
    res.json({ token, user: { username: user.username, displayName: user.displayName, role: user.role }, expiresAt: session.expiresAt });
});

router.get('/me', (req, res) => {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Login required' });
    res.json({
        user: { username: session.username, displayName: session.displayName, role: session.role },
        expiresAt: session.expiresAt,
    });
});

router.post('/logout', (req, res) => {
    const header = req.get('authorization') || '';
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
    if (match) sessions.delete(match[1]);
    res.json({ success: true });
});

module.exports = { router, requireRole };
