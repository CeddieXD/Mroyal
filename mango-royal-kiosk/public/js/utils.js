// js/utils.js
// Keep loaded Image objects alive so the browser retains them in memory.
const cache = new Map();

function preload(url) {
    if (cache.has(url)) return;
    const img = new Image();
    img.src = url;
    cache.set(url, img);
}

export function preloadProductImages(products) {
    products.forEach(product => {
        const imageName = product.image_url || product.img;
        if (imageName) preload(`assets/img/${imageName}`);
    });
}

export function preloadIntroFrames(totalFrames = 37) {
    for (let i = 1; i <= totalFrames; i++) {
        preload(`assets/img/frames/ezgif-frame-${String(i).padStart(3, '0')}.png`);
    }
}
