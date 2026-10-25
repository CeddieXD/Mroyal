# Mango Royal POS (Lite)

Lightweight vanilla-HTML/CSS/JS staff POS. Shares the existing kiosk middleware — new orders placed at the kiosk appear here automatically in the **Incoming** tab.

## Architecture

```
mango-royal-kiosk/
├─ public/                     ← kiosk (customer) frontend
└─ mango-royal-backend/        ← Node/Express + MySQL (shared middleware)
   ├─ server.js                ← mounts /api/pos
   ├─ config/db.js
   └─ pos/pos.routes.js        ← NEW — POS endpoints

mango-royal-pos-lite/          ← THIS project (staff POS frontend)
├─ index.html
├─ css/pos.css
└─ js/{app,api,modals}.js
```

## Running

Follow the repository [setup and staff sign-in guide](../README.md) to configure
the shared backend, start all staff apps, and use the development credentials.
The POS requires the `cashier` account. Sign in again after restarting the
backend; each staff app has its own browser session.

For a standalone POS run, start the shared middleware (from
`mango-royal-kiosk/mango-royal-backend/`):
   ```bash
   node server.js
   ```
   Serves on `http://localhost:3000`.

2. Serve this folder with a static server. Any static server works, e.g.:
   ```bash
   npx serve .
   ```
   If the API is not on the same hostname at port `3000`, set
   `window.POS_API_BASE = 'http://your-host:port'` before the app loads. By
   default, the backend host is inferred from the hostname used to open the POS.

## POS endpoints (all under `/api/pos`)

| Method | Path                        | Purpose                          |
|--------|-----------------------------|----------------------------------|
| GET    | /orders?status=PENDING      | List orders (PENDING/VERIFIED/VOIDED) |
| GET    | /menu                       | Full product + variant list      |
| POST   | /orders/:id/verify          | Confirm payment (+ optional PWD/Senior discount) |
| POST   | /orders/:id/void            | Void with reason                 |
| POST   | /orders/:id/reopen          | Verified → back to Incoming      |
| PATCH  | /orders/:id                 | Replace items                    |
| POST   | /orders/walkin              | Create walk-in order             |

## Notes

- Backend creates or upgrades a `pos_order_meta` side table on startup (payment, discount, discount ID details, and void reason). The existing kiosk schema is untouched.
- Payment verification separates the amount due from the discount, captures the PWD ID number or Senior citizen name and birthdate, and calculates remaining balance/change. Discount ID details are stored with POS order metadata and are not included in the normal order-list response.
- Walk-in and incoming-order editors combine identical product, size, and add-on selections, and allow staff to adjust up to 10 add-ons per item using the kiosk's current add-on prices.
- PWD and Senior payment discounts apply automatically to one serving from the first item in the order. The POS uses an 8% VAT calculation for that discounted portion only, applies the 20% discount to its VAT-exclusive value, and stores the eligible portion, VAT exemption, discount, and received payment for Admin transaction details.
- Admin settings can enable the POS End-of-Day Receipt button. Each print creates a stored daily summary record with sales, discounts, VAT exemption, payment methods, top items, cashier, and print status.
- PWD ID validation uses the requested `RR-PPMM-BBB-NNNNNNN` format, and the Senior discount requires a birthdate confirming the holder is at least 60 years old.
- Hold a pending order card to enter multi-select mode; select up to 10 pending orders to print their receipts or void them one at a time with an order-specific reason.
- Kiosk `POST /api/orders` still works unchanged — those orders default to `status = 'PENDING'` and show up in this POS immediately.
- Frontend polls every 15 s; hit the refresh button (↻) for an immediate update.
