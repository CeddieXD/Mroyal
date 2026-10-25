# Mango Royal

Mango Royal is a browser-based customer kiosk with staff apps for the POS, Kitchen,
and Admin dashboard. The staff apps share one Node/Express backend and use
role-specific sign-in.

## Requirements

- Git
- Windows 10/11 (the supplied launchers and receipt printing use Windows)
- Node.js (LTS) and npm
- MySQL 8.0 or later

## Setup after cloning

1. Clone the repository and open its folder in PowerShell:

   ```powershell
   git clone https://github.com/CeddieXD/Mroyal.git
   cd .\Mroyal
   ```

2. Install and start MySQL. Copy the backend environment template and edit it
   with the connection details for your MySQL server:

   ```powershell
   Copy-Item .\mango-royal-kiosk\mango-royal-backend\.env.example `
     .\mango-royal-kiosk\mango-royal-backend\.env
   ```

   Set `DB_HOST`, `DB_USER`, and `DB_PASS` in
   `mango-royal-kiosk\mango-royal-backend\.env`. The default schema name is
   `mangoroyalkiosk`; the MySQL account must be allowed to create it on first
   startup. If you want the Admin Royal Insights assistant, also set `AI_API`
   to your Groq API key.

3. Install the backend and printer-server dependencies:

   ```powershell
   Push-Location .\mango-royal-kiosk\mango-royal-backend
   npm install
   Pop-Location

   Push-Location .\mango-royal-printer-server
   npm install
   Copy-Item .\.env.example .\.env
   Pop-Location
   ```

   To print receipts, set `PRINTER_NAME` in
   `mango-royal-printer-server\.env` to the exact name of an installed Windows
   printer queue. Leave it blank to use the Windows default printer.

4. Start the backend, printer service, and database check:

   ```powershell
   .\Launchers\1_Run_Backend.bat
   ```

   On first startup, the database check creates and initializes
   `mangoroyalkiosk` from
   `mango-royal-kiosk\mango-royal-backend\database_reset.sql` if the schema
   does not already exist. Alternatively, you can run that SQL file yourself
   in MySQL Workbench before starting the backend. **The SQL file drops and
   recreates application tables; only run it on a new/empty development
   database, not on a database whose data you need to keep.**

5. Open a separate PowerShell terminal for each app and run its launcher:

   - Customer Kiosk: `.\Launchers\2_Run_Customer_Kiosk.bat`
   - POS: `.\Launchers\3_Run_Cashier_POS.bat`
   - Kitchen: `.\Launchers\4_Run_Kitchen_Display.bat`
   - Admin: `.\Launchers\5_Run_Admin_Dashboard.bat`

   Open the URLs printed by the launchers:

   - Customer Kiosk: `http://localhost:5000`
   - POS: `http://localhost:5001`
   - Kitchen: `http://localhost:5002`
   - Admin: `http://localhost:5003`

## Alternative startup options

If `Launchers\0_Backend_Runner.exe` is available in your copy, you can use it
instead of starting each launcher individually. Choose **Start All** to start
the printer service, database check, backend, and frontend apps in order. The
GUI runner uses ports `3000`, `3101`, and `5000`-`5003`. It may not be included
in a source-code clone; `Launchers\1_Run_Backend.bat` and the four app launchers
above are the standard setup.

When using the GUI runner, you can start or stop each service individually;
frontend apps stay blocked from starting until the backend health check
succeeds. The Runner also detects matching Mango Royal services already
listening on those ports, including tasks left by an earlier Runner or launcher,
and adopts them so its individual **Stop** buttons and **Stop All** can stop
them. Unrecognized processes occupying a service port are reported but are not
killed. App servers print only the IPv4 address selected by the computer's
active network route, not addresses from virtual adapters. They also advertise
Mango Royal locally as `mroyal.local` and as discoverable services for the
Android companion app. This requires the Windows firewall to allow Node.js on
private networks.

If your copy includes the Android companion project, build it with
`mango-royal-android-discovery\build-apk.bat`, then install
`Launchers\Mango_Royal_Connect.apk` on each Android device. Open it on the same
Wi-Fi or hotspot as the server, then tap an app to open it. It discovers the
server dynamically; if discovery remains on **Waiting for server**, enter the
LAN IPv4 address shown by the Runner under **Server address** and tap **Connect
by address**.
Devices still need local peer-to-peer connectivity. To show Android
connectivity in the Runner, start the backend from the Runner, enter the
six-digit pairing code shown there in Mango Royal Connect, and tap **Pair
device**. The Runner reports the phone as Connected while Mango Royal Connect
is open and heartbeats are arriving. After a backend restart, pair the phone
again with the new code. Pairing records are held in memory and reset when the
backend restarts.
Windows 10/11 devices can try `http://mroyal.local:5000` for the kiosk, `:5001`
for POS, `:5002` for Kitchen, or `:5003` for Admin. If the name doesn't resolve
on a particular network, use the companion app on Android or the LAN address
printed by the runner.

To start services manually instead of using the backend launcher, start the
printer server first:

```powershell
Push-Location .\mango-royal-printer-server
npm start
```

Then start the backend in another terminal:

```powershell
Push-Location .\mango-royal-kiosk\mango-royal-backend
npm start
```

The backend listens on port `3000` by default. `npm start` uses Node's watch
mode to restart the backend when its source files change. On Windows, launching
it again replaces the existing Mango Royal backend process on that port, so
the latest code and login routes are loaded without a manual task kill. An
unrelated process occupying the port is left untouched and reported as an error.
Generated Admin report PDFs are saved under
`mango-royal-printer-server\reports` by default; set `REPORT_PDF_DIR` in the
printer-server `.env` to change the destination. The printer server listens
only on the backend PC at `127.0.0.1:3101`.

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

Install and open `Launchers\Mango_Royal_Connect.apk` on Android, then choose the
app discovered on the same Wi-Fi or phone hotspot. Windows clients can use the
`mroyal.local` links from the runner output when multicast DNS is supported.
The frontend servers advertise only the IPv4 address selected for the active
network route, so virtual adapters are not offered to clients.

The hotspot or Wi-Fi must allow local device communication and multicast DNS.
Allow Node.js on Windows Firewall for **Private networks**. If the network
isolates hotspot clients, use a router that permits devices to communicate.

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
