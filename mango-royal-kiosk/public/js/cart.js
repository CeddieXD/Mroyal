// js/cart.js — persistent sidebar cart

export function initCart({ onCheckout } = {}) {
    const MAX_ORDER_QUANTITY = 20;
    const itemsList = document.getElementById('cart-items-list');
    const subtotalEl = document.getElementById('subtotal');
    const totalEl = document.getElementById('total-price');
    const countEl = document.getElementById('cart-count');
    const checkoutBtn = document.getElementById('checkout-btn');

    // Each entry includes the per-unit price with toppings and the topping selection.
    let cartItems = [];
    let onBulkOrderAttempt = () => {};

    const keyOf = (product_id, size, addOns) =>
        `${product_id}::${size}::${addOns.map(addon => `${addon.name}:${addon.quantity}`).join('|')}`;
    const getItemCount = () => cartItems.reduce(
        (sum, item) => sum + item.quantity * (item.bundle_quantity || 1), 0
    );
    const formatAddons = (addOns) => addOns
        .map(addon => `${addon.name}${addon.quantity > 1 ? ` ×${addon.quantity}` : ''}`)
        .join(', ');

    const render = () => {
        const count = getItemCount();
        if (cartItems.length === 0) {
            itemsList.innerHTML = `
                <div class="cart-empty">
                    <div class="cart-empty-icon" aria-hidden="true">🥤</div>
                    <p>Your cup is empty</p>
                    <small>Tap a shake to add it here</small>
                </div>`;
        } else {
            itemsList.innerHTML = '';
            cartItems.forEach(item => {
                const el = document.createElement('div');
                el.className = 'cart-item';
                el.innerHTML = `
                    <div class="thumb"><img src="assets/img/${item.img}" alt=""></div>
                    <div class="item-info">
                        <h4>${item.name}</h4>
                        <div class="item-meta">${item.bundle_quantity > 1 ? `${item.bundle_quantity} Tall cups/bundle · ${item.quantity} bundle${item.quantity === 1 ? '' : 's'}` : `${item.size} · Qty ${item.quantity}`}${item.addOns.length ? ` · ${formatAddons(item.addOns)}` : ''}</div>
                        <span class="price">₱${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                    `;
                itemsList.appendChild(el);
            });
        }

        const subtotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
        subtotalEl.innerText = `₱${subtotal.toFixed(2)}`;
        totalEl.innerText = `₱${subtotal.toFixed(2)}`;
        countEl.innerText = `${count} cup${count === 1 ? '' : 's'}`;
        checkoutBtn.disabled = count === 0;
    };

    const addItem = ({ product_id, name, img, size, variant_id, basePrice, price, addOns = [], quantity, bundle_quantity = 1 }) => {
        const availableQuantity = Math.floor((MAX_ORDER_QUANTITY - getItemCount()) / bundle_quantity);
        if (availableQuantity <= 0) {
            onBulkOrderAttempt();
            return;
        }
        const acceptedQuantity = Math.min(quantity, availableQuantity);
        const k = keyOf(product_id, size, addOns);
        const existing = cartItems.find(i => i.key === k);
        if (existing) {
            existing.quantity += acceptedQuantity;
        } else {
            cartItems.push({ key: k, product_id, name, img, size, variant_id, basePrice, price, addOns, quantity: acceptedQuantity, bundle_quantity });
        }
        if (acceptedQuantity < quantity) {
            onBulkOrderAttempt();
        }
        render();
        // Little pulse on cart to signal add
        document.getElementById('cart-sidebar').animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }],
            { duration: 250 }
        );
    };

    const updateItem = (index, item) => {
        if (!cartItems[index]) return;
        const quantityWithoutItem = getItemCount() -
            cartItems[index].quantity * (cartItems[index].bundle_quantity || 1);
        if (quantityWithoutItem + item.quantity * (item.bundle_quantity || 1) > MAX_ORDER_QUANTITY) {
            onBulkOrderAttempt();
            return;
        }
        cartItems[index] = {
            ...cartItems[index],
            ...item,
            key: keyOf(item.product_id, item.size, item.addOns),
        };
        render();
    };

    checkoutBtn.onclick = () => {
        if (cartItems.length === 0) return;
        onCheckout?.(getSnapshot());
    };

    const getSnapshot = () => cartItems.map(i => ({ ...i }));
    const clear = () => { cartItems = []; render(); };

    render();

    return {
        addItem,
        updateItem,
        clear,
        getSnapshot,
        render,
        setBulkOrderPrompt: callback => { onBulkOrderAttempt = callback; },
    };
}
