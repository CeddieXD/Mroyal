// Kitchen module — endpoints consumed by the Mango Royal Kitchen lite frontend.
// Kitchen flow picks up after the cashier verifies an order:
//   VERIFIED  →  PREPARING  →  SERVED
// Reuses the shared mysql2 pool and the POS event bus so all three surfaces
// (kiosk, POS, kitchen) refresh in real time.
const express = require('express');
const db = require('../config/db');
const bus = require('../pos/events');
const { ensureAuditTable, normalizeAddOns, writeOrderStatusAudit } = require('../audit-logs');

const router = express.Router();

const KITCHEN_ORDER_STATUSES = ['VERIFIED', 'PREPARING', 'SERVED', 'READY'];
const TRANSITIONS = {
    VERIFIED:  ['PREPARING'],
    PREPARING: ['SERVED', 'VERIFIED'],
    SERVED:    ['PREPARING'],
    READY:     ['PREPARING'],
};
const KITCHEN_TARGET_STATUSES = ['PREPARING', 'SERVED', 'VERIFIED'];

const queueNumber = (orderId) => 'A' + String(orderId).padStart(3, '0').slice(-3);
const imageUrl = (name) => name ? `/images/${name}` : null;

// SSE — same shape as /api/pos/events so the kitchen frontend can hot-reload
// on any order change (verify from POS, status bump from kitchen, etc.).
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

// Load every order currently in the kitchen pipeline (Verified/Preparing/Served)
// in one query, then attach items.
async function loadKitchenOrders() {
    const [orderRows] = await db.query(
        `SELECT o.order_id, o.total_price, o.created_at, o.status
         FROM orders o
         WHERE o.status IN (?, ?, ?, ?)
         ORDER BY o.created_at ASC`,
        KITCHEN_ORDER_STATUSES
    );
    if (!orderRows.length) return [];

    const ids = orderRows.map(o => o.order_id);
    const [itemRows] = await db.query(
        `SELECT oi.order_item_id, oi.order_id, oi.quantity, oi.add_ons,
                pv.size_name, p.name, p.image_url, p.bundle_quantity
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
        total: Number(o.total_price),
        createdAt: new Date(o.created_at).toISOString(),
        items: itemRows
            .filter(i => i.order_id === o.order_id)
            .map(i => ({
                id: i.order_item_id,
                name: i.name,
                image: imageUrl(i.image_url),
                size: i.size_name,
                quantity: i.quantity,
                bundleQuantity: Number(i.bundle_quantity) || 1,
                addOns: normalizeAddOns(i.add_ons),
            })),
    }));
}

// GET /api/kitchen/orders — everything currently visible on the kitchen board
router.get('/orders', async (_req, res) => {
    try {
        res.json(await loadKitchenOrders());
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch kitchen orders', details: err.message });
    }
});

// POST /api/kitchen/orders/:id/status  { status }
// Only the oldest incoming order may start; any preparing order may be served.
router.post('/orders/:id/status', async (req, res) => {
    const orderId = Number(req.params.id);
    const next = String((req.body && req.body.status) || '').toUpperCase();
    if (!KITCHEN_TARGET_STATUSES.includes(next)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
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
            let oldestIncomingId = null;
            if (next === 'PREPARING') {
                const [oldestIncoming] = await connection.query(
                    `SELECT order_id FROM orders
                     WHERE status = 'VERIFIED'
                     ORDER BY created_at ASC, order_id ASC
                     LIMIT 1 FOR UPDATE`
                );
                oldestIncomingId = oldestIncoming[0]?.order_id ?? null;
            }
            const [rows] = await connection.query(
                `SELECT status FROM orders WHERE order_id = ? FOR UPDATE`,
                [orderId]
            );
            if (!rows.length) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }
            const current = rows[0].status;
            if (current === 'VERIFIED' && next === 'PREPARING'
                && Number(orderId) !== Number(oldestIncomingId)) {
                await connection.rollback();
                return res.status(409).json({ error: 'Start the oldest incoming order first.' });
            }
            const allowed = TRANSITIONS[current] || [];
            if (!allowed.includes(next)) {
                await connection.rollback();
                return res.status(409).json({ error: `Cannot move ${current} → ${next}` });
            }
            await connection.query(`UPDATE orders SET status = ? WHERE order_id = ?`, [next, orderId]);
            await writeOrderStatusAudit(connection, {
                orderId,
                previousStatus: current,
                newStatus: next,
                source: 'Kitchen',
                actor: req.staff.displayName,
            });
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
        bus.emit('order:change', { orderId, status: next, source: 'kitchen' });
        res.json({ success: true, status: next });
    } catch (err) {
        res.status(500).json({ error: 'Status update failed', details: err.message });
    }
});

module.exports = router;
