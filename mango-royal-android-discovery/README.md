# Mango Royal Connect for Android

This Android companion discovers Mango Royal app servers on the current local
Wi-Fi network using DNS Service Discovery (mDNS/DNS-SD). It does not need
internet access or a configured router DNS name. It resolves the server address
automatically and opens the selected app in the browser.

## Build and install

1. Install Android Studio and the Android SDK Platform 36.
2. Open this folder in Android Studio and let Gradle sync.
3. Run the build script:

   ```powershell
   .\build-apk.bat
   ```

4. Install `..\Launchers\Mango_Royal_Connect.apk` on the Android phone or
   tablet. This debug APK is for trusted local devices and is not a Play Store
   release.

## Use

1. Start the Mango Royal services on the Windows server.
2. Connect the server and Android device to the same Wi-Fi or phone hotspot.
3. Open **Mango Royal Connect** and tap **Search again** if the apps do not
   appear immediately.
4. If the apps remain on **Waiting for server**, enter the Windows server's
   LAN IPv4 address (shown by the Runner, for example `192.168.0.188`) under
   **Server address** and tap **Connect by address**. The phone and server must
   be on the same Wi-Fi/hotspot, and the Node.js firewall rule must allow
   Private network access.
5. Tap an app to open it in the Android browser.
6. To show this phone's live connection in the Backend Runner, enter the
   six-digit code displayed by the Runner and tap **Pair device**. Keep Mango
   Royal Connect open; it sends a heartbeat every five seconds while active.
   Pair again after the backend restarts, because paired-device records are
   temporary and stored in backend memory.

Pairing only works when the backend was started by the Backend Runner, which
provides the temporary code to the backend. It is intended for a trusted local
network and is not internet-grade authentication.

The Windows server advertises `_http._tcp` services with names beginning
`Mango Royal -`. The companion checks the advertised addresses and uses one it
can reach, so multiple Windows network adapters do not require manual IP
selection. The server also advertises `mroyal.local` for Windows clients that
resolve multicast DNS hostnames.

Local discovery requires the Wi-Fi/hotspot to pass multicast DNS and allow
devices to connect to one another. Some phone hotspots isolate clients; if so,
use a Wi-Fi router or travel router that allows local device communication.
Allow Node.js through Windows Firewall on **Private networks** for app serving
and local discovery. Do not expose these app ports on public networks.
