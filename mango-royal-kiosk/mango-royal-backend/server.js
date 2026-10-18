const express = require('express');
const cors = require('cors');
const db = require('./config/db'); // Import the separated DB connection
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// POS module — endpoints for the Mango Royal POS lite frontend
app.use('/api/pos', require('./pos/pos.routes'));
app.use('/api/kitchen', require('./kitchen/kitchen.routes'));
app.use('/api/admin', require('./admin/admin.routes'));
const posBus = require('./pos/events');

// Serve kiosk product images to the POS frontend
const path = require('path');
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
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));