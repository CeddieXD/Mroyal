document.addEventListener('DOMContentLoaded', () => {

    const mainMenu = document.getElementById('main-menu');
    const productDetail = document.getElementById('product-detail');
    let lastClickedImg = null;

    // --- 1. QUANTITY & SIZE LOGIC ---
    function initDetailFunctionality() {
        // Quantity Controls
        const qtyMinus = document.getElementById('qty-minus');
        const qtyPlus = document.getElementById('qty-plus');
        const qtyVal = document.getElementById('qty-val');

        qtyPlus.onclick = () => {
            let current = parseInt(qtyVal.innerText);
            current++;
            qtyVal.innerText = current;
            updateTotalPrice(current); // Recalculate!
        };

        qtyMinus.onclick = () => {
            let current = parseInt(qtyVal.innerText);
            if (current > 1) {
                current--;
                qtyVal.innerText = current;
                updateTotalPrice(current); // Recalculate!
            }
        };

        // Size Selection
        

        


    }

    function renderProducts(categoryKey) {
        const grid = document.querySelector('.product-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const products = productData[categoryKey] || [];
        products.forEach(item => {
            const card = document.createElement('div');
            card.className = 'product-card';
            card.innerHTML = `
                <div class="product-img-wrapper">
                    <img src="assets/img/${item.img}" class="card-img" alt="${item.name}">
                </div>
                <div class="product-info">
                    <h4>${item.name}</h4>
                    <div class="add-btn">+</div>
                </div>
            `;

            card.addEventListener('click', () => {
                lastClickedImg = card.querySelector('.card-img');
                morphForward(lastClickedImg, item);
            });
            grid.appendChild(card);
        });
    }

    // --- FLY FORWARD (Card to Detail) ---
    function morphForward(startImg, product) {
    
}

    function updateTotalPrice(qty) {
        const priceDisplay = document.querySelector('.detail-price');
        const basePrice = parseFloat(priceDisplay.getAttribute('data-base-price'));
        const total = basePrice * qty;
        priceDisplay.innerText = `₱${total.toLocaleString()}.00`;
    }

    // --- FLY BACKWARD (Detail to Card) ---
    function morphBackward() {
        
    }

    // Attach Back Button
    document.querySelector('.close-detail').onclick = morphBackward;
    initDetailFunctionality();

    // 6. SPLASH & INTRO ANIMATION
    const startBtn = document.getElementById('start-btn');
    const splashScreen = document.getElementById('splash-screen');
    const introLayer = document.getElementById('intro');
    const frameElement = document.getElementById("frame");

    const totalFrames = 37;
    let currentFrame = 1;

    // Start with Splash Visible
    // splashScreen.classList.add('hidden');
    // showMainMenu(); 

    startBtn.addEventListener('click', () => {
        splashScreen.classList.add('fade-out');
        setTimeout(() => {
            splashScreen.classList.add('hidden');
            introLayer.classList.remove('hidden');
            playIntroAnimation();
        }, 600);
    });

    // 3. Category Selection Logic (Unified)
    // 3. Category Selection Logic
    const categoryItems = document.querySelectorAll('.cat-item');
    const productGrid = document.querySelector('.product-grid'); // Define the grid here

    categoryItems.forEach(button => {
        button.addEventListener('click', () => {
            // UI: Handle Active State
            categoryItems.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // UI: Scroll the category button itself into view (the top navigation)
            button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

            // --- THE RESET FIX ---
            // Immediately snap the product grid back to the start (0px)
            // We use 'auto' instead of 'smooth' here so the new products 
            // don't "slide" into place weirdly while loading.
            if (productGrid) {
                productGrid.scrollTo({ left: 0, behavior: 'auto' });
            }

            // Logic: Render the products for the new category
            const category = button.getAttribute('data-category');
            renderProducts(category);
        });
    });

    function playIntroAnimation() {
        const animationInterval = setInterval(() => {
            currentFrame++;
            if (currentFrame > totalFrames) {
                clearInterval(animationInterval);
                showMainMenu();
                return;
            }
            const frameNum = String(currentFrame).padStart(3, '0');
            frameElement.src = `assets/img/frames/ezgif-frame-${frameNum}.png`;
        }, 60);
    }

    function showMainMenu() {
        introLayer.classList.add('fade-out');
        setTimeout(() => {
            introLayer.classList.add('hidden');
            mainMenu.classList.remove('hidden');
            mainMenu.classList.add('fade-in-up');
            renderProducts('BEST_SELLERS'); // Initial Load
        }, 600);
    }
});