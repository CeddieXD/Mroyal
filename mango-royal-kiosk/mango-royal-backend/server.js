const express = require('express');
const cors = require('cors');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config();
const db = require('./config/db'); // Import the separated DB connection
const { ensureAuditTable, loadOrderItemSnapshots, writeItemAuditLogs } = require('./audit-logs');

const app = express();
app.use(cors());
app.use(express.json());

const MAX_ORDER_QUANTITY = 20;
const MAX_ADDON_QUANTITY = 10;

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

app.use((_req, _res, next) => {
    ensureOrderItemAddonsColumn().then(() => next(), next);
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
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'assets', 'img')));

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

// Submit Final Order
app.post('/api/orders', async (req, res) => {
    const { session_id, order_type, items } = req.body || {};
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
            addOns.push({ name, quantity: addonQuantity });
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
            [sessionId, subtotal, subtotal, order_type]
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
    try {
        posBus.emit('order:new', { orderId, source: 'kiosk' });
    } catch (err) {
        console.error(`Order ${orderId} was saved, but POS notification failed:`, err);
    }

    res.json({ success: true, order_id: orderId, queue_number: queueNumber });
});

const PORT = process.env.PORT || 3000;
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