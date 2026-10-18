// js/payment.js
export function initPayment({ onBack, onConfirm }) {
    const screen = document.getElementById('payment-screen');
    const totalEl = screen.querySelector('#pay-total');
    const totalMini = screen.querySelector('#pay-total-mini');
    const confirmBtn = screen.querySelector('#pay-confirm');
    const backBtn = screen.querySelector('#pay-back');

    backBtn.onclick = onBack;
    confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.innerText = 'Placing order…';
        try {
            await onConfirm();
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.innerText = 'Place Order';
        }
    };

    return {
        show: ({ total }) => {
            totalEl.innerText = `₱${total.toFixed(2)}`;
            totalMini.innerText = `₱${total.toFixed(2)}`;
            screen.classList.remove('hidden');
        },
        hide: () => screen.classList.add('hidden'),
    };
}
