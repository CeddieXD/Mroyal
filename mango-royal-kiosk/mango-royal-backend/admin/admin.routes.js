// Admin module — backend API for Mango Royal Admin Dashboard
const express = require('express');
const db = require('../config/db');

const router = express.Router();

const queueNumber = (orderId) => 'A' + String(orderId).padStart(3, '0').slice(-3);
const imageUrl = (name) => name ? `/images/${name}` : null;

// GET /api/admin/overview — Dashboard stats, charts, and metrics
router.get('/overview', async (req, res) => {
    try {
        // Today's sales & order count
        const [todayStats] = await db.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN status != 'VOIDED' THEN total_price ELSE 0 END), 0) AS todaySales,
                COUNT(order_id) AS totalOrders,
                COALESCE(AVG(CASE WHEN status != 'VOIDED' THEN total_price END), 0) AS averageOrderValue,
                COALESCE(SUM(CASE WHEN status IN ('PENDING', 'VERIFIED', 'PREPARING') THEN 1 ELSE 0 END), 0) AS inProgressOrders,
                COALESCE(SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END), 0) AS completedOrders,
                COALESCE(SUM(CASE WHEN status = 'VOIDED' THEN 1 ELSE 0 END), 0) AS voidedOrders,
                COALESCE(SUM(CASE WHEN status != 'VOIDED' AND order_type = 'Dine-in' THEN 1 ELSE 0 END), 0) AS dineInOrders,
                COALESCE(SUM(CASE WHEN status != 'VOIDED' AND order_type = 'Take-out' THEN 1 ELSE 0 END), 0) AS takeOutOrders
            FROM orders
            WHERE DATE(created_at) = CURRENT_DATE()
        `);

        const todaySales = Number(todayStats[0].todaySales);
        const totalOrders = Number(todayStats[0].totalOrders);

        // Top selling products
        const [topProducts] = await db.query(`
            SELECT p.name, SUM(oi.quantity) as sold, SUM(oi.quantity * oi.price_at_purchase) as revenue
            FROM order_items oi
            JOIN product_variants pv ON pv.variant_id = oi.variant_id
            JOIN products p ON p.product_id = pv.product_id
            JOIN orders o ON o.order_id = oi.order_id
            WHERE o.status != 'VOIDED' AND DATE(o.created_at) = CURRENT_DATE()
            GROUP BY p.product_id, p.name
            ORDER BY sold DESC
            LIMIT 5
        `);

        const bestSeller = topProducts.length ? topProducts[0].name : 'No sales yet';

        // Hourly distribution
        const [hourly] = await db.query(`
            SELECT HOUR(created_at) as hr, 
                   COUNT(CASE WHEN status != 'VOIDED' THEN order_id END) as orders,
                   COALESCE(SUM(CASE WHEN status != 'VOIDED' THEN total_price ELSE 0 END), 0) as sales
            FROM orders
            WHERE DATE(created_at) = CURRENT_DATE()
            GROUP BY HOUR(created_at)
            ORDER BY hr ASC
        `);

        // Build hour map from 9 AM to 8 PM
        const hoursLabels = ['9 AM','10 AM','11 AM','12 PM','1 PM','2 PM','3 PM','4 PM','5 PM','6 PM','7 PM','8 PM'];
        const hourlyData = hoursLabels.map((lbl, idx) => {
            const hour24 = idx + 9;
            const match = hourly.find(h => h.hr === hour24);
            return {
                time: lbl,
                sales: match ? Number(match.sales) : 0,
                orders: match ? Number(match.orders) : 0
            };
        });

        // Peak time calculation
        let peakTime = 'None yet';
        if (hourly.some(h => Number(h.orders) > 0)) {
            const maxHour = hourly.reduce((prev, curr) => (Number(curr.orders) > Number(prev.orders) ? curr : prev), hourly[0]);
            const h = maxHour.hr;
            const formatHour = hour => `${hour % 12 || 12}:00 ${hour >= 12 ? 'PM' : 'AM'}`;
            const hFormatted = formatHour(h);
            const hNext = (h + 1) % 24;
            const hNextFormatted = formatHour(hNext);
            peakTime = `${hFormatted} - ${hNextFormatted}`;
        }

        res.json({
            todaySales,
            totalOrders,
            averageOrderValue: Number(todayStats[0].averageOrderValue),
            inProgressOrders: Number(todayStats[0].inProgressOrders),
            completedOrders: Number(todayStats[0].completedOrders),
            voidedOrders: Number(todayStats[0].voidedOrders),
            dineInOrders: Number(todayStats[0].dineInOrders),
            takeOutOrders: Number(todayStats[0].takeOutOrders),
            bestSeller,
            peakTime,
            topProducts: topProducts.map(p => ({
                name: p.name,
                sold: Number(p.sold),
                revenue: Number(p.revenue)
            })),
            hourly: hourlyData
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch overview', details: err.message });
    }
});

// GET /api/admin/transactions — All transactions with full metadata
router.get('/transactions', async (req, res) => {
    try {
        const [orders] = await db.query(`
            SELECT o.order_id, o.subtotal, o.total_price, o.order_type, o.created_at, o.status,
                   m.payment_method, m.payment_amount, m.discount_type, m.discount_amount,
                   m.void_reason, m.is_walkin, m.updated_at
            FROM orders o
            LEFT JOIN pos_order_meta m ON m.order_id = o.order_id
            ORDER BY o.created_at DESC
        `);

        if (!orders.length) return res.json([]);

        const ids = orders.map(o => o.order_id);
        const [itemRows] = await db.query(`
            SELECT oi.order_id, oi.quantity, oi.price_at_purchase, pv.size_name, p.name, p.image_url
            FROM order_items oi
            JOIN product_variants pv ON pv.variant_id = oi.variant_id
            JOIN products p ON p.product_id = pv.product_id
            WHERE oi.order_id IN (?)
        `, [ids]);

        const list = orders.map(o => {
            const items = itemRows.filter(i => i.order_id === o.order_id);
            const itemStrings = items.map(i => `${i.name} (${i.size_name}) x${i.quantity}`);
            return {
                id: queueNumber(o.order_id),
                rawId: o.order_id,
                date: o.created_at,
                cashierId: o.is_walkin ? 'Cashier #1' : 'Kiosk Self-Order',
                items: itemStrings.length ? itemStrings : ['No items recorded'],
                itemDetails: items,
                total: Number(o.total_price),
                subtotal: Number(o.subtotal),
                orderType: o.order_type,
                amountChange: o.payment_amount ? Math.max(0, Number(o.payment_amount) - Number(o.total_price)) : 0,
                paymentMethod: o.payment_method || (o.is_walkin ? 'Cash' : 'GCash'),
                status: o.status === 'VERIFIED' ? 'Completed' : (o.status === 'VOIDED' ? 'Void' : (o.status === 'READY' ? 'Completed' : o.status)),
                rawStatus: o.status,
                timeServed: o.updated_at || o.created_at,
                discount: o.discount_type ? { type: o.discount_type, amount: Number(o.discount_amount || 0) } : null,
                voidReason: o.void_reason ? { type: o.void_reason } : null
            };
        });

        res.json(list);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch transactions', details: err.message });
    }
});

// GET /api/admin/menu — Products + variants + categories
router.get('/menu', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.product_id, p.name, p.description, p.image_url, p.is_available, c.category_name,
                   pv.variant_id, pv.size_name, pv.price
            FROM products p
            JOIN product_variants pv ON pv.product_id = p.product_id
            JOIN categories c ON c.category_id = p.category_id
            ORDER BY p.product_id, pv.price
        `);

        const map = new Map();
        for (const r of rows) {
            if (!map.has(r.product_id)) {
                map.set(r.product_id, {
                    id: String(r.product_id),
                    name: r.name,
                    description: r.description,
                    image: r.image_url,
                    available: Boolean(r.is_available),
                    category: r.category_name,
                    price: { tall: 0, grande: 0 },
                    sizes: []
                });
            }
            const item = map.get(r.product_id);
            if (r.size_name.toLowerCase() === 'tall') item.price.tall = Number(r.price);
            if (r.size_name.toLowerCase() === 'grande') item.price.grande = Number(r.price);
            item.sizes.push({ variantId: r.variant_id, size: r.size_name, price: Number(r.price) });
        }

        res.json(Array.from(map.values()));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch menu', details: err.message });
    }
});

// PATCH /api/admin/menu/:id/toggle — Toggle product availability in DB
router.patch('/menu/:id/toggle', async (req, res) => {
    const id = req.params.id;
    try {
        const [rows] = await db.query(`SELECT is_available FROM products WHERE product_id = ?`, [id]);
        if (!rows.length) return res.status(404).json({ error: 'Product not found' });
        const nextState = !rows[0].is_available;
        await db.query(`UPDATE products SET is_available = ? WHERE product_id = ?`, [nextState, id]);
        res.json({ success: true, is_available: nextState });
    } catch (err) {
        res.status(500).json({ error: 'Toggle failed', details: err.message });
    }
});

// PUT /api/admin/menu/:id — Update product info and prices
router.put('/menu/:id', async (req, res) => {
    const id = req.params.id;
    const { name, description, category, image, price, available } = req.body;
    try {
        // Find category id
        const [cats] = await db.query(`SELECT category_id FROM categories WHERE category_name = ?`, [category]);
        const catId = cats.length ? cats[0].category_id : 1;

        await db.query(`
            UPDATE products 
            SET name = ?, description = ?, category_id = ?, image_url = ?, is_available = ?
            WHERE product_id = ?
        `, [name, description, catId, image, available ? 1 : 0, id]);

        if (price) {
            if (price.tall != null) {
                await db.query(`UPDATE product_variants SET price = ? WHERE product_id = ? AND size_name = 'Tall'`, [price.tall, id]);
            }
            if (price.grande != null) {
                await db.query(`UPDATE product_variants SET price = ? WHERE product_id = ? AND size_name = 'Grande'`, [price.grande, id]);
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Update product failed', details: err.message });
    }
});

// POST /api/admin/menu — Add new product and variants
router.post('/menu', async (req, res) => {
    const { name, description, category, image, price, available = true } = req.body;
    try {
        const [cats] = await db.query(`SELECT category_id FROM categories WHERE category_name = ?`, [category]);
        const catId = cats.length ? cats[0].category_id : 1;

        const [prod] = await db.query(`
            INSERT INTO products (category_id, name, description, image_url, is_available)
            VALUES (?, ?, ?, ?, ?)
        `, [catId, name, description, image || 'MangoRoyal.png', available ? 1 : 0]);

        const prodId = prod.insertId;
        const tallPrice = (price && price.tall) || 120;
        const grandePrice = (price && price.grande) || 145;

        await db.query(`
            INSERT INTO product_variants (product_id, size_name, price) VALUES
            (?, 'Tall', ?),
            (?, 'Grande', ?)
        `, [prodId, tallPrice, prodId, grandePrice]);

        res.json({ success: true, product_id: prodId });
    } catch (err) {
        res.status(500).json({ error: 'Add product failed', details: err.message });
    }
});

// DELETE /api/admin/menu/:id — Remove product
router.delete('/menu/:id', async (req, res) => {
    const id = req.params.id;
    try {
        await db.query(`DELETE FROM product_variants WHERE product_id = ?`, [id]);
        await db.query(`DELETE FROM products WHERE product_id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Delete failed', details: err.message });
    }
});

module.exports = router;
