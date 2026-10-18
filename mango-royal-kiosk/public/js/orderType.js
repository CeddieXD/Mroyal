// js/orderType.js
export function initOrderType({ onChoose, onBack }) {
    const screen = document.getElementById('order-type');
    screen.querySelectorAll('.ot-card').forEach(btn => {
        btn.onclick = () => onChoose(btn.dataset.type);
    });
    const back = screen.querySelector('#ot-back');
    if (back) back.onclick = onBack;

    return {
        show: () => screen.classList.remove('hidden'),
        hide: () => screen.classList.add('hidden'),
    };
}
