// js/review.js
export function initReview({ onBack, onPlaceOrder, onEditItem }) {
    const screen = document.getElementById('review-screen');
    const itemsEl = screen.querySelector('#rev-items');
    const countEl = screen.querySelector('#rev-count');
    const subEl = screen.querySelector('#rev-subtotal');
    const totalEl = screen.querySelector('#rev-total');

    screen.querySelector('#rev-back').onclick = onBack;
    screen.querySelector('#rev-add-more').onclick = onBack;
    const placeOrderBtn = screen.querySelector('#rev-checkout');
    placeOrderBtn.onclick = async () => {
        placeOrderBtn.disabled = true;
        placeOrderBtn.innerText = 'Placing order…';
        try {
            await onPlaceOrder();
        } finally {
            placeOrderBtn.disabled = false;
            placeOrderBtn.innerText = 'Place Order →';
        }
    };

    const render = ({ items }) => {
        itemsEl.innerHTML = '';
        let subtotal = 0, count = 0;
        items.forEach((item, index) => {
            subtotal += item.price * item.quantity;
            count += item.quantity * (item.bundle_quantity || 1);
            const row = document.createElement('div');
            row.className = 'rev-row';
            row.innerHTML = `
                <div class="thumb"><img src="assets/img/${item.img}" alt=""></div>
                <div class="info">
                    <h4>${item.name}</h4>
                    <div class="meta">${item.bundle_quantity > 1 ? `${item.bundle_quantity} Tall cups per bundle × ${item.quantity} bundle${item.quantity === 1 ? '' : 's'} @ ₱${item.basePrice.toFixed(2)} / bundle` : `${item.size} × ${item.quantity} @ ₱${item.basePrice.toFixed(2)}`}${item.addOns?.length ? `<br>Add-ons: ${item.addOns.map(addon => `${addon.name}${addon.quantity > 1 ? ` ×${addon.quantity}` : ''} (+₱${(addon.price * addon.quantity).toFixed(2)})`).join(', ')}` : ''}</div>
                </div>
                <div class="price">₱${(item.price * item.quantity).toFixed(2)}</div>
                <button class="rev-edit" type="button" aria-label="Edit ${item.name}">Edit</button>`;
            row.querySelector('.rev-edit').onclick = () => onEditItem?.(item, index);
            itemsEl.appendChild(row);
        });
        countEl.innerText = count;
        subEl.innerText = `₱${subtotal.toFixed(2)}`;
        totalEl.innerText = `₱${subtotal.toFixed(2)}`;
    };

    return {
        show: (data) => { render(data); screen.classList.remove('hidden'); },
        hide: () => screen.classList.add('hidden'),
    };
}
