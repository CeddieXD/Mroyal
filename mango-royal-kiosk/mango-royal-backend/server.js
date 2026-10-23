const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
require('dotenv').config();
const db = require('./config/db'); // Import the separated DB connection
const {
    ensureAuditTable,
    loadOrderItemSnapshots,
    writeItemAuditLogs,
} = require('./audit-logs');
const { printText } = require('./printer-client');

const app = express();
app.use(cors());
app.use(express.json());

async function verifyDatabaseConnection() {
    try {
        await db.query('SELECT 1');
        console.log('Database connection OK.');
    } catch (err) {
        console.error('Database connection failed during startup. Backend will not start.');
        console.error(err.message);
        process.exit(1);
    }
}

const MAX_ORDER_QUANTITY = 20;
const MAX_ADDON_QUANTITY = 10;
const KIOSK_PRINT_TOKEN_TTL_MS = 10 * 60 * 1000;
const kioskPrintSecret = crypto.randomBytes(32);

function createKioskPrintToken(orderId) {
    const expiresAt = Date.now() + KIOSK_PRINT_TOKEN_TTL_MS;
    const signature = crypto.createHmac('sha256', kioskPrintSecret)
        .update(`${orderId}:${expiresAt}`)
        .digest('hex');
    return `${expiresAt}.${signature}`;
}

function isValidKioskPrintToken(orderId, token) {
    if (typeof token !== 'string') return false;
    const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(token);
    if (!match) return false;
    const expiresAt = Number(match[1]);
    if (expiresAt < Date.now() || expiresAt > Date.now() + KIOSK_PRINT_TOKEN_TTL_MS) return false;
    const expected = crypto.createHmac('sha256', kioskPrintSecret)
        .update(`${orderId}:${expiresAt}`)
        .digest();
    const received = Buffer.from(match[2], 'hex');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function formatKioskAcknowledgement(queueNumber) {
    const lines = [
        'MANGO ROYAL',
        'Your order number is',
        queueNumber,
        '',
        'Please present this number',
        'to the cashier.',
        'Thank you!',
    ];
    return { queueNumber, text: lines.join('\n') };
}

let orderItemAddonsReady;
const ensureOrderItemAddonsColumn = () => {
    if (!orderItemAddonsReady) {
        orderItemAddonsReady = db.query("SHOW COLUMNS FROM order_items LIKE 'add_ons'")
            .then(([columns]) => columns.length
                ? undefined
                : db.query('ALTER TABLE order_items ADD COLUMN add_ons JSON NULL'))
            .catch(err => {
                console.error('Failed to prepare order add-ons storage:', err);
                throw err;
            });
    }
    return orderItemAddonsReady;
};

let standardOrderStorageReady;
const ensureStandardOrderStorage = () => {
    if (!standardOrderStorageReady) {
        standardOrderStorageReady = db.query("SHOW COLUMNS FROM orders LIKE 'order_type'")
            .then(async ([columns]) => {
                if (!columns.length) return;
                const column = columns[0];
                if (!String(column.Type).toLowerCase().startsWith('varchar')
                    || column.Default !== 'Standard') {
                    await db.query(
                        "ALTER TABLE orders MODIFY COLUMN order_type VARCHAR(20) NOT NULL DEFAULT 'Standard'"
                    );
                }
                await db.query("UPDATE orders SET order_type = 'Standard' WHERE order_type <> 'Standard'");
                await db.query("UPDATE orders SET status = 'SERVED' WHERE status = 'READY'");
            })
            .catch(err => {
                standardOrderStorageReady = null;
                console.error('Failed to normalize legacy order storage values:', err);
                throw err;
            });
    }
    return standardOrderStorageReady;
};

app.use((_req, _res, next) => {
    Promise.all([ensureOrderItemAddonsColumn(), ensureStandardOrderStorage()])
        .then(() => next(), next);
});

const { router: authRouter, requireRole } = require('./auth/auth.routes');
app.use('/api/auth', authRouter);
app.use('/staff-auth', express.static(path.join(__dirname, 'staff-auth')));

// POS module — endpoints for the Mango Royal POS lite frontend
app.use('/api/pos', requireRole('pos'), require('./pos/pos.routes'));
app.use('/api/kitchen', requireRole('kitchen'), require('./kitchen/kitchen.routes'));
app.use('/api/admin', requireRole('admin'), require('./admin/admin.routes'));
const posBus = require('./pos/events');

// Serve kiosk product images to the POS frontend
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'assets', 'img'), {
    setHeaders: res => {
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    },
}));

// --- ROUTES ---

// Fetch Menu
app.get('/api/products', async (req, res) => {
    try {
        const sql = `
            SELECT p.product_id, p.name, p.description, p.ingredients, p.bundle_quantity, p.image_url, c.category_name,
                   pv.variant_id, pv.size_name, pv.price
            FROM Products p
            JOIN Product_Variants pv ON p.product_id = pv.product_id
            JOIN Categories c ON p.category_id = c.category_id
            WHERE p.is_available = TRUE AND pv.is_available = TRUE
              AND (p.bundle_quantity = 1 OR pv.size_name = 'Tall')`;

        const [rows] = await db.query(sql);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch menu", details: err.message });
    }
});

app.get('/api/add-ons', async (_req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT name, price FROM menu_addons WHERE is_available = TRUE ORDER BY addon_id'
        );
        res.json(rows);
    } catch (err) {
        console.error('Failed to fetch add-on prices:', err);
        res.status(500).json({ error: 'Failed to fetch add-on prices' });
    }
});

// Start Session
app.post('/api/sessions', async (req, res) => {
    try {
        const [result] = await db.query("INSERT INTO Sessions (device_id) VALUES ('KIOSK_01')");
        res.json({ session_id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: "Failed to start session" });
    }
});

app.post('/api/kiosk/orders/:id/acknowledgement-print', async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0 ||
        !isValidKioskPrintToken(orderId, req.body?.printToken)) {
        return res.status(403).json({ error: 'Invalid or expired kiosk print permission.' });
    }
    try {
        const [orders] = await db.query(
            'SELECT order_id, status, created_at FROM orders WHERE order_id = ?',
            [orderId]
        );
        if (!orders.length || orders[0].status !== 'PENDING') {
            return res.status(404).json({ error: 'Pending kiosk order not found.' });
        }
        const queueNumber = 'A' + String(orderId).padStart(3, '0').slice(-3);
        const ticket = formatKioskAcknowledgement(queueNumber);
        await printText(ticket.text);
        res.json({ success: true });
    } catch (err) {
        console.error(`[kiosk] acknowledgement printing failed for order ${orderId}:`, err.message);
        res.status(502).json({ error: 'Kiosk receipt printing failed.', details: err.message });
    }
});

// Submit Final Order
app.post('/api/orders', async (req, res) => {
    const { session_id, items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Order must contain at least one item.' });
    }

    let addonPrices;
    try {
        const [addonRows] = await db.query(
            'SELECT name, price FROM menu_addons WHERE is_available = TRUE'
        );
        addonPrices = new Map(addonRows.map(addon => [addon.name, Number(addon.price)]));
    } catch (err) {
        console.error('Failed to load add-on prices for order:', err);
        return res.status(500).json({ error: 'Unable to verify add-on prices.' });
    }

    const orderItems = [];
    for (const item of items) {
        const quantity = Number(item.quantity);
        const variantId = Number(item.variant_id);
        const addOnNames = item.add_ons === undefined ? [] : item.add_ons;
        if (!Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(variantId) ||
            variantId < 1 || !Array.isArray(addOnNames)) {
            return res.status(400).json({ error: 'Order contains an invalid item.' });
        }
        const addOns = [];
        let totalAddonQuantity = 0;
        for (const entry of addOnNames) {
            const name = typeof entry === 'string' ? entry : entry?.name;
            const addonQuantity = typeof entry === 'string' ? 1 : Number(entry?.quantity);
            if (!addonPrices.has(name) ||
                !Number.isInteger(addonQuantity) || addonQuantity < 1 || addonQuantity > 99 ||
                addOns.some(addon => addon.name === name)) {
                return res.status(400).json({ error: 'Order contains an invalid add-on.' });
            }
            totalAddonQuantity += addonQuantity;
            if (totalAddonQuantity > MAX_ADDON_QUANTITY) {
                return res.status(400).json({ error: `Each shake is limited to ${MAX_ADDON_QUANTITY} toppings.` });
            }
            addOns.push({ name, quantity: addonQuantity, price: addonPrices.get(name) });
        }

        orderItems.push({
            variantId,
            quantity,
            addOns,
        });
    }

    let connection;
    let orderId;
    try {
        await ensureAuditTable();
        const variantIds = Array.from(new Set(orderItems.map(item => item.variantId)));
        const [variantRows] = await db.query(
            `SELECT pv.variant_id, pv.price, pv.size_name, p.bundle_quantity
             FROM product_variants pv
             JOIN products p ON p.product_id = pv.product_id
             WHERE pv.variant_id IN (?) AND pv.is_available = TRUE`,
            [variantIds]
        );
        const variants = new Map(variantRows.map(row => [Number(row.variant_id), row]));
        if (variants.size !== variantIds.length) {
            return res.status(400).json({ error: 'Order contains an unavailable product size.' });
        }
        const totalOrderQuantity = orderItems.reduce((sum, item) => {
            const variant = variants.get(item.variantId);
            const bundleQuantity = Number(variant.bundle_quantity) || 1;
            if (bundleQuantity > 1 && (variant.size_name !== 'Tall' || item.addOns.length > 0)) {
                return Number.POSITIVE_INFINITY;
            }
            return sum + item.quantity * bundleQuantity;
        }, 0);
        if (!Number.isFinite(totalOrderQuantity)) {
            return res.status(400).json({ error: 'Mango Doble is available only as a Tall bundle without add-ons.' });
        }
        if (totalOrderQuantity > MAX_ORDER_QUANTITY) {
            return res.status(400).json({ error: `Orders are limited to ${MAX_ORDER_QUANTITY} cups.` });
        }
        for (const item of orderItems) {
            item.unitPrice = Number(variants.get(item.variantId).price) +
                item.addOns.reduce((sum, addon) => sum + addonPrices.get(addon.name) * addon.quantity, 0);
        }
        const subtotal = orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

        connection = await db.getConnection();
        await connection.beginTransaction();

        let sessionId = Number(session_id);
        if (!Number.isInteger(sessionId) || sessionId <= 0) {
            const [sessionResult] = await connection.query(
                "INSERT INTO Sessions (device_id) VALUES ('KIOSK_01')"
            );
            sessionId = sessionResult.insertId;
        }

        const [orderResult] = await connection.query(
            "INSERT INTO Orders (session_id, subtotal, total_price, order_type) VALUES (?, ?, ?, ?)",
            [sessionId, subtotal, subtotal, 'Standard']
        );
        orderId = orderResult.insertId;

        const itemValues = orderItems.map(item => [
            orderId,
            item.variantId,
            item.quantity,
            item.unitPrice,
            JSON.stringify(item.addOns),
        ]);
        await connection.query(
            "INSERT INTO Order_Items (order_id, variant_id, quantity, price_at_purchase, add_ons) VALUES ?",
            [itemValues]
        );
        const createdItems = await loadOrderItemSnapshots(connection, orderId);
        await writeItemAuditLogs(connection, createdItems.map(item => ({
            orderId,
            orderItemId: item.order_item_id,
            variantId: item.variant_id,
            productName: item.product_name,
            sizeName: item.size_name,
            action: 'ITEM_CREATED',
            newQuantity: item.quantity,
            newPrice: item.price_at_purchase,
            newStatus: 'PENDING',
            source: 'Kiosk',
            actor: 'Customer (Kiosk)',
        })));
        await connection.commit();
    } catch (err) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Failed to roll back kiosk order:', rollbackError);
            }
        }
        console.error('Failed to create kiosk order:', err);
        return res.status(500).json({ error: 'Order submission failed', details: err.message });
    } finally {
        if (connection) connection.release();
    }

    const queueNumber = 'A' + String(orderId).padStart(3, '0').slice(-3);
    const acknowledgement = formatKioskAcknowledgement(queueNumber);
    try {
        posBus.emit('order:new', { orderId, source: 'kiosk' });
    } catch (err) {
        console.error(`Order ${orderId} was saved, but POS notification failed:`, err);
    }

    res.json({
        success: true,
        order_id: orderId,
        queue_number: queueNumber,
        acknowledgement,
        acknowledgement_print_token: createKioskPrintToken(orderId),
    });
});

const PORT = process.env.PORT || 3000;

async function startServer() {
    await verifyDatabaseConnection();

    const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
    let replacingExistingBackend = false;

    server.on('error', err => {
        if (err.code !== 'EADDRINUSE' || replacingExistingBackend) {
            console.error(`Backend failed to listen on port ${PORT}:`, err);
            process.exit(1);
        }

        replacingExistingBackend = true;
        try {
            if (process.platform !== 'win32') {
                throw new Error('Automatic replacement of an existing backend is supported by the Windows launcher only.');
            }

            const script = `
                $ErrorActionPreference = 'Stop'
                $port = ${Number(PORT)}
                $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                    Select-Object -ExpandProperty OwningProcess -Unique)
                foreach ($listenerPid in $listeners) {
                    if ([int]$listenerPid -eq ${process.pid}) { continue }
                    $listener = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerPid"
                    if (-not $listener -or $listener.Name -ne 'node.exe' -or $listener.CommandLine -notmatch '(?i)server\\.js') {
                        throw "Port $port is occupied by an unrelated process (PID $listenerPid); it was not stopped."
                    }
                    Stop-Process -Id ([int]$listenerPid) -Force
                    Write-Output "Stopped existing backend process (PID $listenerPid)."
                }

                for ($attempt = 0; $attempt -lt 50; $attempt++) {
                    $remaining = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
                    if (-not $remaining) { exit 0 }
                    Start-Sleep -Milliseconds 100
                }
                throw "Port $port is still occupied after stopping the existing backend."
            `;
            const output = execFileSync('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                script,
            ], { encoding: 'utf8', windowsHide: true });
            if (output.trim()) console.log(output.trim());
            server.listen(PORT, () => console.log(`🚀 Replaced backend; server running on port ${PORT}`));
        } catch (replaceError) {
            console.error(`Backend could not replace the process on port ${PORT}: ${replaceError.message}`);
            process.exit(1);
        }
    });
}

startServer();