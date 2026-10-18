// js/navigation.js
export function initNavigation(menu, cart) {
    const navItems = document.querySelectorAll('.nav-item');
    const navBar = document.querySelector('.bottom-nav');
    const views = {
        'main-menu': document.getElementById('main-menu'),
        'cart-page': document.getElementById('cart-page')
    };

    const setActiveView = (targetId) => {
        // 1. Reset Search Mode
        document.getElementById('main-menu').classList.remove('search-mode');

        // 2. Toggle active class on icons
        navItems.forEach(nav => {
            nav.classList.toggle('active', nav.getAttribute('data-target') === targetId);
        });

        // 3. Switch Views
        Object.values(views).forEach(v => v?.classList.add('hidden'));
        views[targetId]?.classList.remove('hidden');

        // 4. Specific View Logic
        if (targetId === 'cart-page') {
            navBar.classList.add('hidden'); // Hide nav bar on cart
            cart?.render();
        } else {
            navBar.classList.remove('hidden'); // Show nav bar on home/others
        }
    };

    navItems.forEach(item => {
        item.onclick = () => setActiveView(item.getAttribute('data-target'));
    });

    return {
        show: () => navBar.classList.remove('hidden'),
        hide: () => navBar.classList.add('hidden'),
        goTo: (viewId) => setActiveView(viewId) // Allow external calls
    };
}