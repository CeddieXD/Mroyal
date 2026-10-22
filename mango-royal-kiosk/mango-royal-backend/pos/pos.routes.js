// POS module — endpoints consumed by the Mango Royal POS lite frontend.
// Reuses the shared mysql2 pool from ../config/db.
const express = require('express');
const db = require('../config/db');
const bus = require('./events');
const {
    ensureAuditTable,
    loadOrderItemSnapshots,
    normalizeAddOns,
    writeItemAuditLogs,
    writeOrderStatusAudit,
} = require('../audit-logs');

const router = express.Router();

// SSE — pushes a nudge whenever an order changes so the POS refreshes instantly.
router.get('/events', (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    res.flushHeaders();
    res.write(`event: hello\ndata: {"ok":true}\n\n`);

    const send = (type) => (payload) => {
        res.write(`event: ${type}\ndata: ${JSON.stringify(payload || {})}\n\n`);
    };
    const onNew    = send('order:new');
    const onChange = send('order:change');
    bus.on('order:new', onNew);
    bus.on('order:change', onChange);

    const keepalive = setInterval(() => res.write(`: ping\n\n`), 25000);
    req.on('close', () => {
        clearInterval(keepalive);
        bus.off('order:new', onNew);
        bus.off('order:change', onChange);
    });
});

const STATUS = { PENDING: 'PENDING', VERIFIED: 'VERIFIED', VOIDED: 'VOIDED' };

// Match the queue-number format the kiosk shows customers (server.js: 'A' + last 3 digits of order_id).
const queueNumber = (orderId) => 'A' + String(orderId).padStart(3, '0').slice(-3);

// Turn a bare "MangoRoyal.png" into a URL the POS frontend can load.
const imageUrl = (name) => name ? `/images/${name}` : null;

// Idempotent side table for POS-only metadata (payment, discount, void reason, walk-in flag)
async function ensureMetaTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS pos_order_meta (
            order_id INT PRIMARY KEY,
            payment_method VARCHAR(20) DEFAULT 'Cash',
            payment_amount DECIMAL(10,2) NULL,
            discount_type VARCHAR(20) NULL,
            discount_amount DECIMAL(10,2) DEFAULT 0,
            pwd_id_number VARCHAR(100) NULL,
            senior_name VARCHAR(150) NULL,
            senior_birthdate DATE NULL,
            void_reason VARCHAR(255) NULL,
            is_walkin TINYINT(1) DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(order_id)
        )
    `);
    const [columns] = await db.query('SHOW COLUMNS FROM pos_order_meta');
    const existingColumns = new Set(columns.map(column => column.Field));
    const newColumns = [
        ['pwd_id_number', 'VARCHAR(100) NULL'],
        ['senior_name', 'VARCHAR(150) NULL'],
        ['senior_birthdate', 'DATE NULL'],
    ];
    for (const [name, definition] of newColumns) {
        if (!existingColumns.has(name)) {
            await db.query(`ALTER TABLE pos_order_meta ADD COLUMN ${name} ${definition}`);
        }
    }
}
const metaTableReady = ensureMetaTable();
metaTableReady.catch(err => console.error('[pos] meta table init failed:', err.message));

// Load orders + items for the given status filter
async function loadOrders(status) {
    await metaTableReady;
    const [orderRows] = await db.query(
        `SELECT o.order_id, o.subtotal, o.total_price, o.order_type, o.created_at, o.status,
                m.payment_method, m.payment_amount, m.discount_type, m.discount_amount,
                m.void_reason, m.is_walkin
         FROM orders o
         LEFT JOIN pos_order_meta m ON m.order_id = o.order_id
         WHERE o.status = ?
         ORDER BY o.created_at DESC`,
        [status]
    );
    if (!orderRows.length) return [];

    const ids = orderRows.map(o => o.order_id);
    const [itemRows] = await db.query(
        `SELECT oi.order_item_id, oi.order_id, oi.variant_id, oi.quantity, oi.price_at_purchase, oi.add_ons,
                pv.size_name, p.product_id, p.name, p.image_url, p.bundle_quantity
         FROM order_items oi
         JOIN product_variants pv ON pv.variant_id = oi.variant_id
         JOIN products p ON p.product_id = pv.product_id
         WHERE oi.order_id IN (?)`,
        [ids]
    );

    return orderRows.map(o => ({
        orderId: queueNumber(o.order_id),
        rawId: o.order_id,
        status: o.status,
        timestamp: new Date(o.created_at).toISOString().replace('T', ' ').slice(0, 19),
        orderType: o.order_type,
        subtotal: Number(o.subtotal),
        total: Number(o.total_price),
        paymentMethod: o.payment_method || (o.is_walkin ? 'Cash' : 'GCash'),
        paymentAmount: o.payment_amount != null ? Number(o.payment_amount) : null,
        discountType: o.discount_type,
        discountAmount: o.discount_amount != null ? Number(o.discount_amount) : 0,
        voidReason: o.void_reason,
        isWalkIn: !!o.is_walkin,
        items: itemRows
            .filter(i => i.order_id === o.order_id)
            .map(i => ({
                id: i.order_item_id,
                productId: i.product_id,
                variantId: i.variant_id,
                name: i.name,
                image: imageUrl(i.image_url),
                size: i.size_name,
                price: Number(i.price_at_purchase),
                quantity: i.quantity,
                bundleQuantity: Number(i.bundle_quantity) || 1,
                addOns: normalizeAddOns(i.add_ons),
            })),
    }));
}

// ---------- ROUTES ----------

// GET /api/pos/orders?status=PENDING|VERIFIED|VOIDED
router.get('/orders', async (req, res) => {
    const status = (req.query.status || 'PENDING').toUpperCase();
    if (!STATUS[status]) return res.status(400).json({ error: 'Invalid status' });
    try {
        res.json(await loadOrders(status));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch orders', details: err.message });
    }
});

// GET /api/pos/menu — flat product+variant list used by walk-in and edit modals
router.get('/menu', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.product_id, p.name, p.description, p.image_url, p.bundle_quantity, c.category_name,
                   pv.variant_id, pv.size_name, pv.price
            FROM products p
            JOIN product_variants pv ON pv.product_id = p.product_id
            JOIN categories c ON c.category_id = p.category_id
            WHERE p.is_available = TRUE AND pv.is_available = TRUE
              AND (p.bundle_quantity = 1 OR pv.size_name = 'Tall')
            ORDER BY p.product_id, pv.price
        `);
        // Group by product
        const map = new Map();
        for (const r of rows) {
            if (!map.has(r.product_id)) {
                map.set(r.product_id, {
                    id: r.product_id,
                    name: r.name,
                    description: r.description,
                    bundleQuantity: Number(r.bundle_quantity) || 1,
                    image: imageUrl(r.image_url),
                    category: r.category_name,
                    sizes: [],
                });
            }
            map.get(r.product_id).sizes.push({
                variantId: r.variant_id,
                name: r.size_name,
                price: Number(r.price),
            });
        }
        const list = Array.from(map.values()).map(p => ({
            ...p,
            basePrice: Math.min(...p.sizes.map(s => s.price)),
        }));
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch menu', details: err.message });
    }
});

// POST /api/pos/orders/:id/verify — payment + optional PWD/Senior discount
router.post('/orders/:id/verify', async (req, res) => {
    const orderId = Number(req.params.id);
    const {
        paymentAmount,
        paymentMethod = 'Cash',
        discountType = null,
        discountAmount = 0,
        pwdIdNumber = null,
        seniorName = null,
        seniorBirthdate = null,
    } = req.body || {};
    const parsedPaymentAmount = Number(paymentAmount);
    const parsedDiscountAmount = Number(discountAmount);
    if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ error: 'Invalid order ID' });
    }
    if (!Number.isFinite(parsedPaymentAmount) || parsedPaymentAmount <= 0) {
        return res.status(400).json({ error: 'A valid payment amount is required' });
    }
    if (!Number.isFinite(parsedDiscountAmount) || parsedDiscountAmount < 0) {
        return res.status(400).json({ error: 'A valid discount amount is required' });
    }
    if (discountType && !['PWD', 'Senior'].includes(discountType)) {
        return res.status(400).json({ error: 'Invalid discount type' });
    }
    const normalizedPwdId = typeof pwdIdNumber === 'string' ? pwdIdNumber.trim() : '';
    const normalizedSeniorName = typeof seniorName === 'string' ? seniorName.trim() : '';
    if (discountType === 'PWD' && !normalizedPwdId) {
        return res.status(400).json({ error: 'PWD ID number is required' });
    }
    if (discountType === 'Senior') {
        const dateParts = typeof seniorBirthdate === 'string'
            ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(seniorBirthdate)
            : null;
        const birthdate = dateParts
            ? new Date(Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3])))
            : null;
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const validBirthdate = Boolean(birthdate)
            && birthdate.toISOString().slice(0, 10) === seniorBirthdate
            && seniorBirthdate <= today;
        if (!normalizedSeniorName || !validBirthdate) {
            return res.status(400).json({ error: 'Senior citizen name and valid birthdate are required' });
        }
    }
    try {
        await metaTableReady;
        await ensureAuditTable();
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
        } catch (err) {
            connection.release();
            throw err;
        }
        let orderTotal;
        let previousStatus;
        try {
            const [orders] = await connection.query(
                'SELECT total_price, status FROM orders WHERE order_id = ? FOR UPDATE',
                [orderId]
            );
            if (!orders.length) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }
            orderTotal = Number(orders[0].total_price);
            previousStatus = orders[0].status;
            const expectedDiscount = discountType ? Math.round(orderTotal * 0.20 * 100) / 100 : 0;
            if (Math.abs(parsedDiscountAmount - expectedDiscount) > 0.01) {
                await connection.rollback();
                return res.status(400).json({ error: 'Discount amount does not match the selected discount' });
            }
            if (parsedPaymentAmount + 0.001 < orderTotal - expectedDiscount) {
                await connection.rollback();
                return res.status(400).json({ error: 'Payment amount is less than the amount due' });
            }
            await connection.query(`UPDATE orders SET status = ? WHERE order_id = ?`, [STATUS.VERIFIED, orderId]);
            if (previousStatus !== STATUS.VERIFIED) {
                await writeOrderStatusAudit(connection, {
                    orderId,
                    previousStatus,
                    newStatus: STATUS.VERIFIED,
                    source: 'POS',
                    actor: req.staff.displayName,
                });
            }
            await connection.query(
                `INSERT INTO pos_order_meta (
                    order_id, payment_method, payment_amount, discount_type, discount_amount,
                    pwd_id_number, senior_name, senior_birthdate
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                     payment_method = VALUES(payment_method),
                     payment_amount = VALUES(payment_amount),
                     discount_type = VALUES(discount_type),
                     discount_amount = VALUES(discount_amount),
                     pwd_id_number = VALUES(pwd_id_number),
                     senior_name = VALUES(senior_name),
                     senior_birthdate = VALUES(senior_birthdate)`,
                [
                    orderId,
                    paymentMethod,
                    parsedPaymentAmount,
                    discountType,
                    parsedDiscountAmount,
                    discountType === 'PWD' ? normalizedPwdId : null,
                    discountType === 'Senior' ? normalizedSeniorName : null,
                    discountType === 'Senior' ? seniorBirthdate : null,
                ]
            );
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
        bus.emit('order:change', { orderId, status: STATUS.VERIFIED, source: 'pos' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Verify failed', details: err.message });
    }
});

// POST /api/pos/orders/:id/void — with reason
router.post('/orders/:id/void', async (req, res) => {
    const orderId = Number(req.params.id);
    const { reason = '' } = req.body || {};
    try {
        await ensureAuditTable();
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
        } catch (err) {
            connection.release();
            throw err;
        }
        try {
            const [orders] = await connection.query(
                'SELECT status FROM orders WHERE order_id = ? FOR UPDATE',
                [orderId]
            );
            if (!orders.length) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }
            await connection.query(`UPDATE orders SET status = ? WHERE order_id = ?`, [STATUS.VOIDED, orderId]);
            if (orders[0].status !== STATUS.VOIDED) {
                await writeOrderStatusAudit(connection, {
                    orderId,
                    previousStatus: orders[0].status,
                    newStatus: STATUS.VOIDED,
                    source: 'POS',
                    actor: req.staff.displayName,
                });
            }
            await connection.query(
                `INSERT INTO pos_order_meta (order_id, void_reason) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE void_reason = VALUES(void_reason)`,
                [orderId, reason]
            );
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
        bus.emit('order:change');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Void failed', details: err.message });
    }
});

// POST /api/pos/orders/:id/reopen — move Verified back to Pending
router.post('/orders/:id/reopen', async (req, res) => {
    const orderId = Number(req.params.id);
    try {
        await ensureAuditTable();
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
        } catch (err) {
            connection.release();
            throw err;
        }
        try {
            const [orders] = await connection.query(
                'SELECT status FROM orders WHERE order_id = ? FOR UPDATE',
                [orderId]
            );
            if (!orders.length) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }
            await connection.query(`UPDATE orders SET status = ? WHERE order_id = ?`, [STATUS.PENDING, orderId]);
            if (orders[0].status !== STATUS.PENDING) {
                await writeOrderStatusAudit(connection, {
                    orderId,
                    previousStatus: orders[0].status,
                    newStatus: STATUS.PENDING,
                    source: 'POS',
                    actor: req.staff.displayName,
                });
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
        bus.emit('order:change');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Reopen failed', details: err.message });
    }
});

// PATCH /api/pos/orders/:id — replace items (edit flow)
// body: { items: [{ variantId, quantity, price }] }
router.patch('/orders/:id', async (req, res) => {
    const orderId = Number(req.params.id);
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items required' });
    }
    const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
    try {
        await ensureAuditTable();
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
        } catch (err) {
            connection.release();
            throw err;
        }
        try {
            const [orders] = await connection.query(
                'SELECT order_id FROM orders WHERE order_id = ? FOR UPDATE',
                [orderId]
            );
            if (!orders.length) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }
            const previousItems = await loadOrderItemSnapshots(connection, orderId);
            const oldByVariant = new Map();
            for (const item of previousItems) {
                const existing = oldByVariant.get(item.variant_id) || {
                    ...item,
                    quantity: 0,
                    priceTotal: 0,
                };
                existing.quantity += Number(item.quantity);
                existing.priceTotal += Number(item.quantity) * Number(item.price_at_purchase);
                oldByVariant.set(item.variant_id, existing);
            }
            for (const item of oldByVariant.values()) {
                item.price = item.priceTotal / item.quantity;
            }

            await connection.query(`DELETE FROM order_items WHERE order_id = ?`, [orderId]);
            const values = items.map(i => [
                orderId,
                i.variantId,
                i.quantity,
                i.price,
                JSON.stringify(Array.isArray(i.addOns) ? i.addOns : []),
            ]);
            await connection.query(
                `INSERT INTO order_items (order_id, variant_id, quantity, price_at_purchase, add_ons) VALUES ?`,
                [values]
            );
            await connection.query(
                `UPDATE orders SET subtotal = ?, total_price = ? WHERE order_id = ?`,
                [subtotal, subtotal, orderId]
            );
            const currentItems = await loadOrderItemSnapshots(connection, orderId);
            const newByVariant = new Map();
            for (const item of currentItems) {
                const existing = newByVariant.get(item.variant_id) || {
                    ...item,
                    quantity: 0,
                    priceTotal: 0,
                };
                existing.quantity += Number(item.quantity);
                existing.priceTotal += Number(item.quantity) * Number(item.price_at_purchase);
                newByVariant.set(item.variant_id, existing);
            }
            for (const item of newByVariant.values()) {
                item.price = item.priceTotal / item.quantity;
            }
            const auditEntries = [];
            for (const variantId of new Set([...oldByVariant.keys(), ...newByVariant.keys()])) {
                const previous = oldByVariant.get(variantId);
                const current = newByVariant.get(variantId);
                const previousPrice = previous ? previous.price : null;
                const newPrice = current ? current.price : null;
                const previousQuantity = previous ? previous.quantity : null;
                const newQuantity = current ? current.quantity : null;
                const changedFields = [];
                if (previousQuantity !== newQuantity) changedFields.push('quantity');
                if ((previousPrice == null) !== (newPrice == null)
                    || (previousPrice != null && Math.abs(previousPrice - newPrice) > 0.001)) {
                    changedFields.push('unit price');
                }
                if (!changedFields.length) continue;
                const item = current || previous;
                auditEntries.push({
                    orderId,
                    orderItemId: current ? current.order_item_id : previous.order_item_id,
                    variantId,
                    productName: item.product_name,
                    sizeName: item.size_name,
                    action: previous && current ? 'ITEM_UPDATED' : current ? 'ITEM_ADDED' : 'ITEM_REMOVED',
                    previousQuantity,
                    newQuantity,
                    previousPrice,
                    newPrice,
                    source: 'POS',
                    actor: req.staff.displayName,
                    details: { changedFields },
                });
            }
            await writeItemAuditLogs(connection, auditEntries);
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
        res.json({ success: true, subtotal, total: subtotal });
    } catch (err) {
        res.status(500).json({ error: 'Edit failed', details: err.message });
    }
});

// POST /api/pos/orders/walkin — create a new walk-in order
// body: { orderType?, items: [{ variantId, quantity, price }] }
router.post('/orders/walkin', async (req, res) => {
    const { orderType = 'Dine-in', items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items required' });
    }
    const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
    try {
        await ensureAuditTable();
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
        } catch (err) {
            connection.release();
            throw err;
        }
        let orderId;
        try {
            const [sess] = await connection.query(
                "INSERT INTO sessions (device_id, status) VALUES ('POS_01', 'completed')"
            );
            const sessionId = sess.insertId;

            const [ord] = await connection.query(
                `INSERT INTO orders (session_id, subtotal, total_price, order_type, status)
                 VALUES (?, ?, ?, ?, ?)`,
                [sessionId, subtotal, subtotal, orderType, STATUS.PENDING]
            );
            orderId = ord.insertId;

            const values = items.map(i => [orderId, i.variantId, i.quantity, i.price]);
            await connection.query(
                `INSERT INTO order_items (order_id, variant_id, quantity, price_at_purchase) VALUES ?`,
                [values]
            );
            await connection.query(
                `INSERT INTO pos_order_meta (order_id, is_walkin, payment_method) VALUES (?, 1, 'Cash')`,
                [orderId]
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
                newStatus: STATUS.PENDING,
                source: 'POS',
                actor: req.staff.displayName,
            })));
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

        const queue = queueNumber(orderId);
        bus.emit('order:new', { orderId, queueNumber: queue, source: 'walkin' });
        res.json({ success: true, orderId, queueNumber: queue, subtotal, total: subtotal });
    } catch (err) {
        res.status(500).json({ error: 'Walk-in create failed', details: err.message });
    }
});

module.exports = router;
