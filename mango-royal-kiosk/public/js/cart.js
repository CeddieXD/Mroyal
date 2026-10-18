// js/cart.js — persistent sidebar cart

export function initCart({ onCheckout } = {}) {
    const itemsList = document.getElementById('cart-items-list');
    const subtotalEl = document.getElementById('subtotal');
    const totalEl = document.getElementById('total-price');
    const countEl = document.getElementById('cart-count');
    const checkoutBtn = document.getElementById('checkout-btn');

    // Each entry: { key, product_id, name, img, size, variant_id, price, quantity }
    let cartItems = [];

    const keyOf = (product_id, size) => `${product_id}::${size}`;

    const render = () => {
        if (cartItems.length === 0) {
            itemsList.innerHTML = `
                <div class="cart-empty">
                    <div class="cart-empty-icon">🥭</div>
                    <p>Your cart is empty</p>
                    <small>Tap a shake to add it here</small>
                </div>`;
        } else {
            itemsList.innerHTML = '';
            cartItems.forEach((item, index) => {
                const el = document.createElement('div');
                el.className = 'cart-item';
                el.innerHTML = `
                    <div class="thumb"><img src="assets/img/${item.img}" alt=""></div>
                    <div class="item-info">
                        <h4>${item.name}</h4>
                        <div class="item-meta">${item.size}</div>
                        <span class="price">₱${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                    <div class="quantity-controls">
                        <button class="minus" aria-label="decrease">−</button>
                        <span class="qty-number">${item.quantity}</span>
                        <button class="plus" aria-label="increase">+</button>
                    </div>`;
                el.querySelector('.minus').onclick = () => updateQty(index, -1);
                el.querySelector('.plus').onclick = () => updateQty(index, 1);
                itemsList.appendChild(el);
            });
        }

        const subtotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
        const count = cartItems.reduce((s, i) => s + i.quantity, 0);
        subtotalEl.innerText = `₱${subtotal.toFixed(2)}`;
        totalEl.innerText = `₱${subtotal.toFixed(2)}`;
        countEl.innerText = `${count} item${count === 1 ? '' : 's'}`;
        checkoutBtn.disabled = count === 0;
    };

    const updateQty = (index, delta) => {
        cartItems[index].quantity += delta;
        if (cartItems[index].quantity <= 0) cartItems.splice(index, 1);
        render();
    };

    const addItem = ({ product_id, name, img, size, variant_id, price, quantity }) => {
        const k = keyOf(product_id, size);
        const existing = cartItems.find(i => i.key === k);
        if (existing) {
            existing.quantity += quantity;
        } else {
            cartItems.push({ key: k, product_id, name, img, size, variant_id, price, quantity });
        }
        render();
        // Little pulse on cart to signal add
        document.getElementById('cart-sidebar').animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }],
            { duration: 250 }
        );
    };

    checkoutBtn.onclick = () => {
        if (cartItems.length === 0) return;
        onCheckout?.(getSnapshot());
    };

    const getSnapshot = () => cartItems.map(i => ({ ...i }));
    const clear = () => { cartItems = []; render(); };

    render();

    return { addItem, clear, getSnapshot, render };
}
