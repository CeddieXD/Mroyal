// js/mainMenu.js
import { preloadProductImages } from './utils.js';

const mainMenu = document.getElementById('main-menu');
const API_BASE = window.API_BASE || window.location.origin;

export function initMainMenu({ onProductClick, onChangeOrderType }) {
    const productGrid = mainMenu.querySelector('.product-grid');
    const categoryItems = mainMenu.querySelectorAll('.cat-item');
    const searchInput = mainMenu.querySelector('#menu-search');
    const otPill = mainMenu.querySelector('#order-type-pill');

    let dbProducts = [];
    let activeCategory = 'BEST_SELLERS';

    const priceRange = (item) => {
        const values = Object.values(item.prices);
        if (!values.length) return '';
        const min = Math.min(...values);
        const max = Math.max(...values);
        return min === max ? `₱${min.toFixed(0)}` : `₱${min.toFixed(0)} – ₱${max.toFixed(0)}`;
    };

    const renderProducts = (items) => {
        productGrid.innerHTML = '';
        if (!items.length) {
            productGrid.innerHTML = `<div class="grid-empty">No shakes found in this category.</div>`;
            return;
        }
        items.forEach(item => {
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
            productGrid.appendChild(card);
        });
    };

    const applyFilters = () => {
        const q = searchInput.value.trim().toLowerCase();
        let items = dbProducts;
        if (q) {
            items = items.filter(p => p.name.toLowerCase().includes(q));
            categoryItems.forEach(b => b.classList.remove('active'));
        } else {
            items = items.filter(p => p.category === activeCategory);
            categoryItems.forEach(b => b.classList.toggle('active', b.dataset.category === activeCategory));
        }
        renderProducts(items);
    };

    const loadProducts = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/products`);
            const rawData = await response.json();

            if (!Array.isArray(rawData)) {
                productGrid.innerHTML = `<div class="grid-empty">Menu is unavailable. Please see the counter.</div>`;
                return;
            }

            preloadProductImages(rawData);

            const grouped = rawData.reduce((acc, row) => {
                let product = acc.find(p => p.name === row.name);
                if (!product) {
                    product = {
                        id: row.product_id,
                        name: row.name,
                        img: row.image_url,
                        desc: row.description,
                        category: row.category_name,
                        prices: {},
                        variant_ids: {}
                    };
                    acc.push(product);
                }
                product.prices[row.size_name.toLowerCase()] = parseFloat(row.price);
                product.variant_ids[row.size_name.toLowerCase()] = row.variant_id;
                return acc;
            }, []);

            dbProducts = grouped;
            applyFilters();
        } catch (err) {
            console.error("Failed to load products:", err);
            productGrid.innerHTML = `<div class="grid-empty">Cannot reach the menu server.<br>Please see the counter.</div>`;
        }
    };

    searchInput.oninput = applyFilters;

    categoryItems.forEach(btn => {
        btn.onclick = () => {
            categoryItems.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeCategory = btn.dataset.category;
            searchInput.value = '';
            applyFilters();
        };
    });

    otPill.onclick = () => onChangeOrderType?.();

    return {
        show: () => {
            mainMenu.classList.remove('hidden');
            if (!dbProducts.length) loadProducts();
        },
        hide: () => mainMenu.classList.add('hidden'),
        setOrderType: (type) => {
            mainMenu.querySelector('#ot-value').innerText = type;
        },
        reload: loadProducts,
    };
}
