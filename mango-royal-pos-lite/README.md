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

1. Start the shared middleware (from `mango-royal-kiosk/mango-royal-backend/`):
   ```bash
   node server.js
   ```
   Serves on `http://localhost:3000`.

2. Serve this folder statically. Any static server works, e.g.:
   ```bash
   npx serve .
   ```
   or open `index.html` directly. If the API is not on `localhost:3000`, set
   `window.POS_API_BASE = 'http://your-host:port'` before `js/app.js` loads.

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

- Backend creates a `pos_order_meta` side table on startup (payment/discount/void reason). The existing kiosk schema is untouched.
- Kiosk `POST /api/orders` still works unchanged — those orders default to `status = 'PENDING'` and show up in this POS immediately.
- Frontend polls every 15 s; hit the refresh button (↻) for an immediate update.
