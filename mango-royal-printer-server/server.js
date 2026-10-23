const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();
const PDFDocument = require('pdfkit');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PRINTER_SERVER_PORT || 3101);
const REPORT_DIRECTORY = path.resolve(
    process.env.REPORT_PDF_DIR || path.join(__dirname, 'reports')
);
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REPORT_ROWS = 500;

function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            const error = new Error('Request body exceeds the 1 MB limit.');
            error.status = 413;
            throw error;
        }
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        const error = new Error('Request body must be valid JSON.');
        error.status = 400;
        throw error;
    }
}

function validatePrintText(text) {
    if (typeof text !== 'string' || !text.trim()) {
        throw new Error('A non-empty text print job is required.');
    }
    if (text.length > 50000) {
        throw new Error('Print job exceeds the 50,000 character limit.');
    }
    return text.replace(/\0/g, '');
}

function runWindowsPrint(text) {
    if (process.platform !== 'win32') {
        return Promise.reject(new Error('Physical printing is supported on Windows only.'));
    }

    return new Promise((resolve, reject) => {
        let textPath;
        let output = '';
        let settled = false;
        const cleanup = () => {
            if (textPath) {
                fs.promises.unlink(textPath).catch(error => {
                    if (error.code !== 'ENOENT') console.error('[printer] temp-file cleanup failed:', error.message);
                });
            }
        };
        const fail = error => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };

        textPath = path.join(os.tmpdir(), `mroyal-print-${crypto.randomUUID()}.txt`);
        fs.promises.writeFile(textPath, text, 'utf8')
            .then(() => {
                const printerName = process.env.PRINTER_NAME || '';
                const child = spawn('powershell.exe', [
                    '-NoProfile',
                    '-NonInteractive',
                    '-ExecutionPolicy', 'Bypass',
                    '-File', path.join(__dirname, 'print.ps1'),
                    textPath,
                    printerName,
                ], { windowsHide: true });

                child.stdout.setEncoding('utf8');
                child.stderr.setEncoding('utf8');
                child.stdout.on('data', chunk => { output += chunk; });
                child.stderr.on('data', chunk => { output += chunk; });
                child.on('error', fail);
                child.on('close', code => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    if (code === 0) return resolve();
                    reject(new Error(output.trim() || `Windows print spooler exited with code ${code}.`));
                });
            })
            .catch(fail);
    });
}

function validateReport(report) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
        throw new Error('A report object is required.');
    }
    const title = typeof report.title === 'string' ? report.title.trim() : '';
    const generatedAt = typeof report.generatedAt === 'string' ? report.generatedAt : '';
    const rows = report.rows;
    if (!title || title.length > 120) throw new Error('Report title must be 1 to 120 characters.');
    if (!generatedAt || generatedAt.length > 80) throw new Error('Report generation time is required.');
    if (!Array.isArray(rows) || rows.length > MAX_REPORT_ROWS) {
        throw new Error(`Report must contain no more than ${MAX_REPORT_ROWS} rows.`);
    }
    const normalizedRows = rows.map((row, index) => {
        if (!Array.isArray(row) || row.length > 4 || row.some(cell =>
            !['string', 'number'].includes(typeof cell) || String(cell).length > 300
        )) {
            throw new Error(`Report row ${index + 1} has invalid cells.`);
        }
        return row.map(cell => String(cell).replace(/[\r\n]+/g, ' '));
    });
    return { title, generatedAt, rows: normalizedRows };
}

function createReportPdf(report) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(REPORT_DIRECTORY, { recursive: true });
        const filename = `mango_royal_report_${new Date().toISOString().replace(/[:.]/g, '-')}_${crypto.randomBytes(3).toString('hex')}.pdf`;
        const filePath = path.join(REPORT_DIRECTORY, filename);
        const doc = new PDFDocument({ size: 'A4', margin: 42 });
        const output = fs.createWriteStream(filePath);
        let settled = false;
        const fail = error => {
            if (settled) return;
            settled = true;
            output.destroy();
            fs.promises.unlink(filePath).catch(cleanupError => {
                if (cleanupError.code !== 'ENOENT') console.error('[printer] incomplete PDF cleanup failed:', cleanupError.message);
            });
            reject(error);
        };

        output.on('error', fail);
        doc.on('error', fail);
        output.on('finish', () => {
            if (settled) return;
            settled = true;
            resolve({ filename, directory: REPORT_DIRECTORY });
        });

        doc.pipe(output);
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#9a3412').text('MANGO ROYAL');
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827').text(report.title);
        doc.font('Helvetica').fontSize(9).fillColor('#4b5563').text(`Generated ${report.generatedAt}`);
        doc.moveDown();

        for (const row of report.rows) {
            const line = row.join('  |  ');
            const height = doc.heightOfString(line, { width: doc.page.width - 84 }) + 8;
            if (doc.y + height > doc.page.height - 42) doc.addPage();
            doc.fontSize(10).fillColor('#111827').text(line, {
                width: doc.page.width - 84,
                paragraphGap: 4,
            });
            doc.moveDown(0.25);
        }
        doc.end();
    });
}

async function handleRequest(req, res) {
    if (req.method === 'GET' && req.url === '/health') {
        return sendJson(res, 200, { success: true, service: 'mango-royal-printer-server' });
    }
    if (req.method !== 'POST' || !['/print', '/reports/pdf'].includes(req.url)) {
        return sendJson(res, 404, { error: 'Printer-server route not found.' });
    }

    try {
        const body = await readJson(req);
        if (req.url === '/print') {
            const text = validatePrintText(body?.text);
            try {
                await runWindowsPrint(text);
            } catch (error) {
                error.status = 502;
                throw error;
            }
            return sendJson(res, 200, { success: true, message: 'Print job submitted to the Windows print queue.' });
        }

        const report = validateReport(body);
        let saved;
        try {
            saved = await createReportPdf(report);
        } catch (error) {
            error.status = 500;
            throw error;
        }
        return sendJson(res, 201, { success: true, ...saved });
    } catch (error) {
        const status = error.status || 400;
        if (status >= 500) console.error('[printer] request failed:', error);
        return sendJson(res, status, { error: error.message || 'Printer-server request failed.' });
    }
}

const server = http.createServer((req, res) => {
    const address = req.socket.remoteAddress;
    if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') {
        return sendJson(res, 403, { error: 'Printer server accepts local backend requests only.' });
    }
    void handleRequest(req, res);
});

server.listen(PORT, HOST, () => {
    console.log(`[printer] listening on http://${HOST}:${PORT}`);
    console.log(`[printer] report PDFs will be saved to ${REPORT_DIRECTORY}`);
});

server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.log(`[printer] another service is already listening on ${HOST}:${PORT}`);
        return;
    }
    console.error('[printer] failed to start:', error);
    process.exitCode = 1;
});
