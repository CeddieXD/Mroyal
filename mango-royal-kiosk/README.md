# Mango Royal Customer Kiosk

The kiosk is served from the root of the static site by `Launchers\2_Run_Customer_Kiosk.bat` on port 5000. It includes a web app manifest and a service worker so supported browsers can install it and open it without the normal browser address bar.

## Install on a tablet

1. Configure the static server to use a certificate trusted by the tablet. The certificate must be valid for the server's LAN IP (and `localhost` if using the PC's auto-opened browser).
2. Start the backend and kiosk launcher. From PowerShell, for example:

   ```powershell
   $env:HTTPS_CERT_FILE = "C:\path\to\server.crt"
   $env:HTTPS_KEY_FILE = "C:\path\to\server.key"
   .\Launchers\2_Run_Customer_Kiosk.bat
   ```

3. Open `https://<server-address>:5000/` in the tablet browser and wait for the page to load.
4. In Chrome, choose **Install app** or **Add to Home screen**, then launch the installed Mango Royal app.

The manifest requests fullscreen display, with standalone as a fallback. Browser and operating-system support determine whether the status/navigation area is also hidden.

### Local network IP addresses

The app can be opened at the server's LAN IP and port, for example `https://192.168.1.20:5000/`. The IP itself does not prevent PWA use, and the root URL is covered by the manifest and service-worker scope. However, browsers only allow service workers and PWA installation from secure origins: a plain `http://192.168.1.20:5000/` is not secure. The static server accepts a certificate/key through `HTTPS_CERT_FILE` and `HTTPS_KEY_FILE`; the certificate must be trusted by the tablet. A self-signed certificate that the tablet does not trust is not sufficient. `localhost` is the exception for development on the same device.

The kiosk server proxies `/api` requests to the backend on port 3000 by default, so HTTPS pages do not make blocked HTTP API calls. The backend must be running on the same PC; set `BACKEND_HOST` or `BACKEND_PORT` if it is elsewhere.

## Inactivity reset

After 15 seconds without interaction during an order, the kiosk replaces the current screen with a 10-second countdown prompt. Touching the screen resumes the order; if the countdown reaches zero, the cart is cleared and the kiosk returns to the start screen.

## Order item audit history

The backend stores an append-only item audit trail in `order_item_audit_logs`. It records item creation, POS item additions/edits/removals, and each POS or kitchen status transition, along with the item snapshot, before/after values, source, staff actor when available, and timestamp. Audit writes share the order mutation transaction so a failed change cannot be saved without its corresponding log. The admin dashboard exposes each item's history from the history icon in the expanded transaction details.

The backend creates the audit table automatically for existing installations and records a baseline for current order items it has not seen before. Activity from before audit logging was deployed cannot be reconstructed.
