// js/splash.js
export function initSplash(onComplete) {
    const splashScreen = document.getElementById('splash-screen');
    const handler = () => {
        splashScreen.classList.add('fade-out');
        setTimeout(() => {
            splashScreen.classList.remove('fade-out');
            onComplete();
        }, 400);
    };
    // Attach once; it stays for the life of the app because we
    // just hide/show the same element.
    splashScreen.addEventListener('click', handler);
}

export function showSplash() {
    document.getElementById('splash-screen').classList.remove('hidden');
}
