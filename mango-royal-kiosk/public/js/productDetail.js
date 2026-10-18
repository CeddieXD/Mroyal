// js/productDetail.js
export function initProductDetail({ onAddToCart } = {}) {
    const productDetail = document.getElementById('product-detail');
    const detailImg = document.getElementById('detail-img');
    const qtyVal = document.getElementById('qty-val');
    const sizeBtns = productDetail.querySelectorAll('.size-btn');
    const priceDisplay = productDetail.querySelector('.detail-price');
    const addBtn = productDetail.querySelector('.add-to-cart-big');

    let lastClickedImg = null;
    let currentProduct = null;

    const getSelectedSize = () => {
        const active = productDetail.querySelector('.size-btn.active');
        return active ? active.innerText : 'Tall';
    };

    const updateTotalPrice = (qty) => {
        const basePrice = parseFloat(priceDisplay.getAttribute('data-base-price'));
        const total = basePrice * qty;
        priceDisplay.innerText = `₱${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    };

    const resetToDefaults = (product) => {
        currentProduct = product;
        qtyVal.innerText = "1";
        const initialPrice = product.prices['tall'];
        priceDisplay.setAttribute('data-base-price', initialPrice);
        updateTotalPrice(1);

        sizeBtns.forEach((btn, i) => btn.classList.toggle('active', i === 0));
        productDetail.querySelector('.size-selector').classList.remove('is-grande');
    };

    productDetail.querySelector('#qty-plus').onclick = () => {
        let current = parseInt(qtyVal.innerText);
        current++;
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

    addBtn.onclick = () => {
        if (!currentProduct) return;
        const size = getSelectedSize();
        const sizeKey = size.toLowerCase();
        const qty = parseInt(qtyVal.innerText, 10);
        onAddToCart?.({
            product_id: currentProduct.id,
            name: currentProduct.name,
            img: currentProduct.img,
            size,
            variant_id: currentProduct.variant_ids[sizeKey],
            price: currentProduct.prices[sizeKey],
            quantity: qty,
        });
        morphBackward();
    };

    const morphForward = (startImg, product) => {
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

        productDetail.querySelector('#detail-name').innerText = product.name;
        productDetail.querySelector('#detail-desc').innerText = product.desc;
        resetToDefaults(product);

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
    };

    productDetail.querySelector('.close-detail').onclick = morphBackward;

    return { morphForward, reset };
}
