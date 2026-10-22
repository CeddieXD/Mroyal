// js/productDetail.js
export function initProductDetail({ onAddToCart } = {}) {
    const MAX_SHAKE_QUANTITY = 20;
    const MAX_ADDON_QUANTITY = 10;
    const productDetail = document.getElementById('product-detail');
    const detailImg = document.getElementById('detail-img');
    const qtyVal = document.getElementById('qty-val');
    const sizeBtns = productDetail.querySelectorAll('.size-btn');
    const addonChoices = productDetail.querySelectorAll('.addon-choice');
    const priceDisplay = productDetail.querySelector('.detail-price');
    const addBtn = productDetail.querySelector('.add-to-cart-big');
    const nextBtn = productDetail.querySelector('#next-to-addons');
    const shakeStep = productDetail.querySelector('#shake-step');
    const addonsStep = productDetail.querySelector('#addons-step');
    const headingQty = productDetail.querySelector('.detail-heading-qty');

    const stepTitle   = productDetail.querySelector('#detail-step-title');
    const detailDesc  = productDetail.querySelector('#detail-desc');
    const API_BASE = window.API_BASE || window.location.origin;

    let lastClickedImg = null;
    let currentProduct = null;
    let editingIndex = null;
    let onSaveEdit = null;
    let onCancelEdit = null;
    let onBulkOrderAttempt = () => {};

    const getSelectedSize = () => {
        const active = productDetail.querySelector('.size-btn.active');
        return active ? active.innerText : 'Tall';
    };

    const selectedAddons = () => Array.from(addonChoices)
        .map(choice => ({
            name: choice.dataset.addonName,
            price: Number(choice.dataset.price),
            quantity: Number(choice.querySelector('[data-addon-quantity]').textContent),
        }))
        .filter(addon => addon.quantity > 0);

    const loadAddonPrices = async () => {
        const response = await fetch(`${API_BASE}/api/add-ons`);
        if (!response.ok) throw new Error(`Add-on price request failed with status ${response.status}`);
        const addons = await response.json();
        if (!Array.isArray(addons)) throw new Error('Add-on price response is invalid.');

        const pricesByName = new Map(addons.map(addon => [addon.name, Number(addon.price)]));
        addonChoices.forEach(choice => {
            const price = pricesByName.get(choice.dataset.addonName);
            if (price === undefined || !Number.isFinite(price)) {
                throw new Error(`Missing database price for add-on "${choice.dataset.addonName}".`);
            }
            choice.dataset.price = String(price);
            choice.querySelector('strong').textContent = `₱${price}`;
        });
        updateTotalPrice(Number(qtyVal.textContent));
    };

    const updateAddonControls = () => {
        const addonCount = selectedAddons().reduce((sum, addon) => sum + addon.quantity, 0);
        addonChoices.forEach(choice => {
            const quantityEl = choice.querySelector('[data-addon-quantity]');
            const quantity = Number(quantityEl.textContent);
            choice.querySelector('[data-addon-delta="-1"]').disabled = quantity === 0;
            choice.querySelector('[data-addon-delta="1"]').disabled =
                quantity >= MAX_ADDON_QUANTITY || addonCount >= MAX_ADDON_QUANTITY;
        });
    };

    const updateTotalPrice = (qty) => {
        const basePrice = parseFloat(priceDisplay.getAttribute('data-base-price'));
        const addonTotal = selectedAddons().reduce((sum, addon) => sum + addon.price * addon.quantity, 0);
        const total = (basePrice + addonTotal) * qty;
        priceDisplay.innerText = `₱${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        productDetail.querySelector('#qty-minus').disabled = qty <= 1;
        const quantityLimit = Math.floor(MAX_SHAKE_QUANTITY / (currentProduct?.bundle_quantity || 1));
        productDetail.querySelector('#qty-plus').disabled = qty >= quantityLimit;
        updateAddonControls();
    };

    loadAddonPrices().catch(error => {
        console.error('Unable to load add-on prices from the database:', error);
    });

    const resetToDefaults = (product) => {
        currentProduct = product;
        qtyVal.innerText = "1";
        shakeStep.classList.remove('hidden');
        addonsStep.classList.add('hidden');
        const isBundle = product.bundle_quantity > 1;
        headingQty.classList.toggle('hidden', !isBundle);
        headingQty.querySelector('span').textContent = isBundle ? 'BUNDLES' : 'QTY';
        sizeBtns.forEach((btn, index) => {
            btn.classList.toggle('hidden', isBundle && index > 0);
            btn.classList.toggle('active', index === 0);
        });
        addonChoices.forEach(choice => choice.classList.toggle('hidden', isBundle));
        productDetail.querySelector('.size-selector').classList.toggle('is-single-size', isBundle);
        nextBtn.classList.toggle('hidden', isBundle);
        addBtn.classList.toggle('hidden', !isBundle);
        addBtn.textContent = isBundle ? 'Add Bundle to Cart' : 'Add to Cart';
        const initialPrice = product.prices['tall'];
        priceDisplay.setAttribute('data-base-price', initialPrice);
        addonChoices.forEach(choice => {
            choice.querySelector('[data-addon-quantity]').textContent = '0';
        });
        updateTotalPrice(1);

        productDetail.querySelector('.size-selector').classList.remove('is-grande');
    };

    productDetail.querySelector('#qty-plus').onclick = () => {
        let current = parseInt(qtyVal.innerText);
        const quantityLimit = Math.floor(MAX_SHAKE_QUANTITY / (currentProduct?.bundle_quantity || 1));
        if (current >= quantityLimit) {
            onBulkOrderAttempt();
            return;
        }
        current = Math.min(quantityLimit, current + 1);
        qtyVal.innerText = current;
        updateTotalPrice(current);
    };

    productDetail.querySelector('#qty-minus').onclick = () => {
        let current = parseInt(qtyVal.innerText);
        if (current > 1) {
            current--;
            qtyVal.innerText = current;
            updateTotalPrice(current);
        }
    };

    sizeBtns.forEach(btn => {
        btn.onclick = () => {
            sizeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            productDetail.querySelector('.size-selector').classList.toggle('is-grande', btn === sizeBtns[1]);
            const selectedSize = btn.innerText.toLowerCase();
            const newBasePrice = currentProduct.prices[selectedSize];
            priceDisplay.setAttribute('data-base-price', newBasePrice);
            updateTotalPrice(parseInt(qtyVal.innerText));
        };
    });
    addonChoices.forEach(choice => {
        choice.querySelectorAll('[data-addon-delta]').forEach(button => {
            button.onclick = () => {
                const quantityEl = choice.querySelector('[data-addon-quantity]');
                const quantity = Number(quantityEl.textContent);
                const totalSelected = selectedAddons().reduce((sum, addon) => sum + addon.quantity, 0);
                const nextQuantity = quantity + Number(button.dataset.addonDelta);
                if (nextQuantity < 0 || nextQuantity > MAX_ADDON_QUANTITY ||
                    (nextQuantity > quantity && totalSelected >= MAX_ADDON_QUANTITY)) return;
                quantityEl.textContent = String(nextQuantity);
                updateTotalPrice(parseInt(qtyVal.innerText, 10));
            };
        });
    });

    nextBtn.onclick = () => {
        shakeStep.classList.add('hidden');
        addonsStep.classList.remove('hidden');
        headingQty.classList.remove('hidden');
        headingQty.querySelector('span').textContent = 'QTY';
        nextBtn.classList.add('hidden');
        addBtn.classList.remove('hidden');
        stepTitle.textContent = 'Add-ons & Toppings';
    };
    productDetail.querySelector('#addons-back').onclick = () => {
        addonsStep.classList.add('hidden');
        shakeStep.classList.remove('hidden');
        headingQty.classList.toggle('hidden', currentProduct?.bundle_quantity <= 1);
        headingQty.querySelector('span').textContent =
            currentProduct?.bundle_quantity > 1 ? 'BUNDLES' : 'QTY';
        addBtn.classList.add('hidden');
        nextBtn.classList.remove('hidden');
        stepTitle.textContent = 'Customize Your Shake';
    };

    addBtn.onclick = () => {
        if (!currentProduct) return;
        const size = getSelectedSize();
        const sizeKey = size.toLowerCase();
        const qty = parseInt(qtyVal.innerText, 10);
        const item = {
            product_id: currentProduct.id,
            name: currentProduct.name,
            img: currentProduct.img,
            size,
            variant_id: currentProduct.variant_ids[sizeKey],
            basePrice: currentProduct.prices[sizeKey],
            price: currentProduct.prices[sizeKey] + selectedAddons().reduce((sum, addon) => sum + addon.price * addon.quantity, 0),
            addOns: selectedAddons(),
            quantity: qty,
            bundle_quantity: currentProduct.bundle_quantity || 1,
        };
        if (editingIndex !== null) {
            const save = onSaveEdit;
            const index = editingIndex;
            reset();
            save?.(item, index);
        } else {
            onAddToCart?.(item);
            morphBackward();
        }
    };

    const setProductDetails = (product) => {
        productDetail.querySelector('#detail-name').textContent = product.name;
        detailDesc.textContent = [
            product.desc,
            product.ingredients && `Ingredients: ${product.ingredients}`,
        ].filter(Boolean).join('\n\n');
        stepTitle.textContent = 'Customize Your Shake';
        resetToDefaults(product);
    };

    const editItem = (product, item, index, { onSave, onCancel } = {}) => {
        reset();
        editingIndex = index;
        onSaveEdit = onSave;
        onCancelEdit = onCancel;
        setProductDetails(product);
        addBtn.textContent = 'Save Changes';
        detailImg.src = `assets/img/${product.img}`;

        const sizeKey = item.size.toLowerCase();
        sizeBtns.forEach(btn => {
            const isSelected = btn.textContent.trim().toLowerCase() === sizeKey;
            btn.classList.toggle('active', isSelected);
        });
        productDetail.querySelector('.size-selector').classList.toggle('is-grande', sizeKey === 'grande');
        priceDisplay.setAttribute('data-base-price', product.prices[sizeKey]);
        qtyVal.textContent = String(item.quantity);
        addonChoices.forEach(choice => {
            const selected = item.addOns.find(addon => addon.name === choice.dataset.addonName);
            choice.querySelector('[data-addon-quantity]').textContent = String(selected?.quantity || 0);
        });
        updateTotalPrice(item.quantity);
        productDetail.classList.remove('hidden');
    };

    const morphForward = (startImg, product) => {
        editingIndex = null;
        onSaveEdit = null;
        onCancelEdit = null;
        addBtn.textContent = 'Add to Cart';
        lastClickedImg = startImg;
        const startRect = startImg.getBoundingClientRect();

        const animElements = ['.detail-header', '.img-circle-bg', '#detail-name', '.detail-options', '.detail-footer'];
        animElements.forEach(sel => {
            const el = productDetail.querySelector(sel);
            if (el) {
                el.style.opacity = "0";
                el.style.transform = sel === '.img-circle-bg' ? "scale(0.8)" : "translateY(20px)";
            }
        });

        setProductDetails(product);

        detailImg.src = startImg.src;

        productDetail.classList.remove('hidden');
        detailImg.style.visibility = 'hidden';
        const endRect = detailImg.getBoundingClientRect();

        const ghost = document.createElement('img');
        ghost.src = startImg.src;
        ghost.className = 'morph-ghost';
        Object.assign(ghost.style, {
            top: `${startRect.top}px`,
            left: `${startRect.left}px`,
            width: `${startRect.width}px`,
            height: `${startRect.height}px`
        });
        document.body.appendChild(ghost);
        startImg.style.visibility = 'hidden';

        requestAnimationFrame(() => {
            Object.assign(ghost.style, {
                top: `${endRect.top}px`,
                left: `${endRect.left}px`,
                width: `${endRect.width}px`,
                height: `${endRect.height}px`,
                transform: 'scale(1.1)'
            });

            setTimeout(() => {
                animElements.forEach(sel => {
                    const el = productDetail.querySelector(sel);
                    if (el) {
                        el.style.opacity = "1";
                        el.style.transform = sel === '.img-circle-bg' ? "scale(1)" : "translateY(0)";
                    }
                });
            }, 50);
        });

        setTimeout(() => {
            detailImg.style.visibility = 'visible';
            ghost.remove();
        }, 600);
    };

    const morphBackward = () => {
        if (!lastClickedImg) {
            productDetail.classList.add('hidden');
            return;
        }

        const startRect = detailImg.getBoundingClientRect();
        const endRect = lastClickedImg.getBoundingClientRect();

        const ghost = document.createElement('img');
        ghost.src = detailImg.src;
        ghost.className = 'morph-ghost';
        Object.assign(ghost.style, {
            top: `${startRect.top}px`,
            left: `${startRect.left}px`,
            width: `${startRect.width}px`,
            height: `${startRect.height}px`,
            transform: 'scale(1.1)'
        });
        document.body.appendChild(ghost);

        detailImg.style.visibility = 'hidden';
        productDetail.style.pointerEvents = 'none';

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                productDetail.classList.add('hidden');
                productDetail.querySelector('.detail-content').style.opacity = '0';

                Object.assign(ghost.style, {
                    top: `${endRect.top}px`,
                    left: `${endRect.left}px`,
                    width: `${endRect.width}px`,
                    height: `${endRect.height}px`,
                    transform: 'scale(1)'
                });
            });
        });

        setTimeout(() => {
            lastClickedImg.style.visibility = 'visible';
            ghost.style.opacity = '0';
            setTimeout(() => {
                ghost.remove();
                detailImg.style.visibility = 'visible';
                productDetail.querySelector('.detail-content').style.opacity = '1';
                productDetail.style.pointerEvents = 'auto';
            }, 100);
        }, 600);
    };

    const reset = () => {
        if (lastClickedImg) lastClickedImg.style.visibility = 'visible';
        document.querySelectorAll('.morph-ghost').forEach(ghost => ghost.remove());
        productDetail.classList.add('hidden');
        productDetail.style.pointerEvents = 'auto';
        detailImg.style.visibility = 'visible';
        const content = productDetail.querySelector('.detail-content');
        if (content) content.style.opacity = '1';
        ['.detail-header', '.img-circle-bg', '#detail-name', '.detail-options', '.detail-footer'].forEach(selector => {
            const element = productDetail.querySelector(selector);
            if (!element) return;
            element.style.opacity = '';
            element.style.transform = '';
        });
        lastClickedImg = null;
        currentProduct = null;
        editingIndex = null;
        onSaveEdit = null;
        onCancelEdit = null;
        addBtn.textContent = 'Add to Cart';
    };

    const closeDetail = () => {
        if (editingIndex !== null) {
            const cancel = onCancelEdit;
            reset();
            cancel?.();
            return;
        }
        morphBackward();
    };
    productDetail.querySelector('.close-detail').onclick = closeDetail;
    productDetail.addEventListener('click', event => {
        if (event.target === productDetail) closeDetail();
    });

    return {
        morphForward,
        editItem,
        reset,
        setBulkOrderPrompt: callback => { onBulkOrderAttempt = callback; },
    };
}
