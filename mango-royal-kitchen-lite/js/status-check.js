// tools/status-check.js
// Shared health check utility for Mango Royal frontends
(function() {
    const API_BASE = window.API_BASE || window.POS_API_BASE || window.KITCHEN_API_BASE || window.ADMIN_API_BASE
        || `${window.location.protocol}//${window.location.hostname}:3000`;
    let overlay = null;
    let checking = false;
    let lockedElements = [];

    function createOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'backend-offline-banner';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'backend-offline-title');
        overlay.setAttribute('aria-describedby', 'backend-offline-message');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(15, 23, 42, 0.88);
            backdrop-filter: blur(6px);
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            transition: opacity 0.3s ease;
        `;
        overlay.innerHTML = `
            <div style="background: white; color: #0f172a; padding: 32px 36px; border-radius: 16px; max-width: 440px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.3); border: 2px solid #ea580c;">
                <div style="font-size: 48px; margin-bottom: 12px; line-height: 1;">⚠️</div>
                <h2 id="backend-offline-title" style="font-size: 20px; font-weight: 800; color: #ea580c; margin-bottom: 8px;">Connection Lost</h2>
                <p id="backend-offline-message" style="font-size: 14px; color: #475569; margin-bottom: 20px; line-height: 1.5;">
                    The system is locked while the server reconnects. Your current screen is being kept; reconnecting will not restart the app.
                </p>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button id="retry-backend-btn" style="background: #ea580c; color: white; border: none; padding: 10px 20px; font-weight: 700; border-radius: 8px; cursor: pointer; font-size: 13px;">
                        Reconnect
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        lockedElements = Array.from(document.body.children)
            .filter(element => element !== overlay)
            .map(element => {
                const wasInert = element.inert;
                element.inert = true;
                return { element, wasInert };
            });
        const retryButton = overlay.querySelector('#retry-backend-btn');
        retryButton.addEventListener('click', checkStatus);
        retryButton.focus();
        return overlay;
    }

    function unlockPage() {
        for (const item of lockedElements) item.element.inert = item.wasInert;
        lockedElements = [];
    }

    async function checkStatus() {
        if (checking) return;
        checking = true;
        const retryButton = overlay && overlay.querySelector('#retry-backend-btn');
        if (retryButton) {
            retryButton.disabled = true;
            retryButton.textContent = 'Reconnecting...';
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        try {
            const res = await fetch(`${API_BASE}/api/health`, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal
            });
            if (res.ok) {
                if (overlay) {
                    overlay.remove();
                    overlay = null;
                    unlockPage();
                }
            } else {
                createOverlay();
            }
        } catch (err) {
            createOverlay();
        } finally {
            clearTimeout(timeoutId);
            checking = false;
            if (overlay) {
                const button = overlay.querySelector('#retry-backend-btn');
                if (button) {
                    button.disabled = false;
                    button.textContent = 'Reconnect';
                }
            }
        }
    }

    // Check on startup and periodically every 5 seconds
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            checkStatus();
            setInterval(checkStatus, 5000);
        });
    } else {
        checkStatus();
        setInterval(checkStatus, 5000);
    }
})();
