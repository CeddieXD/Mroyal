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

const PORT = process.env.PORT || 3000;

async function startServer() {
    await verifyDatabaseConnection();

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
                SELECT p.product_id, p.name, p.description, p.image_url, c.category_name,
                       pv.variant_id, pv.size_name, pv.price
                FROM Products p
                JOIN Product_Variants pv ON p.product_id = pv.product_id
                JOIN Categories c ON p.category_id = c.category_id
                WHERE p.is_available = TRUE`;

            const [rows] = await db.query(sql);
            res.json(rows);
        } catch (err) {
            res.status(500).json({ error: "Failed to fetch menu", details: err.message });
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
        const { session_id, subtotal, total_price, order_type, items } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Order must contain at least one item.' });
        }

        let connection;
        let orderId;
        try {
            await ensureAuditTable();
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
                [sessionId, subtotal, total_price, order_type]
            );
            orderId = orderResult.insertId;

            const itemValues = items.map(item => [orderId, item.variant_id, item.quantity, item.price]);
            await connection.query(
                "INSERT INTO Order_Items (order_id, variant_id, quantity, price_at_purchase) VALUES ?",
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