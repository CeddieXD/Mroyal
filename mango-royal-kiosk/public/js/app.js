// js/app.js — kiosk flow orchestrator
import { loadComponent } from './loader.js';
import { preloadIntroFrames } from './utils.js';
import { initSplash, showSplash } from './splash.js';
import { playIntro } from './intro.js';
import { initMainMenu } from './mainMenu.js';
import { initProductDetail } from './productDetail.js';
import { initCart } from './cart.js';
import { initReview } from './review.js';
import { initPayment } from './payment.js';
import { initQueue } from './queue.js';

const API_BASE = window.API_BASE || window.location.origin;
const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const IDLE_WARNING_SECONDS = 10;
const INTRO_INTERVAL_MS = 8 * 1000;  // On splash, play intro every 8s

const screenIds = [
    'splash-screen', 'intro', 'main-menu',
    'product-detail', 'review-screen', 'payment-screen', 'queue-screen', 'idle-timeout-modal'
];

const hideAll = () => screenIds.forEach(id => document.getElementById(id).classList.add('hidden'));

// Block pinch-zoom, ctrl+scroll zoom, and ctrl/+/- zoom on kiosk
window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault();
});
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// Scale-to-fit with adaptive design target.
// Two targets: 1024x768 (4:3) and 1280x800 (16:10). Pick whichever matches
// the viewport aspect better, so both native devices render without letterbox.
const TARGETS = [
    { w: 1024, h: 768, cls: 'aspect-4-3' },
    { w: 1280, h: 800, cls: 'aspect-16-10' },
];
function fitKiosk() {
    const va = window.innerWidth / window.innerHeight;
    const best = TARGETS.reduce((a, b) =>
        Math.abs(a.w/a.h - va) < Math.abs(b.w/b.h - va) ? a : b
    );
    const frame = document.querySelector('.kiosk-frame');
    if (!frame) return;
    frame.style.width  = best.w + 'px';
    frame.style.height = best.h + 'px';
    TARGETS.forEach(t => frame.classList.remove(t.cls));
    frame.classList.add(best.cls);
    const scale = Math.min(window.innerWidth / best.w, window.innerHeight / best.h);
    document.documentElement.style.setProperty('--kiosk-scale', scale);
}
window.addEventListener('resize', fitKiosk);
fitKiosk();

document.addEventListener('DOMContentLoaded', async () => {

    preloadIntroFrames(37);

    await Promise.all([
        loadComponent('splash-screen', 'components/splash.html'),
        loadComponent('intro', 'components/intro.html'),
        loadComponent('main-menu', 'components/mainMenu.html'),
        loadComponent('product-detail', 'components/productDetail.html'),
        loadComponent('review-screen', 'components/review.html'),
        loadComponent('payment-screen', 'components/payment.html'),
        loadComponent('queue-screen', 'components/queue.html'),
    ]);

    // ---- Session state ----
    let sessionId = null;
    let attractIntroTimer = null;
    let idleTimer = null;
    let idleWarningInterval = null;
    let idleWarningScreens = [];
    let idleWarningActive = false;

    const clearAttractLoop = () => {
        if (attractIntroTimer) { clearTimeout(attractIntroTimer); attractIntroTimer = null; }
    };

    // ---- Screen show helpers ----
    const goAttract = ({ scheduleIntro = true } = {}) => {
        clearIdleTimer();
        clearIdleWarning();
        clearAttractLoop();
        detail.reset();
        cart.clear();
        sessionId = null;
        hideAll();
        showSplash();
        if (scheduleIntro) scheduleAttractIntro();
    };

    const goMenu = async () => {
        clearAttractLoop();
        hideAll();
        menu.show();
        startIdleTimer();
        if (!sessionId) {
            try {
                const r = await fetch(`${API_BASE}/api/sessions`, { method: 'POST' });
                const j = await r.json();
                sessionId = j.session_id || null;
            } catch (e) { /* non-fatal */ }
        }
    };

    const goReview = () => {
        hideAll();
        review.show({ items: cart.getSnapshot(), orderType: 'Take Out' });
        startIdleTimer();
    };

    const goPayment = () => {
        const total = cart.getSnapshot().reduce((s, i) => s + i.price * i.quantity, 0);
        hideAll();
        payment.show({ total });
        startIdleTimer();
    };

    const goQueue = (queueNumber) => {
        hideAll();
        queue.show({ queueNumber });
        // Idle timer paused during queue screen — its own countdown returns to attract
        clearIdleTimer();
    };

    // ---- Attract loop: splash, and periodically play intro animation ----
    const scheduleAttractIntro = () => {
        clearAttractLoop();
        attractIntroTimer = setTimeout(() => {
            // Only play intro if still on splash
            const splash = document.getElementById('splash-screen');
            if (splash.classList.contains('hidden')) return;
            hideAll();
            playIntro(() => {
                showSplash();
                scheduleAttractIntro();
            });
        }, INTRO_INTERVAL_MS);
    };

    const clearIdleTimer = () => {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    };
    const clearIdleWarning = () => {
        if (idleWarningInterval) {
            clearInterval(idleWarningInterval);
            idleWarningInterval = null;
        }
        idleWarningActive = false;
        idleWarningScreens = [];
        document.getElementById('idle-timeout-modal').classList.add('hidden');
    };
    const resumeFromIdleWarning = () => {
        if (!idleWarningActive) return;
        const screensToRestore = idleWarningScreens;
        clearIdleWarning();
        screensToRestore.forEach(id => document.getElementById(id).classList.remove('hidden'));
        startIdleTimer();
    };
    const showIdleWarning = () => {
        idleTimer = null;
        idleWarningScreens = screenIds
            .filter(id => id !== 'idle-timeout-modal' && !document.getElementById(id).classList.contains('hidden'));
        hideAll();
        idleWarningActive = true;

        let secondsRemaining = IDLE_WARNING_SECONDS;
        const countdown = document.getElementById('idle-countdown');
        const progress = document.getElementById('idle-countdown-progress');
        const modal = document.getElementById('idle-timeout-modal');
        countdown.textContent = String(secondsRemaining);
        progress.style.width = '100%';
        modal.classList.remove('hidden');

        idleWarningInterval = setInterval(() => {
            secondsRemaining -= 1;
            countdown.textContent = String(secondsRemaining);
            progress.style.width = `${secondsRemaining / IDLE_WARNING_SECONDS * 100}%`;
            if (secondsRemaining <= 0) goAttract({ scheduleIntro: false });
        }, 1000);
    };
    // ---- Idle timeout ----
    const startIdleTimer = () => {
        clearIdleTimer();
        idleTimer = setTimeout(showIdleWarning, IDLE_TIMEOUT_MS);
    };
    ['click', 'pointerdown', 'pointermove', 'mousemove', 'touchstart', 'keydown'].forEach(evt => {
        document.addEventListener(evt, () => {
            if (idleWarningActive) {
                resumeFromIdleWarning();
            } else if (idleTimer) {
                startIdleTimer();
            }
        }, { passive: true });
    });

    // ---- Order submission ----
    const submitOrder = async () => {
        const items = cart.getSnapshot();
        const payload = {
            session_id: sessionId,
            order_type: 'Take-out',
            items: items.map(i => ({
                variant_id: i.variant_id,
                quantity: i.quantity,
                price: i.basePrice,
                add_ons: i.addOns.map(({ name, quantity }) => ({ name, quantity })),
            })),
        };
        try {
            const r = await fetch(`${API_BASE}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const responseBody = await r.text();
            let j;
            try {
                j = JSON.parse(responseBody);
            } catch {
                throw new Error(`Order API returned an invalid response (${r.status}).`);
            }
            if (!r.ok) {
                throw new Error(j.details ? `${j.error}: ${j.details}` : j.error || `Server error (${r.status})`);
            }
            const qn = j.queue_number || ('A' + String(j.order_id || 0).padStart(3, '0').slice(-3));
            cart.clear();
            sessionId = null;
            goQueue(qn);
        } catch (err) {
            console.error(err);
            alert('Sorry, order could not be placed. Please try again or see the counter.');
        }
    };

    // ---- Wire components ----
    initSplash(() => goMenu());

    const detail = initProductDetail({
        onAddToCart: (item) => cart.addItem(item),
    });

    const menu = initMainMenu({
        onProductClick: (imgEl, product) => detail.morphForward(imgEl, product),
        onStartAgain: () => goAttract(),
    });

    const cart = initCart({
        onCheckout: () => goReview(),
    });

    const review = initReview({
        onBack: () => goMenu(),
        onProceed: () => goPayment(),
        onEditItem: (item, index) => {
            const product = menu.getProduct(item.product_id);
            if (!product) {
                console.error(`Cannot edit cart item: product ${item.product_id} is not available in the menu.`);
                alert('Sorry, this item could not be loaded for editing. Please see the counter.');
                return;
            }
            hideAll();
            detail.editItem(product, item, index, {
                onSave: (updatedItem, itemIndex) => {
                    cart.updateItem(itemIndex, updatedItem);
                    goReview();
                },
                onCancel: goReview,
            });
        },
    });

    const payment = initPayment({
        onBack: () => goReview(),
        onConfirm: submitOrder,
    });

    const queue = initQueue({
        onDone: () => goAttract({ scheduleIntro: false }),
    });

    const bulkOrderModal = document.getElementById('bulk-order-modal');
    document.getElementById('bulk-order-dismiss').onclick = () => bulkOrderModal.classList.add('hidden');
    const showBulkOrderPrompt = () => bulkOrderModal.classList.remove('hidden');
    detail.setBulkOrderPrompt(showBulkOrderPrompt);
    cart.setBulkOrderPrompt(showBulkOrderPrompt);

    // ---- Start ----
    goAttract();
});
