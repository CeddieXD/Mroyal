const PRINTER_SERVER_URL = (process.env.PRINTER_SERVER_URL || 'http://127.0.0.1:3101').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 10000;

async function requestPrinter(path, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
            throw new Error(`Printer server did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function printText(text) {
    return requestPrinter('/print', { text });
}

function saveReportPdf(report) {
    return requestPrinter('/reports/pdf', report);
}

module.exports = { printText, saveReportPdf };
