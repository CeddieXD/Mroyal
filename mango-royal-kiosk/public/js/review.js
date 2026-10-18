// js/review.js
export function initReview({ onBack, onProceed }) {
    const screen = document.getElementById('review-screen');
    const itemsEl = screen.querySelector('#rev-items');
    const countEl = screen.querySelector('#rev-count');
    const subEl = screen.querySelector('#rev-subtotal');
    const totalEl = screen.querySelector('#rev-total');
    const otEl = screen.querySelector('#rev-order-type');

    screen.querySelector('#rev-back').onclick = onBack;
    screen.querySelector('#rev-add-more').onclick = onBack;
    screen.querySelector('#rev-checkout').onclick = () => onProceed();

    const render = ({ items, orderType }) => {
        otEl.innerText = orderType;
        itemsEl.innerHTML = '';
        let subtotal = 0, count = 0;
        items.forEach(item => {
            subtotal += item.price * item.quantity;
            count += item.quantity;
            const row = document.createElement('div');
            row.className = 'rev-row';
            row.innerHTML = `
                <div class="thumb"><img src="assets/img/${item.img}" alt=""></div>
                <div class="info">
                    <h4>${item.name}</h4>
                    <div class="meta">${item.size} × ${item.quantity} @ ₱${item.price.toFixed(2)}</div>
                </div>
                <div class="price">₱${(item.price * item.quantity).toFixed(2)}</div>`;
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
