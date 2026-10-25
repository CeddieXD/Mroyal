package com.mangoroyal.discovery;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.IOException;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String SERVICE_TYPE = "_http._tcp.";
    private static final int NAVY = Color.rgb(20, 35, 57);
    private static final int ORANGE = Color.rgb(234, 88, 12);
    private static final int MUTED = Color.rgb(100, 116, 139);
    private static final String PREFERENCES = "mango_royal_local_pairing";
    private static final String DEVICE_ID = "device_id";
    private static final String DEVICE_TOKEN = "device_token";
    private static final String BACKEND_URL = "backend_url";

    private final Map<String, String> addresses = new HashMap<>();
    private final Set<String> resolving = new HashSet<>();
    private final Set<String> manuallyConnectedServices = new HashSet<>();
    private final ArrayDeque<NsdServiceInfo> pendingServices = new ArrayDeque<>();
    private String[] appNames;

    private NsdManager nsdManager;
    private NsdManager.DiscoveryListener discoveryListener;
    private WifiManager.MulticastLock multicastLock;
    private TextView statusText;
    private TextView pairingStatus;
    private EditText pairingCodeInput;
    private EditText serverAddressInput;
    private LinearLayout appList;
    private final android.os.Handler mainHandler = new android.os.Handler();
    private final Runnable heartbeatTask = this::sendHeartbeat;
    private boolean discoveryActive;
    private boolean discoveryStarting;
    private boolean discoveryStopRequested;
    private boolean restartAfterStop;
    private boolean activityResumed;
    private boolean resolutionInProgress;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        nsdManager = (NsdManager) getSystemService(Context.NSD_SERVICE);
        appNames = getResources().getStringArray(R.array.mango_apps);

        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(Color.rgb(245, 247, 250));
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(22), dp(28), dp(22), dp(28));
        scrollView.addView(page);

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextColor(NAVY);
        title.setTextSize(25);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        page.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText(R.string.local_connection);
        subtitle.setTextColor(ORANGE);
        subtitle.setTextSize(12);
        subtitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams subtitleParams = margins(0, 2, 0, 16);
        page.addView(subtitle, subtitleParams);

        TextView instructions = new TextView(this);
        instructions.setText(R.string.instructions);
        instructions.setTextColor(MUTED);
        instructions.setTextSize(15);
        page.addView(instructions, margins(0, 0, 0, 18));

        statusText = new TextView(this);
        statusText.setText(R.string.searching_server);
        statusText.setTextColor(NAVY);
        statusText.setTextSize(14);
        statusText.setPadding(dp(14), dp(12), dp(14), dp(12));
        statusText.setBackgroundColor(Color.WHITE);
        page.addView(statusText, margins(0, 0, 0, 10));

        Button scanButton = new Button(this);
        scanButton.setText(R.string.search_again);
        scanButton.setTextColor(Color.WHITE);
        scanButton.setBackgroundTintList(android.content.res.ColorStateList.valueOf(NAVY));
        scanButton.setOnClickListener(view -> restartDiscovery());
        page.addView(scanButton, margins(0, 0, 0, 18));

        serverAddressInput = new EditText(this);
        serverAddressInput.setSingleLine(true);
        serverAddressInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        serverAddressInput.setHint(R.string.manual_server_hint);
        page.addView(serverAddressInput, margins(0, 0, 0, 4));

        Button connectButton = new Button(this);
        connectButton.setText(R.string.connect_server);
        connectButton.setTextColor(Color.WHITE);
        connectButton.setBackgroundTintList(android.content.res.ColorStateList.valueOf(ORANGE));
        connectButton.setOnClickListener(view -> connectToServerAddress());
        page.addView(connectButton, margins(0, 0, 0, 18));

        TextView pairingTitle = new TextView(this);
        pairingTitle.setText(R.string.pairing_title);
        pairingTitle.setTextColor(NAVY);
        pairingTitle.setTextSize(18);
        pairingTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        page.addView(pairingTitle, margins(0, 0, 0, 4));

        TextView pairingInstructions = new TextView(this);
        pairingInstructions.setText(R.string.pairing_instructions);
        pairingInstructions.setTextColor(MUTED);
        pairingInstructions.setTextSize(14);
        page.addView(pairingInstructions, margins(0, 0, 0, 8));

        pairingCodeInput = new EditText(this);
        pairingCodeInput.setSingleLine(true);
        pairingCodeInput.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        pairingCodeInput.setHint(R.string.pairing_code_hint);
        pairingCodeInput.setFilters(new android.text.InputFilter[] {
            new android.text.InputFilter.LengthFilter(6)
        });
        page.addView(pairingCodeInput, margins(0, 0, 0, 4));

        Button pairButton = new Button(this);
        pairButton.setText(R.string.pair_device);
        pairButton.setTextColor(Color.WHITE);
        pairButton.setBackgroundTintList(android.content.res.ColorStateList.valueOf(ORANGE));
        pairButton.setOnClickListener(view -> pairDevice());
        page.addView(pairButton, margins(0, 0, 0, 4));

        pairingStatus = new TextView(this);
        pairingStatus.setText(R.string.pairing_waiting);
        pairingStatus.setTextColor(MUTED);
        pairingStatus.setTextSize(13);
        page.addView(pairingStatus, margins(0, 0, 0, 18));

        appList = new LinearLayout(this);
        appList.setOrientation(LinearLayout.VERTICAL);
        page.addView(appList);
        renderApps();
        setContentView(scrollView);
    }

    @Override
    protected void onResume() {
        super.onResume();
        activityResumed = true;
        restoreLastKnownServer();
        startDiscovery();
        scheduleHeartbeat(1000);
    }

    @Override
    protected void onPause() {
        activityResumed = false;
        restartAfterStop = false;
        mainHandler.removeCallbacks(heartbeatTask);
        stopDiscovery();
        super.onPause();
    }

    private void startDiscovery() {
        if (nsdManager == null) return;
        if (discoveryStopRequested && activityResumed) restartAfterStop = true;
        if (discoveryActive || discoveryStarting) return;
        if (discoveryListener != null) {
            restartAfterStop = activityResumed;
            return;
        }
        WifiManager wifiManager = (WifiManager) getApplicationContext()
            .getSystemService(Context.WIFI_SERVICE);
        if (wifiManager != null) {
            multicastLock = wifiManager.createMulticastLock("MangoRoyalDiscovery");
            multicastLock.setReferenceCounted(false);
            multicastLock.acquire();
        }

        NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {
                discoveryStarting = false;
                discoveryActive = true;
                runOnUiThread(() -> statusText.setText(R.string.searching_services));
                if (discoveryStopRequested) stopDiscovery();
            }

            @Override
            public void onServiceFound(NsdServiceInfo service) {
                String serviceName = service.getServiceName();
                if (serviceName == null || !serviceName.startsWith(getString(R.string.service_name_prefix))) return;
                if (resolving.add(serviceName)) pendingServices.addLast(service);
                resolveNextService();
            }

            @Override
            public void onServiceLost(NsdServiceInfo service) {
                String name = service.getServiceName();
                runOnUiThread(() -> {
                    if (!manuallyConnectedServices.contains(name)) addresses.remove(name);
                    resolving.remove(name);
                    for (java.util.Iterator<NsdServiceInfo> iterator = pendingServices.iterator(); iterator.hasNext();) {
                        if (name.equals(iterator.next().getServiceName())) iterator.remove();
                    }
                    renderApps();
                    updateStatus();
                });
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
                if (discoveryListener != this) return;
                discoveryActive = false;
                discoveryStarting = false;
                discoveryStopRequested = false;
                discoveryListener = null;
                releaseMulticastLock();
                if (restartAfterStop && activityResumed) {
                    restartAfterStop = false;
                    startDiscovery();
                }
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                if (discoveryListener != this) return;
                discoveryActive = false;
                discoveryStarting = false;
                discoveryStopRequested = false;
                discoveryListener = null;
                releaseMulticastLock();
                runOnUiThread(() -> statusText.setText(
                    getString(R.string.discovery_start_failed, errorCode)));
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                if (discoveryListener != this) return;
                discoveryStopRequested = false;
                restartAfterStop = false;
                runOnUiThread(() -> statusText.setText(
                    getString(R.string.discovery_stop_failed, errorCode)));
            }
        };

        discoveryListener = listener;
        discoveryStarting = true;
        try {
            nsdManager.discoverServices(
                SERVICE_TYPE,
                NsdManager.PROTOCOL_DNS_SD,
                listener);
        } catch (RuntimeException error) {
            discoveryListener = null;
            discoveryStarting = false;
            releaseMulticastLock();
            statusText.setText(getString(R.string.discovery_failed, error.getMessage()));
        }
    }

    private void resolveNextService() {
        if (resolutionInProgress || pendingServices.isEmpty() || nsdManager == null) return;
        NsdServiceInfo service = pendingServices.removeFirst();
        resolutionInProgress = true;
        try {
            nsdManager.resolveService(service, new NsdManager.ResolveListener() {
                @Override
                public void onResolveFailed(NsdServiceInfo failedService, int errorCode) {
                    resolving.remove(failedService.getServiceName());
                    resolutionInProgress = false;
                    if (addresses.isEmpty()) {
                        runOnUiThread(() -> statusText.setText(
                            getString(R.string.resolve_failed, errorCode)));
                    }
                    resolveNextService();
                }

                @Override
                public void onServiceResolved(NsdServiceInfo resolvedService) {
                    resolutionInProgress = false;
                    List<InetAddress> candidates = getHostAddresses(resolvedService);
                    new Thread(() -> findReachableAddress(resolvedService, candidates)).start();
                    resolveNextService();
                }
            });
        } catch (RuntimeException error) {
            resolving.remove(service.getServiceName());
            resolutionInProgress = false;
            if (addresses.isEmpty()) {
                runOnUiThread(() -> statusText.setText(
                    getString(R.string.address_lookup_failed, error.getMessage())));
            }
            resolveNextService();
        }
    }

    private List<InetAddress> getHostAddresses(NsdServiceInfo service) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return service.getHostAddresses();
        }
        InetAddress host = service.getHost();
        return host == null ? Collections.<InetAddress>emptyList() : Collections.singletonList(host);
    }

    private void findReachableAddress(NsdServiceInfo service, List<InetAddress> candidates) {
        for (InetAddress candidate : new ArrayList<>(candidates)) {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(candidate, service.getPort()), 800);
                String address = candidate.getHostAddress();
                String urlHost = address != null && address.contains(":")
                    ? "[" + address + "]"
                    : address;
                String url = "http://" + urlHost + ":" + service.getPort();
                runOnUiThread(() -> {
                    manuallyConnectedServices.remove(service.getServiceName());
                    addresses.put(service.getServiceName(), url);
                    renderApps();
                    updateStatus();
                    scheduleHeartbeat(0);
                });
                return;
            } catch (IOException ignored) {
                // Try the next advertised interface; Windows may have virtual adapters.
            }
        }
        synchronized (resolving) {
            resolving.remove(service.getServiceName());
        }
        runOnUiThread(() -> statusText.setText(R.string.server_unreachable));
    }

    private void restartDiscovery() {
        addresses.clear();
        resolving.clear();
        pendingServices.clear();
        resolutionInProgress = false;
        renderApps();
        if (discoveryListener != null) {
            restartAfterStop = true;
            stopDiscovery();
        } else {
            startDiscovery();
        }
    }

    private void stopDiscovery() {
        if (discoveryListener != null && (discoveryActive || discoveryStarting)) {
            discoveryStopRequested = true;
            if (discoveryStarting) return;
            try {
                nsdManager.stopServiceDiscovery(discoveryListener);
            } catch (RuntimeException error) {
                if (statusText != null) {
                    statusText.setText(getString(R.string.discovery_stop_error, error.getMessage()));
                }
                discoveryStopRequested = false;
            }
        }
    }

    private void releaseMulticastLock() {
        if (multicastLock != null && multicastLock.isHeld()) {
            multicastLock.release();
        }
        multicastLock = null;
    }

    private void updateStatus() {
        int online = 0;
        for (String appName : appNames) {
            if (addresses.containsKey(getString(R.string.service_name_prefix) + appName)) online++;
        }
        if (online == 0) {
            statusText.setText(R.string.server_not_found);
        } else {
            statusText.setText(getResources().getQuantityString(R.plurals.apps_found, online, online));
        }
    }

    private void connectToServerAddress() {
        String input = serverAddressInput.getText().toString().trim();
        Uri serverUri = parseServerAddress(input);
        if (serverUri == null) {
            serverAddressInput.setError(getString(R.string.manual_server_invalid));
            return;
        }

        addresses.clear();
        manuallyConnectedServices.clear();
        renderApps();
        statusText.setText(R.string.connecting_server);
        probeServerHost(serverUri.getHost(), serverUri.getScheme());
    }

    private void restoreLastKnownServer() {
        if (!addresses.isEmpty()) return;
        String backendUrl = getSharedPreferences(PREFERENCES, MODE_PRIVATE)
            .getString(BACKEND_URL, null);
        Uri serverUri = parseServerAddress(backendUrl);
        if (serverUri == null) return;
        if (serverAddressInput != null && serverAddressInput.getText().length() == 0) {
            serverAddressInput.setText(serverUri.getHost());
        }
        probeServerHost(serverUri.getHost(), serverUri.getScheme());
    }

    private Uri parseServerAddress(String input) {
        if (input == null || input.trim().isEmpty()) return null;
        String address = input.trim();
        if (!address.contains("://")) address = "http://" + address;
        Uri uri = Uri.parse(address);
        String scheme = uri.getScheme();
        if (uri.getHost() == null || !("http".equalsIgnoreCase(scheme)
            || "https".equalsIgnoreCase(scheme))) return null;
        return uri;
    }

    private void probeServerHost(String host, String scheme) {
        new Thread(() -> {
            boolean foundService = false;
            InetAddress[] candidates;
            try {
                candidates = InetAddress.getAllByName(host);
            } catch (IOException error) {
                runOnUiThread(() -> statusText.setText(R.string.manual_server_error));
                return;
            }

            for (int index = 0; index < appNames.length; index++) {
                int port = 5000 + index;
                for (InetAddress candidate : candidates) {
                    try (Socket socket = new Socket()) {
                        socket.connect(new InetSocketAddress(candidate, port), 1000);
                        String address = candidate.getHostAddress();
                        String urlHost = address != null && address.contains(":")
                            ? "[" + address + "]"
                            : address;
                        String serviceName = getString(R.string.service_name_prefix) + appNames[index];
                        String url = scheme + "://" + urlHost + ":" + port;
                        runOnUiThread(() -> {
                            addresses.put(serviceName, url);
                            manuallyConnectedServices.add(serviceName);
                            renderApps();
                            updateStatus();
                        });
                        foundService = true;
                        break;
                    } catch (IOException ignored) {
                        // Continue checking the other app ports and resolved addresses.
                    }
                }
            }

            if (!foundService) {
                runOnUiThread(() -> statusText.setText(R.string.manual_server_error));
            }
        }, "MangoRoyalAddressCheck").start();
    }

    private void pairDevice() {
        String code = pairingCodeInput.getText().toString().trim();
        if (!code.matches("\\d{6}")) {
            pairingCodeInput.setError(getString(R.string.pairing_code_hint));
            return;
        }

        String backendUrl = getCurrentBackendUrl();
        if (backendUrl == null) {
            pairingStatus.setText(R.string.pairing_waiting);
            return;
        }

        pairingStatus.setText(R.string.pairing_in_progress);
        new Thread(() -> {
            try {
                SharedPreferences preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE);
                String deviceId = preferences.getString(DEVICE_ID, null);
                if (deviceId == null) {
                    deviceId = UUID.randomUUID().toString();
                    preferences.edit().putString(DEVICE_ID, deviceId).apply();
                }

                String deviceName = "Android " + Build.MODEL;
                if (deviceName.length() > 60) deviceName = deviceName.substring(0, 60);
                JSONObject body = new JSONObject();
                body.put("code", code);
                body.put("deviceId", deviceId);
                body.put("name", deviceName);
                HttpResult result = postJson(backendUrl + "/api/local-devices/pair", body, null);
                if (result.statusCode < 200 || result.statusCode >= 300) {
                    throw new IOException(errorMessage(result.body, "Server rejected pairing (HTTP "
                        + result.statusCode + ")."));
                }

                String token = new JSONObject(result.body).getString("token");
                preferences.edit()
                    .putString(DEVICE_TOKEN, token)
                    .putString(BACKEND_URL, backendUrl)
                    .apply();
                runOnUiThread(() -> {
                    pairingCodeInput.setText("");
                    pairingStatus.setText(R.string.pairing_success);
                    pairingStatus.setTextColor(Color.rgb(22, 163, 74));
                    scheduleHeartbeat(0);
                });
            } catch (Exception error) {
                String message = error.getMessage() == null ? "Check the server connection and retry." : error.getMessage();
                runOnUiThread(() -> {
                    pairingStatus.setText(getString(R.string.pairing_error, message));
                    pairingStatus.setTextColor(Color.rgb(220, 38, 38));
                });
            }
        }, "MangoRoyalPairing").start();
    }

    private void scheduleHeartbeat(long delayMs) {
        if (!activityResumed || getSharedPreferences(PREFERENCES, MODE_PRIVATE)
            .getString(DEVICE_TOKEN, null) == null) return;
        mainHandler.removeCallbacks(heartbeatTask);
        mainHandler.postDelayed(heartbeatTask, delayMs);
    }

    private void sendHeartbeat() {
        if (!activityResumed) return;
        SharedPreferences preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE);
        String token = preferences.getString(DEVICE_TOKEN, null);
        if (token == null) return;
        String backendUrl = getCurrentBackendUrl();
        if (backendUrl == null) backendUrl = preferences.getString(BACKEND_URL, null);
        if (backendUrl == null) {
            setPairingStatus(R.string.device_reconnecting);
            scheduleHeartbeat(5000);
            return;
        }

        final String heartbeatUrl = backendUrl;
        new Thread(() -> {
            boolean paired = false;
            boolean needsPairing = false;
            try {
                HttpResult result = postJson(
                    heartbeatUrl + "/api/local-devices/heartbeat",
                    new JSONObject(),
                    token);
                paired = result.statusCode >= 200 && result.statusCode < 300;
                needsPairing = result.statusCode == 401;
                if (paired) {
                    preferences.edit().putString(BACKEND_URL, heartbeatUrl).apply();
                } else if (!needsPairing) {
                    throw new IOException(errorMessage(result.body,
                        "Heartbeat failed (HTTP " + result.statusCode + ")."));
                }
            } catch (Exception ignored) {
                // Transient network loss should retry with the same paired token.
            }

            if (needsPairing) {
                preferences.edit().remove(DEVICE_TOKEN).remove(BACKEND_URL).apply();
                setPairingStatus(R.string.device_repair_required);
            } else if (paired) {
                setPairingStatus(R.string.device_connected);
            } else {
                setPairingStatus(R.string.device_reconnecting);
            }
            scheduleHeartbeat(5000);
        }, "MangoRoyalHeartbeat").start();
    }

    private void setPairingStatus(int textResource) {
        runOnUiThread(() -> {
            pairingStatus.setText(textResource);
            pairingStatus.setTextColor(textResource == R.string.device_connected
                ? Color.rgb(22, 163, 74)
                : MUTED);
        });
    }

    private String getCurrentBackendUrl() {
        if (addresses.isEmpty()) return null;
        String appUrl = addresses.values().iterator().next();
        Uri uri = Uri.parse(appUrl);
        String host = uri.getHost();
        if (host == null) return null;
        String authority = host.contains(":") ? "[" + host + "]:3000" : host + ":3000";
        return uri.buildUpon().encodedAuthority(authority).path("").clearQuery().fragment(null)
            .build().toString();
    }

    private HttpResult postJson(String endpoint, JSONObject body, String token) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(4000);
        connection.setReadTimeout(4000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
        try {
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(payload);
            }
            int statusCode = connection.getResponseCode();
            java.io.InputStream input = statusCode >= 400
                ? connection.getErrorStream()
                : connection.getInputStream();
            String responseBody = "";
            if (input != null) {
                try (java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(input, StandardCharsets.UTF_8))) {
                    StringBuilder content = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) content.append(line);
                    responseBody = content.toString();
                }
            }
            return new HttpResult(statusCode, responseBody);
        } finally {
            connection.disconnect();
        }
    }

    private String errorMessage(String responseBody, String fallback) {
        try {
            return new JSONObject(responseBody).optString("error", fallback);
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static final class HttpResult {
        final int statusCode;
        final String body;

        HttpResult(int statusCode, String body) {
            this.statusCode = statusCode;
            this.body = body;
        }
    }

    private void renderApps() {
        if (appList == null) return;
        appList.removeAllViews();
        for (String appName : appNames) {
            String url = addresses.get(getString(R.string.service_name_prefix) + appName);
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(16), dp(14), dp(16), dp(14));
            card.setBackgroundColor(Color.WHITE);

            TextView name = new TextView(this);
            name.setText(appName);
            name.setTextColor(NAVY);
            name.setTextSize(17);
            name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            card.addView(name);

            TextView endpoint = new TextView(this);
            endpoint.setText(url == null ? getString(R.string.waiting_for_server) : url);
            endpoint.setTextColor(MUTED);
            endpoint.setTextSize(12);
            card.addView(endpoint, margins(0, 3, 0, 8));

            Button open = new Button(this);
            open.setText(url == null ? getString(R.string.waiting_for_server) : getString(R.string.open_app, appName));
            open.setEnabled(url != null);
            open.setOnClickListener(view -> {
                if (url == null) return;
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(intent);
            });
            card.addView(open);
            appList.addView(card, margins(0, 0, 0, 12));
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private LinearLayout.LayoutParams margins(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }
}
