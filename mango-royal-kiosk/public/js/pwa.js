if ('serviceWorker' in navigator) {
    if (window.isSecureContext) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .catch((error) => console.error('Failed to register the kiosk service worker:', error));
        });
    } else {
        console.info('Installable PWA features require HTTPS; localhost is also supported for development.');
    }
}
