# Mango Royal

Mango Royal is a browser-based customer kiosk with staff apps for the POS, Kitchen,
and Admin dashboard. The staff apps share one Node/Express backend and use
role-specific sign-in.

## Requirements

- Node.js (LTS) and npm
- MySQL, with the `mangoroyalkiosk` schema initialized from
  `mango-royal-kiosk/mango-royal-backend/database_reset.sql`

## First-time setup

1. In MySQL, create the schema and tables using the SQL file above.
2. Install the printer-server dependency:

   ```powershell
   cd .\mango-royal-printer-server
   npm install
   Copy-Item .\.env.example .\.env
   cd ..\mango-royal-kiosk\mango-royal-backend
   ```

3. Configure the backend from PowerShell:

   ```powershell
   Copy-Item .\.env.example .\.env
   ```

   Edit `.env` with your MySQL connection details and, if you want to use the
   Admin Royal Insights assistant, set `AI_API` to your Groq API key. Then install
   backend dependencies:

   ```powershell
   npm install
   ```

4. Start the printer service and backend. `Launchers\1_Run_Backend.bat`
   starts both services automatically. To start them manually, open a terminal
   from the repository root and start the printer service first:

   ```powershell
   cd .\mango-royal-printer-server
   npm start
   ```

   Then start the backend from its terminal:

   ```powershell
   cd .\mango-royal-kiosk\mango-royal-backend
   npm start
   ```

   The backend listens on port `3000` by default. `npm start` uses Node's watch
   mode to restart the backend when its source files change. On Windows, launching
   it again replaces the existing Mango Royal backend process on that port, so
   the latest code and login routes are loaded without a manual task kill. An
   unrelated process occupying the port is left untouched and reported as an error.
   Set `PRINTER_NAME` in `mango-royal-printer-server\.env` to select a Windows
   printer queue; if blank, Windows' default printer is used.
   Generated Admin report PDFs are saved under
   `mango-royal-printer-server\reports` by default; set `REPORT_PDF_DIR` to
   change the destination. The printer server listens only on the backend PC
   at `127.0.0.1:3101`.

5. Open three additional PowerShell terminals from the repository root and
   serve each staff app:

   ```powershell
   npx serve .\mango-royal-pos-lite -l 4173
   ```

   ```powershell
   npx serve .\mango-royal-kitchen-lite -l 4174
   ```

   ```powershell
   npx serve ".\Admin Dashboard Interface (2)" -l 4175
   ```

6. Open the printed URLs:

   - POS: `http://localhost:4173`
   - Kitchen: `http://localhost:4174`
   - Admin: `http://localhost:4175`

The three staff apps use the same hostname as the page, on backend port `3000`
by default. For a different backend host or port, set the corresponding
`window.POS_API_BASE`, `window.KITCHEN_API_BASE`, or `window.ADMIN_API_BASE`
before the app scripts load in that app's `index.html`.

## Development demo accounts

These shared demo accounts are for local development only:

| App | Username | Password |
| --- | --- | --- |
| Admin Dashboard | `admin` | `MangoAdmin2026!` |
| POS | `cashier` | `MangoCashier2026!` |
| Kitchen | `kitchen` | `MangoKitchen2026!` |

An account can sign in only to its matching app. A successful sign-in lasts up
to 8 hours, and each browser app has its own session.
Successful staff sign-ins and sign-outs, along with Admin Dashboard actions,
are stored in the backend `staff_activity_logs` table and shown in the Admin
Dashboard Activity Log. POS and Kitchen Display also show and sound an in-app
alert for their respective incoming-order events; each app has its own
persistent Mute/Unmute setting.

**Security warning:** the demo credentials are public in this README. Do not
expose this development setup to the public internet or use the demo accounts
for real business operations. Staff passwords can be overridden with
`STAFF_ADMIN_USERNAME`, `STAFF_ADMIN_PASSWORD`, `STAFF_CASHIER_USERNAME`,
`STAFF_CASHIER_PASSWORD`, `STAFF_KITCHEN_USERNAME`, and
`STAFF_KITCHEN_PASSWORD` in the backend `.env`. Use unique, strong passwords
and HTTPS before using the apps beyond a trusted local development network.
Changing these environment variables does not create persistent user accounts;
the Admin Users view is currently a session-only mock.

## Using the apps from a tablet on your LAN

Find the computer's LAN IP address, then open the matching staff URL on the
tablet, for example `http://192.168.1.20:4173`. The apps automatically target
the backend at the same hostname on port `3000`. Allow the frontend ports and
backend port through the computer's firewall as needed.

Plain HTTP is suitable only for a trusted local development network: credentials
and API traffic are not encrypted. For production or untrusted networks, serve
the frontends and backend through HTTPS using a certificate trusted by the
tablet. PWA installation/full-screen behavior also requires HTTPS (except
localhost); see [the kiosk setup guide](./mango-royal-kiosk/README.md).

## Notes

- Customer kiosk routes remain separate from staff login. POS, Kitchen, and
  Admin API routes require their matching staff role.
- Staff sessions are held in backend memory and are invalidated when the
  backend restarts.
- The backend image upload feature stores menu images in
  `mango-royal-kiosk/public/assets/img`.
- App-specific details: [POS](./mango-royal-pos-lite/README.md),
  [Kitchen](./mango-royal-kitchen-lite/README.md), and
  [Admin](./Admin%20Dashboard%20Interface%20(2)/README.md).
- Receipt print requests from the kiosk and POS are routed through the local
  printer server. POS verification automatically queues the acknowledgement
  receipt.
  Admin report PDFs are generated and saved on the server; CSV and JSON exports
  remain browser downloads.
