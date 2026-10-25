const PRINTER_SERVER_URL = (process.env.PRINTER_SERVER_URL || 'http://127.0.0.1:3101').replace(/\/+$/, '');
const PRINT_REQUEST_TIMEOUT_MS = 60000;
const REPORT_REQUEST_TIMEOUT_MS = 10000;

async function requestPrinter(path, payload, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${PRINTER_SERVER_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Printer server returned HTTP ${response.status}.`);
        }
        return result;
    } catch (error) {
        if (error.name === 'AbortError') {
            if (path === '/print') {
                throw new Error(
                    `Printer server did not confirm print submission within ${timeoutMs / 1000} seconds. ` +
                    'The job may still print; check the printer before retrying.'
                );
            }
            throw new Error(`Printer server did not respond within ${timeoutMs / 1000} seconds.`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function printText(text) {
    return requestPrinter('/print', { text }, PRINT_REQUEST_TIMEOUT_MS);
}

function saveReportPdf(report) {
    return requestPrinter('/reports/pdf', report, REPORT_REQUEST_TIMEOUT_MS);
}

module.exports = { printText, saveReportPdf };
