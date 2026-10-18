# Mango Royal Kitchen (lite)

Lightweight kitchen-staff UI, matching the `mango-royal-pos-lite` style (plain HTML/CSS/JS,
no build step). Drop-in sibling of the POS.

## Flow

The kitchen picks up where the cashier stops:

```
Kiosk/Walk-in → PENDING → [POS verify] → VERIFIED
                                          │
                                          ▼   (kitchen board)
                                       Incoming ──▶ Preparing ──▶ Ready
```

Anything currently `VERIFIED`, `PREPARING`, or `READY` is on the kitchen board.
`Ready` orders stay visible until they leave the pipeline (mark them back to `Preparing`
if a mistake was made, or a future "Served/Complete" step will retire them).

## Run

1. Start the backend (adds `/api/kitchen/*` routes):

   ```bash
   cd ../mango-royal-kiosk/mango-royal-backend
   node server.js
   ```

2. Open `index.html` — any static server works. Simplest:

   ```bash
   npx serve .
   ```

The frontend talks to `http://localhost:3000` by default. Override by setting
`window.KITCHEN_API_BASE` before `js/app.js` loads.

## Backend endpoints (added)

- `GET  /api/kitchen/orders` — every order in the kitchen pipeline
- `POST /api/kitchen/orders/:id/status` `{ status: "PREPARING" | "READY" | "VERIFIED" }` —
  small state machine, invalid transitions return `409`
- `GET  /api/kitchen/events` — SSE (same events as the POS bus)

## Notes

- Live updates ride the same event bus as the POS, so a POS "Verify" instantly appears
  in the kitchen board (with a bell + ding when the tab isn't already on Incoming).
- No schema change required — `orders.status` is a `VARCHAR(32)` so `PREPARING` / `READY`
  just work.
