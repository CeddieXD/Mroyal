// js/utils.js
// Keep loaded Image objects alive so the browser retains them in memory.
const cache = new Map();

function preload(url) {
    if (cache.has(url)) return cache.get(url);
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'low';
    const loaded = new Promise(resolve => {
        img.onload = () => {
            if (typeof img.decode === 'function') {
                img.decode().catch(error => {
                    console.warn(`Could not decode preloaded image "${url}":`, error);
                }).finally(resolve);
            } else {
                resolve();
            }
        };
        img.onerror = () => {
            console.warn(`Could not preload image "${url}".`);
            resolve();
        };
    });
    cache.set(url, loaded);
    img.src = url;
    return loaded;
}

export function preloadProductImages(products) {
    return Promise.all((Array.isArray(products) ? products : []).map(product => {
        const imageName = product.image_url || product.img;
        return imageName ? preload(`assets/img/${imageName}`) : Promise.resolve();
    }));
}

export function preloadIntroFrames(totalFrames = 37) {
    for (let i = 1; i <= totalFrames; i++) {
        preload(`assets/img/frames/ezgif-frame-${String(i).padStart(3, '0')}.png`);
    }
}
