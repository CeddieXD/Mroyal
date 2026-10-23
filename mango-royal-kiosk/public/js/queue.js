// js/queue.js
export function initQueue({ onDone }) {
    const screen = document.getElementById('queue-screen');
    const numEl = screen.querySelector('#queue-number');
    const cdEl = screen.querySelector('#q-countdown');
    const countdown = screen.querySelector('#q-countdown-wrap');
    const status = screen.querySelector('#q-print-status');
    const digitalPrint = screen.querySelector('#q-digital');
    const digitalNumber = screen.querySelector('#q-digital-number');
    const doneBtn = screen.querySelector('#q-done');
    const printBtn = screen.querySelector('#q-print');
    let lastOrderData = null;
    let timer = null;
    let printInProgress = false;

    const stop = () => {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    };

    function startCountdown() {
        stop();
        let seconds = 15;
        countdown.classList.remove('hidden');
        cdEl.textContent = seconds;
        timer = setInterval(() => {
            seconds--;
            cdEl.textContent = seconds;
            if (seconds <= 0) {
                stop();
                onDone();
            }
        }, 1000);
    }

    function showDigitalPrint(receipt) {
        digitalNumber.textContent = receipt?.queueNumber || numEl.textContent;
        digitalPrint.classList.remove('hidden');
        screen.classList.add('has-digital-print');
    }

    async function sendPrint() {
        if (printInProgress) return;
        const { orderId, printToken, acknowledgement } = lastOrderData || {};
        stop();
        countdown.classList.add('hidden');
        printBtn.disabled = true;
        printBtn.classList.add('hidden');
        doneBtn.disabled = true;
        status.textContent = 'Sending your order ticket to the printer...';

        try {
            if (!orderId || !printToken) {
                throw new Error('The order print permission is unavailable.');
            }
            printInProgress = true;
            const response = await fetch(`${window.API_BASE || window.location.origin}/api/kiosk/orders/${orderId}/acknowledgement-print`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ printToken }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = result.details
                    ? `${result.error || 'Print failed'}: ${result.details}`
                    : result.error || `HTTP ${response.status}`;
                throw new Error(message);
            }
            digitalPrint.classList.add('hidden');
            screen.classList.remove('has-digital-print');
            status.textContent = 'Your order ticket was sent to the printer.';
            startCountdown();
        } catch (error) {
            console.error('Kiosk order ticket could not be printed:', error);
            showDigitalPrint(acknowledgement);
            status.textContent = `Printer unavailable (${error.message}). Keep this screen open and show the digital ticket to the cashier.`;
            printBtn.classList.remove('hidden');
        } finally {
            printInProgress = false;
            printBtn.disabled = false;
            doneBtn.disabled = false;
        }
    }

    doneBtn.onclick = () => {
        stop();
        onDone();
    };
    printBtn.onclick = () => { void sendPrint(); };

    return {
        show: ({ queueNumber, orderId, printToken, acknowledgement }) => {
            lastOrderData = { orderId, printToken, acknowledgement };
            numEl.textContent = queueNumber || '—';
            digitalPrint.classList.add('hidden');
            screen.classList.remove('has-digital-print');
            printBtn.classList.add('hidden');
            countdown.classList.add('hidden');
            doneBtn.disabled = false;
            status.textContent = 'Sending your order ticket to the printer...';
            screen.classList.remove('hidden');
            void sendPrint();
        },
        hide: () => {
            stop();
            screen.classList.add('hidden');
        },
    };
}
