# Mango Royal Printer Server

This local Windows service sends kiosk and POS receipt jobs to the PC's Windows
print queue and saves Admin report PDFs on the server. The kiosk and staff
browser devices do not print directly.

## Setup

From this folder, install dependencies once and run the service:

```powershell
npm install
Copy-Item .\.env.example .\.env
npm start
```

Set `PRINTER_NAME` in `.env` to the exact installed Windows printer queue
name, or leave it blank to use the Windows default printer.

The backend launcher starts the printer server automatically. If you run the
backend with `npm start`, start this service in a separate terminal first.

The service binds only to `127.0.0.1:3101`; it is intended for the backend
running on the same PC. Configure `PRINTER_NAME` in the service `.env` to use a
specific installed Windows printer queue. If unset, the Windows default printer
is used. Physical receipt printing requires Windows and a working printer
driver.

The kiosk acknowledgement is a compact, centered 80 mm ticket with a large,
bold order number, cashier instruction, and thank-you. It does not include
order items, prices, or totals. POS acknowledgement receipts list quantities,
items, and prices, show add-ons as separate priced rows, align totals in the
price column, and center the receipt heading. Bundle items use a compact label.
Receipts emphasize the total and state that they are not sales invoices and are
intended for academic purposes only.

## Admin report PDFs

Generated PDFs are saved in this folder's `reports` directory by default. Set
`REPORT_PDF_DIR` in the service `.env` to use another destination.
The authenticated Admin API reports the full saved path after successful
generation. The Admin Sales Report page can also send the selected interval's
summary, product performance, payment breakdown, and insights to the browser
print dialog directly from its styled preview. Choose the installed printer in
the browser's print dialog.

The service exposes a local health check at `http://127.0.0.1:3101/health`.
