// js/mainMenu.js
import { preloadProductImages } from './utils.js';

const mainMenu = document.getElementById('main-menu');
const API_BASE = window.API_BASE || window.location.origin;

export function initMainMenu({ onProductClick, onStartAgain }) {
    const productSection    = mainMenu.querySelector('.product-section');
    const productCategories = mainMenu.querySelector('.product-categories');
    const startAgainButton  = mainMenu.querySelector('#start-again-button');
    const startAgainConfirmation = mainMenu.querySelector('#start-again-confirmation');
    const categoryItems     = mainMenu.querySelectorAll('.cat-item');
    const searchInput       = mainMenu.querySelector('#menu-search');

    let dbProducts       = [];
    let categorySections = new Map();   // category id → <section> element
    let pendingCategory  = null;

    // Non-null while a rail-click scroll is in progress.
    // The scroll-spy is completely disabled during this time.
    // ── Helpers ───────────────────────────────────────────────────────────────

    const updateScrollSpace = () => {
        // Enough bottom padding so the last section can scroll to the top.
        productCategories.style.paddingBottom = `${productSection.clientHeight}px`;
    };

    const priceRange = (item) => {
        if (item.bundle_quantity > 1) {
            return `${item.bundle_quantity} Tall cups for ₱${item.prices.tall.toFixed(0)}`;
        }
        const values = Object.values(item.prices);
        if (!values.length) return '';
        const min = Math.min(...values);
        const max = Math.max(...values);
        return min === max
            ? `₱${min.toFixed(0)}`
            : `₱${min.toFixed(0)} – ₱${max.toFixed(0)}`;
    };

    const createProductCard = (item) => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <div class="product-img-wrapper">
                <img src="assets/img/${item.img}" class="card-img" alt="${item.name}">
            </div>
            <div class="product-info">
                <h4>${item.name}</h4>
                <div class="price-line">${priceRange(item)}</div>
            </div>`;
        card.onclick = () => onProductClick(card.querySelector('.card-img'), item);
        return card;
    };

    const setActiveCategory = (category) => {
        categoryItems.forEach(item =>
            item.classList.toggle('active', item.dataset.category === category));
    };

    // ── Scroll-spy ────────────────────────────────────────────────────────────

    const spyActiveCategory = () => {
        const containerTop = productSection.getBoundingClientRect().top + 24;
        let active = null;
        let first = null;
        let nearest = Infinity;
        categorySections.forEach((section, cat) => {
            if (section.classList.contains('hidden')) return;
            const title = section.querySelector('.menu-category-title');
            if (!title) return;
            if (!first) first = cat;
            const distance = title.getBoundingClientRect().top - containerTop;
            if (distance <= 0) {
                active = cat;
                nearest = 0;
            } else if (active === null && distance < nearest) {
                nearest = distance;
                active = cat;
            }
        });
        setActiveCategory(active ?? first);
    };

    // ── Scroll-to ─────────────────────────────────────────────────────────────

    const scrollToCategory = (category, behavior = 'smooth') => {
        const section = categorySections.get(category);
        if (!section || productSection.clientHeight === 0) return false;

        const title = section.querySelector('.menu-category-title');
        if (!title) return false;

        // Check if already visible at the top (within 5px).
        const containerTop = productSection.getBoundingClientRect().top;
        const titleTop     = title.getBoundingClientRect().top;
        const distFromTop  = titleTop - containerTop;

        if (distFromTop >= 0 && distFromTop < 5) {
            setActiveCategory(category);
            return true;
        }

        setActiveCategory(category);
        productSection.scrollTo({
            top: productSection.scrollTop + distFromTop - 24,
            behavior,
        });
        return true;
    };

    // ── Render ────────────────────────────────────────────────────────────────

    const renderCategories = () => {
        productCategories.replaceChildren();
        categorySections.clear();

        Array.from(categoryItems, item => ({
            id:    item.dataset.category,
            label: item.lastElementChild.textContent.trim(),
        })).forEach(({ id, label }) => {
            const section = document.createElement('section');
            section.className = 'menu-category-section';
            section.dataset.category = id;
            section.innerHTML = `
                <h2 class="menu-category-title">${label}</h2>
                <div class="product-grid"></div>`;
            const grid = section.querySelector('.product-grid');
            dbProducts
                .filter(p => p.category === id)
                .forEach(p => grid.appendChild(createProductCard(p)));
            if (!grid.childElementCount) {
                const empty = document.createElement('div');
                empty.className = 'grid-empty';
                empty.textContent = 'No shakes available in this category.';
                grid.appendChild(empty);
            }
            productCategories.appendChild(section);
            categorySections.set(id, section);
        });

        updateScrollSpace();
    };

    // ── Search ────────────────────────────────────────────────────────────────

    const applySearch = () => {
        const q = searchInput.value.trim().toLowerCase();
        let matchCount = 0;
        categorySections.forEach(section => {
            let sectionCount = 0;
            section.querySelectorAll('.product-card').forEach(card => {
                const matches = !q || card.querySelector('h4')
                    .textContent.toLowerCase().includes(q);
                card.classList.toggle('hidden', !matches);
                if (matches) sectionCount++;
            });
            section.classList.toggle('hidden', Boolean(q) && sectionCount === 0);
            matchCount += sectionCount;
        });
        productCategories.querySelector('.grid-empty')?.remove();
        if (q && !matchCount) {
            const empty = document.createElement('div');
            empty.className = 'grid-empty';
            empty.textContent = 'No shakes found.';
            productCategories.appendChild(empty);
        }
        if (q) categoryItems.forEach(item => item.classList.remove('active'));
        else spyActiveCategory();
    };

    // ── Data loading ──────────────────────────────────────────────────────────

    const loadProducts = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/products`);
            const rawData  = await response.json();

            if (!Array.isArray(rawData)) {
                productCategories.innerHTML =
                    `<div class="grid-empty">Menu is unavailable. Please see the counter.</div>`;
                return;
            }

            preloadProductImages(rawData);

            const grouped = rawData.reduce((acc, row) => {
                let product = acc.find(p => p.name === row.name);
                if (!product) {
                    product = {
                        id:          row.product_id,
                        name:        row.name,
                        img:         row.image_url,
                        desc:        row.description,
                        ingredients: row.ingredients || '',
                        bundle_quantity: Number(row.bundle_quantity) || 1,
                        category:    row.category_name,
                        prices:      {},
                        variant_ids: {},
                    };
                    acc.push(product);
                }
                product.prices[row.size_name.toLowerCase()]      = parseFloat(row.price);
                product.variant_ids[row.size_name.toLowerCase()] = row.variant_id;
                return acc;
            }, []);

            dbProducts = grouped;
            renderCategories();
            spyActiveCategory();

            if (pendingCategory) {
                const cat = pendingCategory;
                pendingCategory = null;
                requestAnimationFrame(() => {
                    if (!scrollToCategory(cat)) pendingCategory = cat;
                });
            }
        } catch (err) {
            console.error('Failed to load products:', err);
            productCategories.innerHTML =
                `<div class="grid-empty">Cannot reach the menu server.<br>Please see the counter.</div>`;
        }
    };

    // ── Event wiring ──────────────────────────────────────────────────────────

    searchInput.oninput = () => {
        productSection.scrollTo({ top: 0, behavior: 'smooth' });
        applySearch();
    };

    categoryItems.forEach(btn => {
        btn.onclick = () => {
            // Clear any active search first (without running spy).
            if (searchInput.value) {
                searchInput.value = '';
                applySearch();
            }
            const category = btn.dataset.category;
            requestAnimationFrame(() => {
                if (!scrollToCategory(category)) pendingCategory = category;
            });
        };
    });

    // While a rail-click scroll is in progress, the spy is disabled.
    // We only unlock after the scroll has been still for 350 ms (or scrollend).
    productSection.addEventListener('scroll', () => {
        spyActiveCategory();
    }, { passive: true });

    window.addEventListener('resize', updateScrollSpace);

    startAgainButton.onclick = () =>
        startAgainConfirmation.classList.remove('hidden');
    mainMenu.querySelector('#start-again-cancel').onclick = () =>
        startAgainConfirmation.classList.add('hidden');
    mainMenu.querySelector('#start-again-confirm').onclick = () => {
        startAgainConfirmation.classList.add('hidden');
        onStartAgain?.();
    };

    return {
        show: () => {
            mainMenu.classList.remove('hidden');
            startAgainConfirmation.classList.add('hidden');
            updateScrollSpace();
            if (!dbProducts.length) loadProducts();
        },
        hide: () => mainMenu.classList.add('hidden'),
        reload: loadProducts,
        getProduct: productId => dbProducts.find(product => Number(product.id) === Number(productId)),
    };
}
