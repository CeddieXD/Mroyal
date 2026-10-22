// Admin module — backend API for Mango Royal Admin Dashboard
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../config/db');
const { ensureAuditTable, normalizeAddOns } = require('../audit-logs');
const {
    SettingsValidationError,
    normalizeAdminSettings,
    readAdminSettings,
    saveAdminSettings,
} = require('../config/admin-settings');

const router = express.Router();

const queueNumber = (orderId) => 'A' + String(orderId).padStart(3, '0').slice(-3);
const imageUrl = (name) => name ? `/images/${name}` : null;
const imageDirectory = path.join(__dirname, '..', '..', 'public', 'assets', 'img');
const imageExtensions = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
};
fs.mkdirSync(imageDirectory, { recursive: true });
const imageUpload = multer({
    storage: multer.diskStorage({
        destination: imageDirectory,
        filename: (req, file, callback) => {
            callback(null, `${crypto.randomUUID()}${imageExtensions[file.mimetype]}`);
        },
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
    fileFilter: (req, file, callback) => {
        if (!imageExtensions[file.mimetype]) {
            return callback(new Error('Upload a PNG, JPG, or WebP image.'));
        }
        callback(null, true);
    },
});

router.get('/settings', async (_req, res) => {
    try {
        res.json(await readAdminSettings());
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch admin settings', details: err.message });
    }
});

router.put('/settings', async (req, res) => {
    try {
        const settings = normalizeAdminSettings(req.body);
        res.json(await saveAdminSettings(settings));
    } catch (err) {
        if (err instanceof SettingsValidationError) {
            return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: 'Failed to save admin settings', details: err.message });
    }
});

// GET /api/admin/overview — Dashboard stats, charts, and metrics
router.get('/overview', async (req, res) => {
    const interval = String(req.query.interval || 'month').toLowerCase();
    const intervalQueries = {
        day: {
            key: 'HOUR(created_at)',
            where: 'DATE(created_at) = CURRENT_DATE()',
        },
        week: {
            key: "DATE_FORMAT(created_at, '%Y-%m-%d')",
            where: 'created_at >= CURRENT_DATE() - INTERVAL 6 DAY AND created_at < CURRENT_DATE() + INTERVAL 1 DAY',
        },
        month: {
            key: "DATE_FORMAT(created_at, '%Y-%m-%d')",
            where: 'YEAR(created_at) = YEAR(CURRENT_DATE()) AND MONTH(created_at) = MONTH(CURRENT_DATE())',
        },
        year: {
            key: "DATE_FORMAT(created_at, '%Y-%m')",
            where: 'YEAR(created_at) = YEAR(CURRENT_DATE())',
        },
    };
    if (!intervalQueries[interval]) {
        return res.status(400).json({ error: 'Invalid analytics interval' });
    }

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

        const [paymentMethods] = await db.query(`
            SELECT COALESCE(m.payment_method, IF(m.is_walkin = 1, 'Cash', 'GCash')) AS method,
                   COUNT(o.order_id) AS transactions,
                   COALESCE(SUM(o.total_price), 0) AS sales
            FROM orders o
            LEFT JOIN pos_order_meta m ON m.order_id = o.order_id
            WHERE o.status != 'VOIDED' AND DATE(o.created_at) = CURRENT_DATE()
            GROUP BY method
            ORDER BY sales DESC
        `);

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

        const timelineQuery = intervalQueries[interval];
        const [timelineRows] = await db.query(`
            SELECT ${timelineQuery.key} AS period_key,
                   COUNT(CASE WHEN status != 'VOIDED' THEN order_id END) AS orders,
                   COALESCE(SUM(CASE WHEN status != 'VOIDED' THEN total_price ELSE 0 END), 0) AS sales
            FROM orders
            WHERE ${timelineQuery.where}
            GROUP BY period_key
            ORDER BY period_key ASC
        `);
        const timelineByKey = new Map(timelineRows.map(row => [
            String(row.period_key),
            { sales: Number(row.sales), orders: Number(row.orders) },
        ]));
        const now = new Date();
        const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        let salesTimeline;
        if (interval === 'day') {
            salesTimeline = Array.from({ length: 24 }, (_, hour) => ({
                label: `${hour % 12 || 12} ${hour >= 12 ? 'PM' : 'AM'}`,
                key: String(hour),
                ...(timelineByKey.get(String(hour)) || { sales: 0, orders: 0 }),
            }));
        } else if (interval === 'year') {
            salesTimeline = Array.from({ length: now.getMonth() + 1 }, (_, month) => {
                const key = `${now.getFullYear()}-${String(month + 1).padStart(2, '0')}`;
                return {
                    label: new Date(now.getFullYear(), month, 1).toLocaleString('en-US', { month: 'short' }),
                    key,
                    ...(timelineByKey.get(key) || { sales: 0, orders: 0 }),
                };
            });
        } else {
            const start = interval === 'week'
                ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
                : new Date(now.getFullYear(), now.getMonth(), 1);
            const days = interval === 'week' ? 7 : now.getDate();
            salesTimeline = Array.from({ length: days }, (_, offset) => {
                const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
                const key = dateKey(date);
                const label = interval === 'week'
                    ? date.toLocaleString('en-US', { weekday: 'short' }) + ' ' + date.getDate()
                    : String(date.getDate());
                return {
                    label,
                    key,
                    ...(timelineByKey.get(key) || { sales: 0, orders: 0 }),
                };
            });
        }

        // Include the full local calendar day so overnight sales are visible too.
        const hourlyData = Array.from({ length: 24 }, (_, hour) => {
            const match = hourly.find(row => Number(row.hr) === hour);
            const time = `${hour % 12 || 12} ${hour >= 12 ? 'PM' : 'AM'}`;
            return {
                hour,
                time,
                sales: match ? Number(match.sales) : 0,
                orders: match ? Number(match.orders) : 0
            };
        });

        // Peak time calculation
        let peakTime = 'None yet';
        if (hourly.some(h => Number(h.orders) > 0)) {
            const maxHour = hourly.reduce((prev, curr) => (Number(curr.orders) > Number(prev.orders) ? curr : prev), hourly[0]);
            const h = Number(maxHour.hr);
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
            paymentMethods: paymentMethods.map(row => ({
                method: row.method,
                transactions: Number(row.transactions),
                sales: Number(row.sales),
            })),
            hourly: hourlyData,
            salesTimeline,
            salesInterval: interval
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch overview', details: err.message });
    }
});

// GET /api/admin/transactions — All transactions with full metadata
router.get('/transactions', async (req, res) => {
    try {
        await ensureAuditTable();
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
            SELECT oi.order_item_id, oi.order_id, oi.variant_id, oi.quantity,
                   oi.price_at_purchase, oi.add_ons, pv.size_name, p.name, p.image_url
            FROM order_items oi
            JOIN product_variants pv ON pv.variant_id = oi.variant_id
            JOIN products p ON p.product_id = pv.product_id
            WHERE oi.order_id IN (?)
        `, [ids]);

        const [auditRows] = await db.query(`
            SELECT audit_id, order_id, order_item_id, variant_id, product_name, size_name,
                   action, previous_quantity, new_quantity, previous_price, new_price,
                   previous_status, new_status, source, actor, details, created_at
            FROM order_item_audit_logs
            WHERE order_id IN (?)
            ORDER BY created_at ASC, audit_id ASC
        `, [ids]);

        const list = orders.map(o => {
            const items = itemRows.filter(i => i.order_id === o.order_id);
            const auditLogs = auditRows.filter(log => log.order_id === o.order_id);
            const itemStrings = items.map(i => {
                const addOns = normalizeAddOns(i.add_ons);
                const addonNames = addOns.map(addon => `${addon.name}${addon.quantity > 1 ? ` ×${addon.quantity}` : ''}`);
                return `${i.name} (${i.size_name})${addonNames.length ? ` + ${addonNames.join(', ')}` : ''} x${i.quantity}`;
            });
            return {
                id: queueNumber(o.order_id),
                rawId: o.order_id,
                date: o.created_at,
                cashierId: o.is_walkin ? 'Cashier #1' : 'Kiosk Self-Order',
                items: itemStrings.length ? itemStrings : ['No items recorded'],
                itemDetails: items.map(item => ({
                    ...item,
                    add_ons: normalizeAddOns(item.add_ons),
                    auditLogs: auditLogs.filter(log => log.variant_id === item.variant_id),
                })),
                auditLogs,
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

// POST /api/admin/menu/images — Store product image in the shared kiosk/POS image directory.
router.post('/menu/images', (req, res, next) => {
    imageUpload.single('image')(req, res, err => {
        if (!err) return next();
        const status = err instanceof multer.MulterError
            ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
            : (err.code ? 500 : 400);
        res.status(status).json({ error: err.message });
    });
}, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose an image to upload.' });
    let fileHandle;
    try {
        fileHandle = await fs.promises.open(req.file.path, 'r');
        const header = Buffer.alloc(12);
        const { bytesRead } = await fileHandle.read(header, 0, header.length, 0);
        await fileHandle.close();
        fileHandle = null;
        const isPng = bytesRead >= 8
            && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const isJpeg = bytesRead >= 3
            && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
        const isWebp = bytesRead >= 12
            && header.toString('ascii', 0, 4) === 'RIFF'
            && header.toString('ascii', 8, 12) === 'WEBP';
        const matchesType = (req.file.mimetype === 'image/png' && isPng)
            || (req.file.mimetype === 'image/jpeg' && isJpeg)
            || (req.file.mimetype === 'image/webp' && isWebp);
        if (!matchesType) {
            await fs.promises.unlink(req.file.path);
            return res.status(400).json({ error: 'The selected file is not a valid PNG, JPG, or WebP image.' });
        }
    } catch (err) {
        if (fileHandle) {
            const openFile = fileHandle;
            fileHandle = null;
            try {
                await openFile.close();
            } catch (closeError) {
                console.error('[admin] failed to close uploaded image:', closeError.message);
            }
        }
        try {
            await fs.promises.unlink(req.file.path);
        } catch (cleanupError) {
            console.error('[admin] failed to remove invalid uploaded image:', cleanupError.message);
        }
        console.error('[admin] product image validation failed:', err.message);
        return res.status(500).json({ error: 'Failed to validate uploaded image.' });
    }
    res.status(201).json({
        success: true,
        filename: req.file.filename,
        url: imageUrl(req.file.filename),
    });
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
