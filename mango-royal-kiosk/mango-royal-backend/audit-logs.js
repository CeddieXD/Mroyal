const db = require('./config/db');

function normalizeAddOns(value) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed == null) return [];
    if (!Array.isArray(parsed)) throw new Error('Stored add-ons must be a JSON array.');
    return parsed.map(addon => {
        if (typeof addon === 'string') return { name: addon, quantity: 1 };
        if (!addon || typeof addon.name !== 'string') {
            throw new Error('Stored add-on entry is invalid.');
        }
        const quantity = addon.quantity === undefined ? 1 : Number(addon.quantity);
        if (!Number.isInteger(quantity) || quantity < 1) {
            throw new Error('Stored add-on quantity is invalid.');
        }
        return { name: addon.name, quantity };
    });
}

let auditTableReady;

function ensureAuditTable() {
    if (!auditTableReady) {
        auditTableReady = db.query(`
            CREATE TABLE IF NOT EXISTS order_item_audit_logs (
                audit_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                order_item_id INT NULL,
                variant_id INT NULL,
                product_name VARCHAR(100) NOT NULL,
                size_name VARCHAR(20) NULL,
                action VARCHAR(32) NOT NULL,
                previous_quantity INT NULL,
                new_quantity INT NULL,
                previous_price DECIMAL(10,2) NULL,
                new_price DECIMAL(10,2) NULL,
                previous_status VARCHAR(32) NULL,
                new_status VARCHAR(32) NULL,
                source VARCHAR(32) NOT NULL,
                actor VARCHAR(100) NULL,
                details JSON NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_order_item_audit_order_time (order_id, created_at),
                INDEX idx_order_item_audit_variant (order_id, variant_id),
                FOREIGN KEY (order_id) REFERENCES orders(order_id)
            )
        `).then(() => db.query(`
            INSERT INTO order_item_audit_logs (
                order_id, order_item_id, variant_id, product_name, size_name, action,
                new_quantity, new_price, new_status, source, actor
            )
            SELECT oi.order_id, oi.order_item_id, oi.variant_id, p.name, pv.size_name,
                   'BASELINE_IMPORTED', oi.quantity, oi.price_at_purchase, o.status,
                   'System', 'Imported legacy order'
            FROM order_items oi
            JOIN orders o ON o.order_id = oi.order_id
            JOIN product_variants pv ON pv.variant_id = oi.variant_id
            JOIN products p ON p.product_id = pv.product_id
            LEFT JOIN order_item_audit_logs existing
                ON existing.order_item_id = oi.order_item_id
            WHERE existing.audit_id IS NULL
        `)).catch(err => {
            auditTableReady = null;
            throw err;
        });
    }
    return auditTableReady;
}

async function writeItemAuditLogs(executor, entries) {
    if (!entries.length) return;
    await ensureAuditTable();
    const values = entries.map(entry => [
        entry.orderId,
        entry.orderItemId ?? null,
        entry.variantId ?? null,
        entry.productName,
        entry.sizeName ?? null,
        entry.action,
        entry.previousQuantity ?? null,
        entry.newQuantity ?? null,
        entry.previousPrice ?? null,
        entry.newPrice ?? null,
        entry.previousStatus ?? null,
        entry.newStatus ?? null,
        entry.source,
        entry.actor ?? null,
        entry.details == null ? null : JSON.stringify(entry.details),
    ]);
    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    await executor.query(
        `INSERT INTO order_item_audit_logs (
            order_id, order_item_id, variant_id, product_name, size_name, action,
            previous_quantity, new_quantity, previous_price, new_price,
            previous_status, new_status, source, actor, details
         ) VALUES ${placeholders}`,
        values.flat()
    );
}

async function loadOrderItemSnapshots(executor, orderId) {
    const [rows] = await executor.query(`
        SELECT oi.order_item_id, oi.variant_id, oi.quantity, oi.price_at_purchase, oi.add_ons,
               pv.size_name, p.name AS product_name
        FROM order_items oi
        JOIN product_variants pv ON pv.variant_id = oi.variant_id
        JOIN products p ON p.product_id = pv.product_id
        WHERE oi.order_id = ?
    `, [orderId]);
    return rows;
}

async function writeOrderStatusAudit(executor, {
    orderId, previousStatus, newStatus, source, actor,
}) {
    const items = await loadOrderItemSnapshots(executor, orderId);
    await writeItemAuditLogs(executor, items.map(item => ({
        orderId,
        orderItemId: item.order_item_id,
        variantId: item.variant_id,
        productName: item.product_name,
        sizeName: item.size_name,
        action: 'STATUS_CHANGED',
        previousStatus,
        newStatus,
        source,
        actor,
    })));
}

module.exports = {
    normalizeAddOns,
    ensureAuditTable,
    loadOrderItemSnapshots,
    writeItemAuditLogs,
    writeOrderStatusAudit,
};
