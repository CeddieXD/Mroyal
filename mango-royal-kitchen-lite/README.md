# Mango Royal Kitchen (lite)

Lightweight kitchen-staff UI, matching the `mango-royal-pos-lite` style (plain HTML/CSS/JS,
no build step). Drop-in sibling of the POS.

## Flow

The kitchen picks up where the cashier stops:

```
Kiosk/Walk-in → PENDING → [POS verify] → VERIFIED
                                          │
                                          ▼   (kitchen board)
                                       Incoming ──▶ Preparing ──▶ Served
```

Anything currently `VERIFIED`, `PREPARING`, or `SERVED` is on the kitchen board.
Incoming orders are shown oldest first, and only the oldest incoming order can be
started. Any preparing order can be marked served at any time. Served orders remain
visible until moved back to Preparing if a correction is needed.

## Run

See the repository [setup and staff sign-in guide](../README.md) for backend
configuration, all app URLs, LAN/tablet access, and development credentials.
Kitchen requires the `kitchen` account, and its browser session is separate
from POS and Admin.

For a standalone Kitchen run, start the backend (adds `/api/kitchen/*` routes):

   ```bash
   cd ../mango-royal-kiosk/mango-royal-backend
   node server.js
   ```

2. Serve this folder with any static server. Simplest:

   ```bash
   npx serve .
   ```

The frontend infers the backend host from the hostname used to open the app and
uses port `3000` by default. Override with `window.KITCHEN_API_BASE` before the
app script loads if the backend is hosted elsewhere.

## Backend endpoints (added)

- `GET  /api/kitchen/orders` — every order in the kitchen pipeline
- `POST /api/kitchen/orders/:id/status` `{ status: "PREPARING" | "SERVED" | "VERIFIED" }` —
  small state machine, invalid transitions return `409`
- `GET  /api/kitchen/events` — SSE (same events as the POS bus)

## Notes

- Live updates ride the same event bus as the POS, so a POS "Verify" instantly appears
  in the kitchen board (with a bell + ding when the tab isn't already on Incoming).
- No schema change required — `orders.status` is a `VARCHAR(32)` so `PREPARING` / `SERVED`
  just work.
