const db = require('./config/db');

let tableReady;

function ensureStaffActivityTable() {
    if (!tableReady) {
        tableReady = db.query(`
            CREATE TABLE IF NOT EXISTS staff_activity_logs (
                activity_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL,
                display_name VARCHAR(150) NOT NULL,
                \`role\` VARCHAR(20) NOT NULL,
                \`action\` VARCHAR(100) NOT NULL,
                details VARCHAR(500) NOT NULL,
                category VARCHAR(32) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_staff_activity_created (created_at),
                INDEX idx_staff_activity_user (username, created_at)
            )
        `).catch(error => {
            tableReady = null;
            throw error;
        });
    }
    return tableReady;
}

async function writeStaffActivity({ username, displayName, role, action, details, category }) {
    await ensureStaffActivityTable();
    const [result] = await db.query(`
        INSERT INTO staff_activity_logs
            (username, display_name, \`role\`, \`action\`, details, category)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [username, displayName, role, action, details, category]);
    return {
        id: result.insertId,
        timestamp: new Date(),
        user: displayName,
        role,
        action,
        details,
        category,
    };
}

async function listStaffActivity(limit = 500) {
    await ensureStaffActivityTable();
    const [rows] = await db.query(`
        SELECT activity_id AS id, created_at AS timestamp, display_name AS user,
               \`role\`, \`action\`, details, category
        FROM staff_activity_logs
        ORDER BY created_at DESC, activity_id DESC
        LIMIT ?
    `, [limit]);
    return rows;
}

module.exports = { ensureStaffActivityTable, writeStaffActivity, listStaffActivity };
