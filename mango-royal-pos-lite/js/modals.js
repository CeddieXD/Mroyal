import { imageUrl } from './api.js';

const root = () => document.getElementById('modal-root');

export function closeModal() { root().innerHTML = ''; }

function mount(html) {
    root().innerHTML = html;
    const backdrop = root().querySelector('.modal-backdrop');
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    return root().querySelector('.modal');
}

const peso = n => `₱${Number(n).toFixed(2)}`;
const formatAddOns = addOns => addOns.map(addon => {
    if (typeof addon === 'string') return addon;
    return `${addon.name}${addon.quantity > 1 ? ` ×${addon.quantity}` : ''}`;
}).join(', ');

/* ---------- VERIFY ---------- */
export function openVerifyModal(order, onConfirm) {
    const modal = mount(`
      <div class="modal-backdrop"><div class="modal">
        <div class="modal-header"><h2>Verify Payment</h2></div>
        <div class="modal-body">
          <div class="summary-box">
            <div class="row"><span>Order ID</span><span>${order.orderId}</span></div>
            ${order.items.map((i, idx) => `<div class="row"><span><span class="ln">${idx + 1}.</span> ${i.bundleQuantity > 1 ? `${i.quantity} bundle(s) (${i.quantity * i.bundleQuantity} Tall cups) ${i.name}` : `${i.quantity}× ${i.name} (${i.size})`}${i.addOns?.length ? `<br><small>Add-ons: ${formatAddOns(i.addOns)}</small>` : ''}</span><span>${peso(i.price * i.quantity)}</span></div>`).join('')}
            <div class="row"><span>Order total</span><span>${peso(order.total)}</span></div>
            <div class="row" id="v-discount-row" style="display:none;color:#166534"><span id="v-discount-label">Discount (20%)</span><span id="v-discount">-₱0.00</span></div>
            <div class="row total"><span>Total to be paid</span><span id="v-total">${peso(order.total)}</span></div>
          </div>

          <section class="verify-section">
            <label class="verify-discount-toggle"><input type="checkbox" id="v-hasdisc"> Apply PWD / Senior discount (20%)</label>
            <div id="v-disc-block" class="discount-details hidden">
              <div class="chip-row">
                <button type="button" class="chip active" data-disc="PWD">PWD</button>
                <button type="button" class="chip" data-disc="Senior">Senior</button>
              </div>
              <div id="v-pwd-fields" class="discount-fields">
                <label for="v-pwd-id">PWD ID number *</label>
                <input type="text" id="v-pwd-id" maxlength="100" autocomplete="off" placeholder="Enter the PWD ID number">
              </div>
              <div id="v-senior-fields" class="discount-fields hidden">
                <label for="v-senior-name">Senior citizen name *</label>
                <input type="text" id="v-senior-name" maxlength="150" autocomplete="name" placeholder="Enter the name on the ID">
                <label for="v-senior-birthdate">Birthdate *</label>
                <input type="date" id="v-senior-birthdate" autocomplete="bday">
              </div>
            </div>
          </section>

          <section class="verify-section payment-calculator">
            <label for="v-amount">Cash received (₱) *</label>
            <input type="number" id="v-amount" min="0" step="0.01" inputmode="decimal" placeholder="0.00" autofocus>
            <div class="chip-row payment-presets">
              <button type="button" class="chip" data-preset="exact">Exact amount</button>
              ${[50, 100, 200, 500, 1000].map(p => `<button type="button" class="chip" data-preset="${p}">₱${p}</button>`).join('')}
            </div>
            <div id="v-change" class="payment-change hidden" aria-live="polite"></div>
          </section>
          <div id="v-err" class="error-msg"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="v-cancel">Cancel</button>
          <button class="btn btn-success" id="v-ok">Confirm Payment</button>
        </div>
      </div></div>
    `);

    let discountType = 'PWD';
    const q = sel => modal.querySelector(sel);

    function recompute() {
        const hasDisc = q('#v-hasdisc').checked;
        const disc = hasDisc ? order.total * 0.20 : 0;
        const total = order.total - disc;
        q('#v-discount-row').style.display = hasDisc ? 'flex' : 'none';
        q('#v-discount-label').textContent = `${discountType} discount (20%)`;
        q('#v-discount').textContent = `-${peso(disc)}`;
        q('#v-total').textContent = peso(total);
        q('#v-disc-block').classList.toggle('hidden', !hasDisc);
        q('#v-pwd-fields').classList.toggle('hidden', !hasDisc || discountType !== 'PWD');
        q('#v-senior-fields').classList.toggle('hidden', !hasDisc || discountType !== 'Senior');

        const amt = parseFloat(q('#v-amount').value);
        if (Number.isFinite(amt) && amt > 0 && amt >= total) {
            q('#v-change').classList.remove('hidden');
            q('#v-change').classList.remove('is-short');
            q('#v-change').textContent = `Change: ${peso(amt - total)}`;
        } else if (Number.isFinite(amt) && amt > 0) {
            q('#v-change').classList.remove('hidden');
            q('#v-change').classList.add('is-short');
            q('#v-change').textContent = `Remaining: ${peso(total - amt)}`;
        } else {
            q('#v-change').classList.add('hidden');
            q('#v-change').classList.remove('is-short');
            q('#v-change').textContent = '';
        }
        return { total, disc, hasDisc };
    }

    q('#v-hasdisc').addEventListener('change', () => {
        q('#v-err').textContent = '';
        recompute();
    });
    q('#v-amount').addEventListener('input', () => { q('#v-err').textContent = ''; recompute(); });
    modal.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
        q('#v-amount').value = b.dataset.preset === 'exact'
            ? recompute().total.toFixed(2)
            : b.dataset.preset;
        q('#v-err').textContent = '';
        recompute();
    }));
    modal.querySelectorAll('[data-disc]').forEach(b => b.addEventListener('click', () => {
        discountType = b.dataset.disc;
        modal.querySelectorAll('[data-disc]').forEach(x => x.classList.toggle('active', x === b));
        q('#v-err').textContent = '';
        recompute();
    }));

    q('#v-cancel').addEventListener('click', closeModal);
    q('#v-ok').addEventListener('click', () => {
        q('#v-err').textContent = '';
        const { total, disc, hasDisc } = recompute();
        const amt = parseFloat(q('#v-amount').value);
        if (isNaN(amt) || amt <= 0) return (q('#v-err').textContent = 'Enter a valid payment amount.');
        if (amt < total) return (q('#v-err').textContent = `Insufficient payment (${peso(amt)} < ${peso(total)}).`);
        const pwdIdNumber = q('#v-pwd-id').value.trim();
        const seniorName = q('#v-senior-name').value.trim();
        const seniorBirthdate = q('#v-senior-birthdate').value;
        if (hasDisc && discountType === 'PWD' && !pwdIdNumber) {
            return (q('#v-err').textContent = 'Enter the PWD ID number.');
        }
        if (hasDisc && discountType === 'Senior' && (!seniorName || !seniorBirthdate)) {
            return (q('#v-err').textContent = 'Enter the senior citizen name and birthdate.');
        }
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (hasDisc && discountType === 'Senior' && seniorBirthdate > today) {
            return (q('#v-err').textContent = 'Birthdate cannot be in the future.');
        }
        onConfirm({
            paymentAmount: amt,
            paymentMethod: 'Cash',
            discountType: hasDisc ? discountType : null,
            discountAmount: disc,
            pwdIdNumber: hasDisc && discountType === 'PWD' ? pwdIdNumber : null,
            seniorName: hasDisc && discountType === 'Senior' ? seniorName : null,
            seniorBirthdate: hasDisc && discountType === 'Senior' ? seniorBirthdate : null,
        });
    });
    ['#v-pwd-id', '#v-senior-name', '#v-senior-birthdate'].forEach(selector => {
        q(selector).addEventListener('input', () => { q('#v-err').textContent = ''; });
    });
}

/* ---------- VOID ---------- */
export function openVoidModal(order, onConfirm) {
    const reasons = ['Customer Request', 'Wrong Order', 'Payment Issue', 'Out of Stock', 'System Error', 'Other'];
    const modal = mount(`
      <div class="modal-backdrop"><div class="modal">
        <div class="modal-header" style="background:linear-gradient(90deg,#dc2626,#b91c1c)"><h2>Void Order</h2></div>
        <div class="modal-body">
          <div class="summary-box" style="background:#fee2e2;color:#991b1b">
            <div class="row"><span>${order.orderId}</span><span>${peso(order.total)}</span></div>
            <div class="row"><span>${order.items.length} item(s)</span><span></span></div>
            <div style="font-size:12px;margin-top:6px">⚠ This action cannot be undone.</div>
          </div>
          <div class="field">
            <label>Reason *</label>
            <div id="v-reasons">
              ${reasons.map(r => `<label style="display:block;padding:4px 0;font-size:13px"><input type="radio" name="vreason" value="${r}"> ${r}</label>`).join('')}
            </div>
            <textarea id="v-other" rows="3" placeholder="Please specify…" style="display:none;margin-top:6px"></textarea>
            <div id="v-err" class="error-msg"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="c">Cancel</button>
          <button class="btn btn-danger" id="ok">Void Order</button>
        </div>
      </div></div>
    `);
    modal.querySelectorAll('input[name=vreason]').forEach(r => r.addEventListener('change', () => {
        modal.querySelector('#v-other').style.display = r.value === 'Other' ? 'block' : 'none';
    }));
    modal.querySelector('#c').addEventListener('click', closeModal);
    modal.querySelector('#ok').addEventListener('click', () => {
        const sel = modal.querySelector('input[name=vreason]:checked');
        if (!sel) return (modal.querySelector('#v-err').textContent = 'Select a reason.');
        const reason = sel.value === 'Other' ? modal.querySelector('#v-other').value.trim() : sel.value;
        if (!reason) return (modal.querySelector('#v-err').textContent = 'Reason required.');
        onConfirm(reason);
    });
}

/* ---------- MENU PICKER (shared by walk-in + edit) ---------- */
function menuItemHtml(p) {
    return `
      <div class="menu-item" data-cat="${p.category}">
        <div class="img">
          ${p.image ? `<img src="${imageUrl(p.image)}" alt="${p.name}" onerror="this.style.display='none'">` : ''}
        </div>
        <div class="body">
          <div class="p-cat">${p.category}</div>
          <div class="p-name">${p.name}</div>
          <div class="p-price">From ₱${p.basePrice}</div>
        </div>
        <div class="sizes">
          ${p.sizes.map(s => `<button class="chip" data-pid="${p.id}" data-vid="${s.variantId}" data-name="${p.name}" data-img="${p.image || ''}" data-size="${s.name}" data-price="${s.price}">${s.name} ₱${s.price}</button>`).join('')}
        </div>
      </div>`;
}

function openMenuPicker(menu, onPick) {
    const cats = ['All', ...Array.from(new Set(menu.map(p => p.category)))];
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="modal-backdrop" style="z-index:60"><div class="modal wide">
        <div class="modal-header"><h2>Add Item</h2>
          <button id="mp-close" class="btn btn-ghost" style="padding:4px 12px">✕</button>
        </div>
        <div class="modal-body">
          <div class="menu-toolbar">
            <input id="mp-search" class="menu-search" type="search" placeholder="Search products by name…" aria-label="Search products by name" autocomplete="off">
            <div class="menu-category-filters">
              ${cats.map((c, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-filter="${c}">${c}</button>`).join('')}
            </div>
          </div>
          <div class="menu-list" id="mp-list">${menu.map(menuItemHtml).join('')}</div>
          <p class="menu-no-results hidden" id="mp-no-results" role="status">No products match your search.</p>
        </div>
      </div></div>`;
    document.body.appendChild(wrapper);
    const close = () => wrapper.remove();
    wrapper.querySelector('#mp-close').addEventListener('click', close);
    wrapper.querySelector('.modal-backdrop').addEventListener('click', e => {
        if (e.target === wrapper.querySelector('.modal-backdrop')) close();
    });
    let activeCategory = 'All';
    const search = wrapper.querySelector('#mp-search');
    const filterProducts = () => {
        const query = search.value.trim().toLowerCase();
        let visibleCount = 0;
        wrapper.querySelectorAll('.menu-item').forEach(el => {
            const matchesCategory = activeCategory === 'All' || el.dataset.cat === activeCategory;
            const matchesName = el.querySelector('.p-name').textContent.toLowerCase().includes(query);
            const visible = matchesCategory && matchesName;
            el.style.display = visible ? '' : 'none';
            if (visible) visibleCount += 1;
        });
        wrapper.querySelector('#mp-no-results').classList.toggle('hidden', visibleCount > 0);
    };
    search.addEventListener('input', filterProducts);
    wrapper.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
        wrapper.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
        activeCategory = b.dataset.filter;
        filterProducts();
    }));
    wrapper.querySelectorAll('.chip[data-vid]').forEach(b => b.addEventListener('click', () => {
        onPick({
            productId: Number(b.dataset.pid),
            variantId: Number(b.dataset.vid),
            name: b.dataset.name,
            image: b.dataset.img || null,
            size: b.dataset.size,
            price: Number(b.dataset.price),
            quantity: 1,
            id: Date.now() + Math.random(),
        });
        close();
    }));
}

/* ---------- ITEM EDITOR (walk-in + edit share this) ---------- */
function itemEditorHtml(title, submitLabel) {
    return `
      <div class="modal-backdrop"><div class="modal wide">
        <div class="modal-header"><h2>${title}</h2></div>
        <div class="modal-body">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h4>Items</h4>
            <button class="btn btn-primary" id="add-item">+ Add Item</button>
          </div>
          <div id="items-container"><p style="color:#6b7280;text-align:center;padding:20px">No items yet.</p></div>
        </div>
        <div class="modal-footer">
          <div style="flex:1;display:flex;justify-content:space-between;align-items:center;padding:0 6px">
            <span style="font-weight:600">Total</span>
            <span id="ie-total" style="font-weight:700;color:#ea580c;font-size:18px">₱0.00</span>
          </div>
          <button class="btn btn-outline" id="cancel">Cancel</button>
          <button class="btn btn-success" id="submit">${submitLabel}</button>
        </div>
      </div></div>`;
}

function renderItems(container, items, menu, onChange) {
    if (!items.length) {
        container.innerHTML = `<p style="color:#6b7280;text-align:center;padding:20px">No items yet.</p>`;
        return;
    }
    container.innerHTML = items.map((it, idx) => {
        const product = menu.find(p => p.id === it.productId) || menu.find(p => p.name === it.name);
        const img = it.image || product?.image;
        return `
          <div class="editable-item" data-idx="${idx}">
            <div class="thumb">
              ${img ? `<img src="${imageUrl(img)}" alt="${it.name}" onerror="this.style.display='none'">` : ''}
            </div>
            <div class="body">
              <div class="head">
                <div>
                  <div class="name">${it.name}</div>
                  <div class="meta">${product?.bundleQuantity > 1 ? `${product.bundleQuantity} Tall cups per bundle · ₱${it.price} / bundle` : `${it.size} · ₱${it.price} ea`}${it.addOns?.length ? `<br>Add-ons: ${formatAddOns(it.addOns)}` : ''}</div>
                </div>
                <div class="price">₱${(it.price * it.quantity).toFixed(2)}</div>
              </div>
              <div class="qty-controls">
                <button class="qty-btn" data-act="dec">−</button>
                <span class="qty">${it.quantity}</span>
                <button class="qty-btn" data-act="inc">+</button>
                <span class="size-label">Size:</span>
                ${(product?.sizes || []).map(s => `<button class="chip ${s.name === it.size ? 'active' : ''}" data-act="size" data-size="${s.name}" data-price="${s.price}" data-vid="${s.variantId}">${s.name}</button>`).join('')}
                <button class="btn btn-danger" data-act="rm" style="margin-left:auto;padding:6px 12px">Remove</button>
              </div>
            </div>
          </div>`;
    }).join('');

    container.querySelectorAll('.editable-item').forEach(el => {
        const idx = Number(el.dataset.idx);
        el.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
            const act = btn.dataset.act;
            if (act === 'inc') items[idx].quantity += 1;
            else if (act === 'dec') items[idx].quantity = Math.max(1, items[idx].quantity - 1);
            else if (act === 'rm') items.splice(idx, 1);
            else if (act === 'size') {
                items[idx].size = btn.dataset.size;
                const addOnPrices = {
                    'Pearls / Tapioca': 10,
                    'Nata de Coco': 10,
                    'Graham Crumbs / Crushed Graham': 10,
                    'Oreo Crumbs': 10,
                    'Choco Chips / Choco Bits': 10,
                    Cheesecake: 20,
                    'Frosted Cream Cheese': 25,
                };
                items[idx].price = Number(btn.dataset.price) +
                    (items[idx].addOns || []).reduce((sum, addon) => {
                        const name = typeof addon === 'string' ? addon : addon.name;
                        const quantity = typeof addon === 'string' ? 1 : Number(addon.quantity);
                        return sum + (addOnPrices[name] || 0) * quantity;
                    }, 0);
                items[idx].variantId = Number(btn.dataset.vid);
            }
            onChange();
        }));
    });
}

function itemEditor(title, initialItems, menu, submitLabel, onSubmit, opts = {}) {
    const modal = mount(itemEditorHtml(title, submitLabel));
    if (opts.showOrderType) {
        const body = modal.querySelector('.modal-body');
        const pick = document.createElement('div');
        pick.className = 'field';
        pick.innerHTML = `
            <label>Order Type</label>
            <div class="chip-row" id="ie-ordertype">
                <button class="chip active" data-type="Dine-in">🍽 Dine-in</button>
                <button class="chip" data-type="Take-out">🥤 Take-out</button>
            </div>`;
        body.prepend(pick);
        pick.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
            pick.querySelectorAll('[data-type]').forEach(x => x.classList.toggle('active', x === b));
            modal.dataset.orderType = b.dataset.type;
        }));
        modal.dataset.orderType = 'Dine-in';
    }
    const items = initialItems.map(x => ({ ...x }));
    const container = modal.querySelector('#items-container');
    const totalEl = modal.querySelector('#ie-total');

    function refresh() {
        renderItems(container, items, menu, refresh);
        const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
        totalEl.textContent = peso(total);
    }
    refresh();

    modal.querySelector('#add-item').addEventListener('click', () => {
        openMenuPicker(menu, item => { items.push(item); refresh(); });
    });
    modal.querySelector('#cancel').addEventListener('click', closeModal);
    modal.querySelector('#submit').addEventListener('click', () => {
        if (!items.length) { alert('Add at least one item.'); return; }
        onSubmit(items, modal.dataset.orderType || 'Dine-in');
    });
}

export function openWalkInModal(menu, onCreate) {
    itemEditor('New Walk-in Order', [], menu, 'Create Order', onCreate, { showOrderType: true });
}

export function openEditModal(order, menu, onSave) {
    // Ensure edit items have variantId
    const seeded = order.items.map(i => {
        if (i.variantId) return i;
        const product = menu.find(p => p.id === i.productId) || menu.find(p => p.name === i.name);
        const sz = product?.sizes.find(s => s.name === i.size);
        return { ...i, variantId: sz?.variantId };
    });
    itemEditor(`Edit ${order.orderId}`, seeded, menu, 'Save Changes', onSave);
}
