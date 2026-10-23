// POS module — endpoints consumed by the Mango Royal POS lite frontend.
// Reuses the shared mysql2 pool from ../config/db.
const express = require('express');
const db = require('../config/db');
const bus = require('./events');
const { printText } = require('../printer-client');
const {
    ensureAuditTable,
    loadOrderItemSnapshots,
    normalizeAddOns,
    writeItemAuditLogs,
    writeOrderStatusAudit,
} = require('../audit-logs');
const { calculateDiscount } = require('./discount-calculation');
const { readAdminSettings } = require('../config/admin-settings');

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

router.get('/settings', async (_req, res) => {
    try {
        const settings = await readAdminSettings();
        res.json({ endOfDayReceiptEnabled: settings.posFeatures.endOfDayReceiptEnabled });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch POS settings', details: err.message });
    }
});

router.post('/end-of-day-receipt', async (req, res) => {
    try {
        const settings = await readAdminSettings();
        if (!settings.posFeatures.endOfDayReceiptEnabled) {
            return res.status(403).json({ error: 'End-of-Day Receipt printing is disabled by the administrator.' });
        }
        await ensureEndOfDayReceiptTable();
        const [[totals]] = await db.query(`
            SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS businessDate,
                   COUNT(o.order_id) AS totalOrders,
                   COALESCE(SUM(o.status = 'VERIFIED'), 0) AS completedOrders,
                   COALESCE(SUM(o.status = 'VOIDED'), 0) AS voidedOrders,
                   COALESCE(SUM(CASE WHEN o.status = 'VERIFIED' THEN o.total_price ELSE 0 END), 0) AS grossSales,
                   COALESCE(SUM(CASE WHEN o.status = 'VERIFIED' THEN COALESCE(m.vat_exempt_amount, 0) ELSE 0 END), 0) AS vatExemptAmount,
                   COALESCE(SUM(CASE WHEN o.status = 'VERIFIED' THEN COALESCE(m.discount_amount, 0) ELSE 0 END), 0) AS discountAmount,
                   COALESCE(SUM(CASE WHEN o.status = 'VERIFIED'
                       THEN GREATEST(0, o.total_price - COALESCE(m.vat_exempt_amount, 0) - COALESCE(m.discount_amount, 0))
                       ELSE 0 END), 0) AS netSales
            FROM orders o
            LEFT JOIN pos_order_meta m ON m.order_id = o.order_id
            WHERE DATE(o.created_at) = CURRENT_DATE()
        `);
        const [paymentRows] = await db.query(`
            SELECT COALESCE(m.payment_method, IF(m.is_walkin = 1, 'Cash', 'GCash')) AS method,
                   COUNT(o.order_id) AS transactions,
                   COALESCE(SUM(GREATEST(0,
                       o.total_price - COALESCE(m.vat_exempt_amount, 0) - COALESCE(m.discount_amount, 0)
                   )), 0) AS amount
            FROM orders o
            LEFT JOIN pos_order_meta m ON m.order_id = o.order_id
            WHERE DATE(o.created_at) = CURRENT_DATE() AND o.status = 'VERIFIED'
            GROUP BY method
            ORDER BY method
        `);
        const [itemRows] = await db.query(`
            SELECT p.name, SUM(oi.quantity) AS quantity,
                   SUM(oi.quantity * oi.price_at_purchase) AS revenue
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.order_id
            JOIN product_variants pv ON pv.variant_id = oi.variant_id
            JOIN products p ON p.product_id = pv.product_id
            WHERE DATE(o.created_at) = CURRENT_DATE() AND o.status = 'VERIFIED'
            GROUP BY p.product_id, p.name
            ORDER BY quantity DESC, revenue DESC
            LIMIT 10
        `);
        const report = {
            businessDate: totals.businessDate,
            generatedAt: new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }),
            totalOrders: Number(totals.totalOrders),
            completedOrders: Number(totals.completedOrders),
            voidedOrders: Number(totals.voidedOrders),
            grossSales: money(totals.grossSales),
            vatExemptAmount: money(totals.vatExemptAmount),
            discountAmount: money(totals.discountAmount),
            netSales: money(totals.netSales),
            paymentMethods: paymentRows.map(row => ({
                method: row.method,
                transactions: Number(row.transactions),
                amount: money(row.amount),
            })),
            topItems: itemRows.map(row => ({
                name: row.name,
                quantity: Number(row.quantity),
                revenue: money(row.revenue),
            })),
        };
        const [record] = await db.query(
            `INSERT INTO pos_end_of_day_receipts
                (business_date, report_json, created_by)
             VALUES (CURRENT_DATE(), ?, ?)`,
            [JSON.stringify(report), req.staff.displayName]
        );
        try {
            const result = await printText(endOfDayReceiptText(report));
            await db.query(
                `UPDATE pos_end_of_day_receipts
                 SET print_status = 'PRINTED', printed_at = CURRENT_TIMESTAMP
                 WHERE receipt_id = ?`,
                [record.insertId]
            );
            res.json({ success: true, receiptId: record.insertId, report, print: result });
        } catch (printError) {
            await db.query(
                `UPDATE pos_end_of_day_receipts
                 SET print_status = 'FAILED', print_error = ?
                 WHERE receipt_id = ?`,
                [printError.message.slice(0, 500), record.insertId]
            );
            console.error(`[pos] end-of-day receipt ${record.insertId} was recorded but could not print:`, printError.message);
            res.status(502).json({
                error: 'End-of-Day Receipt was recorded but could not be printed.',
                receiptId: record.insertId,
                details: printError.message,
            });
        }
    } catch (err) {
        console.error('[pos] end-of-day receipt failed:', err.message);
        res.status(500).json({ error: 'Could not create the End-of-Day Receipt.', details: err.message });
    }
});

const STATUS = { PENDING: 'PENDING', VERIFIED: 'VERIFIED', VOIDED: 'VOIDED' };

// Match the queue-number format the kiosk shows customers (server.js: 'A' + last 3 digits of order_id).
const queueNumber = (orderId) => 'A' + String(orderId).padStart(3, '0').slice(-3);

// Turn a bare "MangoRoyal.png" into a URL the POS frontend can load.
const imageUrl = (name) => name ? `/images/${name}` : null;
const money = amount => Math.round((Number(amount) + Number.EPSILON) * 100) / 100;

async function ensureEndOfDayReceiptTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS pos_end_of_day_receipts (
            receipt_id BIGINT AUTO_INCREMENT PRIMARY KEY,
            business_date DATE NOT NULL,
            report_json JSON NOT NULL,
            print_status ENUM('PENDING', 'PRINTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
            print_error VARCHAR(500) NULL,
            created_by VARCHAR(100) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            printed_at TIMESTAMP NULL,
            INDEX idx_pos_eod_receipts_date (business_date, created_at)
        )
    `);
}

function endOfDayReceiptText(report) {
    const lines = [
        'MANGO ROYAL',
        'END OF DAY RECEIPT',
        `Business date: ${report.businessDate}`,
        `Printed: ${report.generatedAt}`,
        '-'.repeat(38),
        `Orders received: ${report.totalOrders}`,
        `Completed orders: ${report.completedOrders}`,
        `Voided orders: ${report.voidedOrders}`,
        `Gross sales: PHP ${report.grossSales.toFixed(2)}`,
        `VAT exemption: PHP ${report.vatExemptAmount.toFixed(2)}`,
        `PWD/Senior discount: PHP ${report.discountAmount.toFixed(2)}`,
        `NET SALES: PHP ${report.netSales.toFixed(2)}`,
        '-'.repeat(38),
        'PAYMENT METHODS',
        ...report.paymentMethods.map(payment =>
            `${payment.method}: PHP ${payment.amount.toFixed(2)} (${payment.transactions})`
        ),
        '-'.repeat(38),
        'TOP ITEMS',
        ...report.topItems.map(item =>
            `${item.name} x${item.quantity} PHP ${item.revenue.toFixed(2)}`
        ),
        ...(report.topItems.length ? [] : ['No completed items']),
        '-'.repeat(38),
        'THIS IS NOT A SALES INVOICE',
        '',
        '',
    ];
    return lines.join('\n');
}

// Idempotent side table for POS-only metadata (payment, discount, void reason, walk-in flag)
async function ensureMetaTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS pos_order_meta (
            order_id INT PRIMARY KEY,
            payment_method VARCHAR(20) DEFAULT 'Cash',
            payment_amount DECIMAL(10,2) NULL,
            discount_type VARCHAR(20) NULL,
            discount_amount DECIMAL(10,2) DEFAULT 0,
            vat_exempt_amount DECIMAL(10,2) DEFAULT 0,
            discount_details JSON NULL,
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
        ['vat_exempt_amount', 'DECIMAL(10,2) DEFAULT 0'],
        ['discount_details', 'JSON NULL'],
    ];
    for (const [name, definition] of newColumns) {
        if (!existingColumns.has(name)) {
            await db.query(`ALTER TABLE pos_order_meta ADD COLUMN ${name} ${definition}`);
        }
    }
}
const metaTableReady = ensureMetaTable().catch(err => {
    console.error('[pos] meta table init failed:', err.message);
    throw err;
});

// Load orders + items for the given status filter
async function loadOrders(status, orderId = null) {
    await metaTableReady;
    const orderFilter = orderId === null ? '' : ' AND o.order_id = ?';
    const orderParams = orderId === null ? [status] : [status, orderId];
    const [orderRows] = await db.query(
        `SELECT o.order_id, o.subtotal, o.total_price, o.created_at, o.status,
                m.payment_method, m.payment_amount, m.discount_type, m.discount_amount,
                m.vat_exempt_amount, m.discount_details,
                m.void_reason, m.is_walkin
         FROM orders o
         LEFT JOIN pos_order_meta m ON m.order_id = o.order_id
         WHERE o.status = ?${orderFilter}
         ORDER BY o.created_at DESC`,
        orderParams
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
    const [addonRows] = await db.query('SELECT name, price FROM menu_addons');
    const addonPrices = new Map(addonRows.map(addon => [addon.name, Number(addon.price)]));

    return orderRows.map(o => ({
        orderId: queueNumber(o.order_id),
        rawId: o.order_id,
        status: o.status,
        timestamp: new Date(o.created_at).toISOString().replace('T', ' ').slice(0, 19),
        subtotal: Number(o.subtotal),
        total: Number(o.total_price),
        paymentMethod: o.payment_method || (o.is_walkin ? 'Cash' : 'GCash'),
        paymentAmount: o.payment_amount != null ? Number(o.payment_amount) : null,
        discountType: o.discount_type,
        discountAmount: o.discount_amount != null ? Number(o.discount_amount) : 0,
        vatExemptAmount: o.vat_exempt_amount != null ? Number(o.vat_exempt_amount) : 0,
        discountDetails: o.discount_details == null
            ? null
            : typeof o.discount_details === 'string'
                ? JSON.parse(o.discount_details)
                : o.discount_details,
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
                addOns: normalizeAddOns(i.add_ons).map(addon => {
                    const price = addon.price ?? addonPrices.get(addon.name);
                    if (price === undefined) {
                        throw new Error(`No price is available for stored add-on "${addon.name}".`);
                    }
                    return { ...addon, price };
                }),
            })),
    }));
}

function receiptText(order) {
    const amountDue = Math.max(0, order.total - order.vatExemptAmount - order.discountAmount);
    const columnWidth = 38;
    const quantityWidth = 4;
    const priceWidth = 12;
    const itemWidth = columnWidth - quantityWidth - priceWidth;
    const formatPrice = amount => `PHP ${Number(amount).toFixed(2)}`.padStart(priceWidth);
    const formatSummary = (label, amount) =>
        `${label.padEnd(columnWidth - priceWidth)}${`-PHP ${Number(amount).toFixed(2)}`.padStart(priceWidth)}`;
    const wrapLabel = label => {
        const words = label.split(/\s+/);
        const wrapped = [];
        let current = '';
        for (const word of words) {
            const next = current ? `${current} ${word}` : word;
            if (current && next.length > itemWidth) {
                wrapped.push(current);
                current = word;
            } else {
                current = next;
            }
        }
        if (current) wrapped.push(current);
        return wrapped;
    };
    const lines = [
        'ACKNOWLEDGEMENT RECEIPT',
        'MANGO ROYAL',
        '390 Sto.Domingo Street, Mayapa,',
        'Calamba City, Calamba,',
        'Philippines, 4027',
        '',
        `Order No: ${order.orderId}`,
        `Date: ${order.timestamp}`,
        '-'.repeat(columnWidth),
        `${'QTY'.padEnd(quantityWidth)}${'ITEM'.padEnd(itemWidth)}${'PRICE'.padStart(priceWidth)}`,
        '-'.repeat(columnWidth),
    ];
    for (const item of order.items) {
        const quantity = String(item.quantity);
        const label = item.bundleQuantity > 1
            ? 'Bundle Mango'
            : `${item.name} (${item.size})`;
        const wrappedLabel = wrapLabel(label);
        const addOnTotal = item.addOns.reduce(
            (sum, addon) => sum + Number(addon.price) * addon.quantity * item.quantity,
            0
        );
        lines.push(
            `${quantity.padEnd(quantityWidth)}${wrappedLabel[0].padEnd(itemWidth)}${formatPrice(item.price * item.quantity - addOnTotal)}`,
            ...wrappedLabel.slice(1).map(line => `${''.padEnd(quantityWidth)}${line}`)
        );
        for (const addon of item.addOns) {
            const addonName = `${addon.name}${addon.quantity > 1 ? ` x${addon.quantity}` : ''}`;
            for (const [index, line] of wrapLabel(addonName).entries()) {
                lines.push(
                    `${''.padEnd(quantityWidth)}${line.padEnd(itemWidth)}${index === 0
                        ? formatPrice(Number(addon.price) * addon.quantity * item.quantity)
                        : ''.padStart(priceWidth)}`
                );
            }
        }
    }
    lines.push(
        '-'.repeat(columnWidth),
        ...(order.vatExemptAmount ? [formatSummary('VAT exemption:', order.vatExemptAmount)] : []),
        ...(order.discountAmount ? [formatSummary(`${order.discountType || 'Discount'} discount (20%):`, order.discountAmount)] : []),
        ...(order.discountDetails?.scope === 'individual_share'
            ? [`Eligible share: ${order.discountDetails.cardholderCount} of ${order.discountDetails.totalPeople} people`]
            : order.discountDetails?.scope === 'selected_items'
                ? [`Eligible servings: ${order.discountDetails.eligibleItems.reduce((sum, item) => sum + item.servings, 0)}`]
                : []),
        `${'TOTAL:'.padStart(columnWidth - priceWidth)}${formatPrice(amountDue)}`,
        '-'.repeat(columnWidth),
        '',
        'THIS IS NOT A SALES INVOICE',
        'Intended for academic purposes only.',
        '',
        ''
    );
    return lines.join('\n');
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
        vatExemptAmount = 0,
        discountScope = null,
        totalPeople = null,
        cardholderCount = null,
        eligibleItems = [],
        pwdIdNumber = null,
        seniorName = null,
        seniorBirthdate = null,
    } = req.body || {};
    const parsedPaymentAmount = Number(paymentAmount);
    const parsedDiscountAmount = Number(discountAmount);
    const parsedVatExemptAmount = Number(vatExemptAmount);
    if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ error: 'Invalid order ID' });
    }
    if (!Number.isFinite(parsedPaymentAmount) || parsedPaymentAmount <= 0) {
        return res.status(400).json({ error: 'A valid payment amount is required' });
    }
    if (!Number.isFinite(parsedDiscountAmount) || parsedDiscountAmount < 0) {
        return res.status(400).json({ error: 'A valid discount amount is required' });
    }
    if (!Number.isFinite(parsedVatExemptAmount) || parsedVatExemptAmount < 0) {
        return res.status(400).json({ error: 'A valid VAT-exempt amount is required' });
    }
    if (discountType && !['PWD', 'Senior'].includes(discountType)) {
        return res.status(400).json({ error: 'Invalid discount type' });
    }
    const normalizedPwdId = typeof pwdIdNumber === 'string' ? pwdIdNumber.trim() : '';
    const normalizedSeniorName = typeof seniorName === 'string' ? seniorName.trim() : '';
    if (discountType === 'PWD' && !normalizedPwdId) {
        return res.status(400).json({ error: 'PWD ID number is required' });
    }
    if (discountType === 'PWD' && !/^\d{2}-\d{4}-\d{3}-\d{7}$/.test(normalizedPwdId)) {
        return res.status(400).json({ error: 'Enter the PWD ID in the format RR-PPMM-BBB-NNNNNNN' });
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
        const age = dateParts
            ? now.getFullYear() - Number(dateParts[1])
                - (now.getMonth() + 1 < Number(dateParts[2])
                    || (now.getMonth() + 1 === Number(dateParts[2]) && now.getDate() < Number(dateParts[3])) ? 1 : 0)
            : null;
        if (!normalizedSeniorName || !validBirthdate) {
            return res.status(400).json({ error: 'Senior citizen name and valid birthdate are required' });
        }
        if (age < 60) {
            return res.status(400).json({ error: `The senior citizen discount requires the cardholder to be at least 60 years old. Current age: ${age}.` });
        }
    }
    try {
        await metaTableReady;
        await ensureAuditTable();
        let wasAlreadyVerified = false;
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
        } catch (err) {
            connection.release();
            throw err;
        }
        let orderTotal;
        let previousStatus;
        let discountCalculation = {
            eligibleGross: 0,
            vatExclusiveAmount: 0,
            vatExemptAmount: 0,
            discountAmount: 0,
            amountDue: 0,
            details: null,
        };
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
            wasAlreadyVerified = previousStatus === STATUS.VERIFIED;
            discountCalculation.amountDue = orderTotal;

            if (discountType) {
                const [itemRows] = await connection.query(
                    `SELECT oi.order_item_id AS id, oi.quantity, oi.price_at_purchase AS price,
                            p.bundle_quantity AS bundleQuantity
                     FROM order_items oi
                     JOIN product_variants pv ON pv.variant_id = oi.variant_id
                     JOIN products p ON p.product_id = pv.product_id
                     WHERE oi.order_id = ?
                     FOR UPDATE`,
                    [orderId]
                );
                discountCalculation = calculateDiscount({
                    orderTotal,
                    scope: discountScope,
                    totalPeople,
                    cardholderCount,
                    eligibleItems,
                    orderItems: itemRows,
                });
            }
            if (Math.abs(parsedDiscountAmount - discountCalculation.discountAmount) > 0.01
                || Math.abs(parsedVatExemptAmount - discountCalculation.vatExemptAmount) > 0.01) {
                await connection.rollback();
                return res.status(400).json({ error: 'Discount or VAT exemption does not match the eligible portion' });
            }
            if (parsedPaymentAmount + 0.001 < discountCalculation.amountDue) {
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
                    vat_exempt_amount, discount_details, pwd_id_number, senior_name, senior_birthdate
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                     payment_method = VALUES(payment_method),
                     payment_amount = VALUES(payment_amount),
                     discount_type = VALUES(discount_type),
                     discount_amount = VALUES(discount_amount),
                     vat_exempt_amount = VALUES(vat_exempt_amount),
                     discount_details = VALUES(discount_details),
                     pwd_id_number = VALUES(pwd_id_number),
                     senior_name = VALUES(senior_name),
                     senior_birthdate = VALUES(senior_birthdate)`,
                [
                    orderId,
                    paymentMethod,
                    parsedPaymentAmount,
                    discountType,
                    parsedDiscountAmount,
                    parsedVatExemptAmount,
                    discountCalculation.details ? JSON.stringify(discountCalculation.details) : null,
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
        if (wasAlreadyVerified) {
            return res.json({ success: true, print: { success: true, skipped: true } });
        }
        try {
            const [order] = await loadOrders(STATUS.VERIFIED, orderId);
            if (!order) throw new Error('Verified order could not be loaded for printing.');
            const print = await printText(receiptText(order));
            res.json({ success: true, print });
        } catch (printError) {
            console.error(`[pos] order ${orderId} was verified but automatic receipt printing failed:`, printError.message);
            res.json({ success: true, print: { success: false, error: printError.message } });
        }
    } catch (err) {
        res.status(err.statusCode || 500).json({
            error: err.statusCode ? err.message : 'Verify failed',
            ...(err.statusCode ? {} : { details: err.message }),
        });
    }
});

router.post('/orders/:id/print', async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ error: 'Invalid order ID' });
    }
    try {
        let [order] = await loadOrders(STATUS.PENDING, orderId);
        if (!order) [order] = await loadOrders(STATUS.VERIFIED, orderId);
        if (!order) return res.status(404).json({ error: 'Pending or verified order not found.' });
        const result = await printText(receiptText(order));
        res.json({ success: true, print: result });
    } catch (err) {
        console.error(`[pos] manual receipt printing failed for order ${orderId}:`, err.message);
        res.status(502).json({ error: 'Receipt printing failed.', details: err.message });
    }
});

// POST /api/pos/orders/:id/void — with reason
router.post('/orders/:id/void', async (req, res) => {
    const orderId = Number(req.params.id);
    const { reason = '', pendingOnly = false } = req.body || {};
    if (typeof pendingOnly !== 'boolean') {
        return res.status(400).json({ error: 'Invalid pending-order requirement.' });
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 255) {
        return res.status(400).json({ error: 'Enter a void reason under 255 characters.' });
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
            const [orders] = await connection.query(
                'SELECT status FROM orders WHERE order_id = ? FOR UPDATE',
                [orderId]
            );
            if (!orders.length) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }
            if (pendingOnly && orders[0].status !== STATUS.PENDING) {
                await connection.rollback();
                return res.status(409).json({ error: 'This order is no longer pending and cannot be bulk voided.' });
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
                [orderId, reason.trim()]
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
// body: { items: [{ variantId, quantity, price, addOns? }] }
router.post('/orders/walkin', async (req, res) => {
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
        let orderId;
        try {
            const [sess] = await connection.query(
                "INSERT INTO sessions (device_id, status) VALUES ('POS_01', 'completed')"
            );
            const sessionId = sess.insertId;

            const [ord] = await connection.query(
                `INSERT INTO orders (session_id, subtotal, total_price, order_type, status)
                 VALUES (?, ?, ?, 'Standard', ?)`,
                [sessionId, subtotal, subtotal, STATUS.PENDING]
            );
            orderId = ord.insertId;

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
