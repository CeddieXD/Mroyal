import { imageUrl } from './api.js';

const root = () => document.getElementById('modal-root');

export function closeModal() { root().innerHTML = ''; }

function mount(html, { closeOnBackdrop = true } = {}) {
    root().innerHTML = html;
    const backdrop = root().querySelector('.modal-backdrop');
    if (closeOnBackdrop) {
        backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    }
    return root().querySelector('.modal');
}

const peso = n => `₱${Number(n).toFixed(2)}`;
const formatAddOns = addOns => addOns.map(addon => {
    if (typeof addon === 'string') return addon;
    return `${addon.name}${addon.quantity > 1 ? ` ×${addon.quantity}` : ''}`;
}).join(', ');

/* ---------- VERIFY ---------- */
export function openVerifyModal(order, onConfirm) {
    const isSingleServingOrder = order.items.length === 1
        && Number(order.items[0].quantity) === 1
        && (Number(order.items[0].bundleQuantity) || 1) === 1;
    const modal = mount(`
      <div class="modal-backdrop"><div class="modal">
        <div class="modal-header"><h2>Verify Payment</h2></div>
        <div class="modal-body">
          <div class="summary-box">
            <div class="row"><span>Order ID</span><span>${order.orderId}</span></div>
            ${order.items.map((i, idx) => `<div class="row"><span><span class="ln">${idx + 1}.</span> ${i.bundleQuantity > 1 ? `${i.quantity} bundle(s) (${i.quantity * i.bundleQuantity} Tall cups) ${i.name}` : `${i.quantity}× ${i.name} (${i.size})`}${i.addOns?.length ? `<br><small>Add-ons: ${formatAddOns(i.addOns)}</small>` : ''}</span><span>${peso(i.price * i.quantity)}</span></div>`).join('')}
            <div class="row"><span>Order total</span><span>${peso(order.total)}</span></div>
            <div class="row" id="v-eligible-row" style="display:none"><span>Eligible gross portion</span><span id="v-eligible">₱0.00</span></div>
            <div class="row" id="v-vat-row" style="display:none;color:#166534"><span>VAT exemption</span><span id="v-vat">-₱0.00</span></div>
            <div class="row" id="v-discount-row" style="display:none;color:#166534"><span id="v-discount-label">20% discount</span><span id="v-discount">-₱0.00</span></div>
            <div class="row total"><span>Total to be paid</span><span id="v-total">${peso(order.total)}</span></div>
          </div>

          <section class="verify-section">
            <label class="verify-discount-toggle"><input type="checkbox" id="v-hasdisc"> Apply PWD / Senior discount and VAT exemption</label>
            <div id="v-disc-block" class="discount-details hidden">
              <div class="chip-row">
                <button type="button" class="chip active" data-disc="PWD">PWD</button>
                <button type="button" class="chip" data-disc="Senior">Senior</button>
              </div>
              <div id="v-pwd-fields" class="discount-fields">
                <label for="v-pwd-id">PWD ID number *</label>
                <input type="text" id="v-pwd-id" maxlength="19" autocomplete="off" inputmode="numeric" pattern="[0-9]{2}-[0-9]{4}-[0-9]{3}-[0-9]{7}" aria-describedby="v-pwd-hint" placeholder="RR-PPMM-BBB-NNNNNNN">
                <small id="v-pwd-hint">Enter the ID number in this format: RR-PPMM-BBB-NNNNNNN (Region-Province-Municipality-Barangay-Sequential Number).</small>
              </div>
              <div id="v-senior-fields" class="discount-fields hidden">
                <label for="v-senior-name">Senior citizen name *</label>
                <input type="text" id="v-senior-name" maxlength="150" autocomplete="name" placeholder="Enter the name on the ID">
                <label for="v-senior-birthdate">Birthdate (must confirm age 60 or above) *</label>
                <input type="date" id="v-senior-birthdate" autocomplete="bday">
                <small id="v-senior-age" aria-live="polite">Enter the birthdate to confirm the holder is at least 60 years old.</small>
              </div>
              <div class="discount-calculation ${isSingleServingOrder ? 'hidden' : ''}">
                <label>Eligible portion calculation</label>
                <div class="chip-row">
                  <button type="button" class="chip active" data-scope="individual_share">Individual share</button>
                  <button type="button" class="chip" data-scope="selected_items">Selected items</button>
                </div>
                <label for="v-cardholders">Eligible PWD / Senior cardholders present *</label>
                <input type="number" id="v-cardholders" min="1" step="1" value="1" inputmode="numeric">
                <div id="v-share-fields" class="discount-fields">
                  <label for="v-total-people">Total people in the group *</label>
                  <input type="number" id="v-total-people" min="1" step="1" value="1" inputmode="numeric">
                  <small>Apply one equal share for each eligible cardholder.</small>
                </div>
                <div id="v-selected-fields" class="discount-fields hidden">
                  <small>Select servings intended for the cardholder(s)' personal consumption. Shared bundle items are limited to one standard serving per eligible cardholder.</small>
                  <div id="v-eligible-items"></div>
                </div>
                <div id="v-calculation-error" class="error-msg" aria-live="polite"></div>
              </div>
            </div>
          </section>

          <section class="verify-section payment-calculator">
            <label for="v-amount">Cash received (₱) *</label>
            <input type="number" id="v-amount" min="0" step="0.01" inputmode="decimal" placeholder="0.00" autofocus>
            <div class="chip-row payment-presets">
              <button type="button" class="chip" data-preset="exact">Exact amount</button>
              ${[20, 50, 100, 200, 500, 1000].map(p => `<button type="button" class="chip" data-preset="${p}">₱${p}</button>`).join('')}
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
    `, { closeOnBackdrop: false });

    let discountType = 'PWD';
    let discountScope = 'individual_share';
    const q = sel => modal.querySelector(sel);

    function formatPwdIdInput() {
        const input = q('#v-pwd-id');
        const startDigits = input.value.slice(0, input.selectionStart).replace(/\D/g, '').length;
        const endDigits = input.value.slice(0, input.selectionEnd).replace(/\D/g, '').length;
        const digits = input.value.replace(/\D/g, '').slice(0, 16);
        const formatted = digits.replace(/^(\d{2})(\d)/, '$1-$2')
            .replace(/^(\d{2}-\d{4})(\d)/, '$1-$2')
            .replace(/^(\d{2}-\d{4}-\d{3})(\d)/, '$1-$2');
        const cursorAtDigit = digitCount => {
            digitCount = Math.min(digitCount, digits.length);
            if (digitCount >= 9 && digits.length > 9) return digitCount + 3;
            if (digitCount >= 6 && digits.length > 6) return digitCount + 2;
            if (digitCount >= 2 && digits.length > 2) return digitCount + 1;
            return digitCount;
        };
        input.value = formatted;
        input.setSelectionRange(cursorAtDigit(startDigits), cursorAtDigit(endDigits));
    }

    function seniorAge(birthdate) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthdate || '');
        if (!match) return null;
        const [, yearText, monthText, dayText] = match;
        const year = Number(yearText);
        const month = Number(monthText);
        const day = Number(dayText);
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
        const today = new Date();
        if (date > new Date(today.getFullYear(), today.getMonth(), today.getDate())) return null;
        return today.getFullYear() - year
            - (today.getMonth() < month - 1 || (today.getMonth() === month - 1 && today.getDate() < day) ? 1 : 0);
    }

    function recompute() {
        const hasDisc = q('#v-hasdisc').checked;
        const cardholderCount = isSingleServingOrder ? 1 : Number(q('#v-cardholders').value);
        let totalPeople = null;
        let eligibleGross = 0;
        let vatExemptAmount = 0;
        let disc = 0;
        let total = order.total;
        let valid = true;
        let error = '';
        let eligibleItems = [];

        if (hasDisc) {
            if (isSingleServingOrder) {
                discountScope = 'individual_share';
                totalPeople = 1;
                eligibleGross = order.total;
            } else if (!Number.isInteger(cardholderCount) || cardholderCount < 1) {
                valid = false;
                error = 'Enter the number of eligible cardholders present.';
            } else if (discountScope === 'individual_share') {
                totalPeople = Number(q('#v-total-people').value);
                if (!Number.isInteger(totalPeople) || totalPeople < 1) {
                    valid = false;
                    error = 'Enter the total number of people in the group.';
                } else if (cardholderCount > totalPeople) {
                    valid = false;
                    error = 'Cardholders cannot exceed the number of people in the group.';
                } else {
                    eligibleGross = Math.round((order.total * cardholderCount / totalPeople + Number.EPSILON) * 100) / 100;
                }
            } else {
                eligibleItems = Array.from(modal.querySelectorAll('.v-eligible-serving')).flatMap(input => {
                    const servings = Number(input.value);
                    const item = order.items.find(orderItem => Number(orderItem.id) === Number(input.dataset.itemId));
                    if (!item || !Number.isInteger(servings) || servings < 0) {
                        valid = false;
                        error = 'Enter valid whole-number servings for the selected items.';
                        return [];
                    }
                    const bundleQuantity = Number(item.bundleQuantity) || 1;
                    const maximumServings = item.quantity * bundleQuantity;
                    const eligibleLimit = bundleQuantity > 1
                        ? Math.min(maximumServings, cardholderCount)
                        : maximumServings;
                    if (servings > eligibleLimit) {
                        valid = false;
                        error = bundleQuantity > 1
                            ? `Shared bundles allow up to ${eligibleLimit} serving(s) for the eligible cardholders.`
                            : `Only ${maximumServings} serving(s) were ordered for ${item.name}.`;
                        return [];
                    }
                    if (servings > 0) {
                        eligibleItems.push({ orderItemId: Number(item.id), servings });
                        eligibleGross += Math.round((item.price / bundleQuantity * servings + Number.EPSILON) * 100) / 100;
                    }
                    return [];
                });
                eligibleGross = Math.round((eligibleGross + Number.EPSILON) * 100) / 100;
                if (valid && eligibleGross <= 0) {
                    valid = false;
                    error = 'Select at least one serving for the cardholder(s).';
                }
            }
            if (valid) {
                const vatExclusiveAmount = Math.round((eligibleGross / 1.12 + Number.EPSILON) * 100) / 100;
                vatExemptAmount = Math.round((eligibleGross - vatExclusiveAmount + Number.EPSILON) * 100) / 100;
                disc = Math.round((vatExclusiveAmount * 0.20 + Number.EPSILON) * 100) / 100;
                total = Math.round((order.total - vatExemptAmount - disc + Number.EPSILON) * 100) / 100;
            }
        }
        q('#v-discount-row').style.display = hasDisc ? 'flex' : 'none';
        q('#v-eligible-row').style.display = hasDisc && valid ? 'flex' : 'none';
        q('#v-vat-row').style.display = hasDisc && valid ? 'flex' : 'none';
        q('#v-eligible').textContent = peso(eligibleGross);
        q('#v-vat').textContent = `-${peso(vatExemptAmount)}`;
        q('#v-discount-label').textContent = `${discountType} discount (20%)`;
        q('#v-discount').textContent = `-${peso(disc)}`;
        q('#v-total').textContent = peso(total);
        q('#v-disc-block').classList.toggle('hidden', !hasDisc);
        q('#v-pwd-fields').classList.toggle('hidden', !hasDisc || discountType !== 'PWD');
        q('#v-senior-fields').classList.toggle('hidden', !hasDisc || discountType !== 'Senior');
        q('#v-share-fields').classList.toggle('hidden', discountScope !== 'individual_share');
        q('#v-selected-fields').classList.toggle('hidden', discountScope !== 'selected_items');
        q('#v-calculation-error').textContent = hasDisc && !valid ? error : '';

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
        return {
            total,
            disc,
            vatExemptAmount,
            eligibleGross,
            hasDisc,
            valid,
            discountScope,
            totalPeople,
            cardholderCount,
            eligibleItems,
        };
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
    modal.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
        discountScope = b.dataset.scope;
        modal.querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('active', x === b));
        q('#v-err').textContent = '';
        recompute();
    }));
    q('#v-cardholders').addEventListener('input', () => { q('#v-err').textContent = ''; recompute(); });
    q('#v-total-people').addEventListener('input', () => { q('#v-err').textContent = ''; recompute(); });
    q('#v-eligible-items').innerHTML = order.items.map(item => {
        const bundleQuantity = Number(item.bundleQuantity) || 1;
        const availableServings = item.quantity * bundleQuantity;
        const label = bundleQuantity > 1
            ? `${item.quantity} bundle(s) · ${availableServings} Tall cups`
            : `${item.quantity} ${item.size} serving(s)`;
        return `
          <label class="eligible-item-row">
            <span><strong>${item.name}</strong><small>${label} · ${peso(item.price)} per ${bundleQuantity > 1 ? 'bundle' : 'serving'}</small></span>
            <span class="eligible-serving-input"><input class="v-eligible-serving" type="number" min="0" max="${availableServings}" value="0" step="1" inputmode="numeric" data-item-id="${item.id}" aria-label="Eligible servings for ${item.name}"> servings</span>
          </label>`;
    }).join('');
    q('#v-eligible-items').addEventListener('input', () => { q('#v-err').textContent = ''; recompute(); });

    q('#v-cancel').addEventListener('click', closeModal);
    q('#v-ok').addEventListener('click', () => {
        q('#v-err').textContent = '';
        const calculation = recompute();
        const { total, disc, vatExemptAmount, hasDisc } = calculation;
        const amt = parseFloat(q('#v-amount').value);
        if (!calculation.valid) return (q('#v-err').textContent = q('#v-calculation-error').textContent);
        if (isNaN(amt) || amt <= 0) return (q('#v-err').textContent = 'Enter a valid payment amount.');
        if (amt < total) return (q('#v-err').textContent = `Insufficient payment (${peso(amt)} < ${peso(total)}).`);
        const pwdIdNumber = q('#v-pwd-id').value.trim();
        const seniorName = q('#v-senior-name').value.trim();
        const seniorBirthdate = q('#v-senior-birthdate').value;
        if (hasDisc && discountType === 'PWD' && !pwdIdNumber) {
            return (q('#v-err').textContent = 'Enter the PWD ID number.');
        }
        if (hasDisc && discountType === 'PWD' && !/^\d{2}-\d{4}-\d{3}-\d{7}$/.test(pwdIdNumber)) {
            return (q('#v-err').textContent = 'Enter the PWD ID in the format RR-PPMM-BBB-NNNNNNN.');
        }
        if (hasDisc && discountType === 'Senior' && (!seniorName || !seniorBirthdate)) {
            return (q('#v-err').textContent = 'Enter the senior citizen name and birthdate.');
        }
        const age = hasDisc && discountType === 'Senior' ? seniorAge(seniorBirthdate) : null;
        if (hasDisc && discountType === 'Senior' && age === null) {
            return (q('#v-err').textContent = 'Enter a valid birthdate that is not in the future.');
        }
        if (hasDisc && discountType === 'Senior' && age < 60) {
            return (q('#v-err').textContent = `The senior citizen discount requires the cardholder to be at least 60 years old. Current age: ${age}.`);
        }
        onConfirm({
            paymentAmount: amt,
            paymentMethod: 'Cash',
            discountType: hasDisc ? discountType : null,
            discountAmount: disc,
            vatExemptAmount,
            discountScope: hasDisc ? calculation.discountScope : null,
            totalPeople: hasDisc && calculation.discountScope === 'individual_share' ? calculation.totalPeople : null,
            cardholderCount: hasDisc ? calculation.cardholderCount : null,
            eligibleItems: hasDisc && calculation.discountScope === 'selected_items' ? calculation.eligibleItems : [],
            pwdIdNumber: hasDisc && discountType === 'PWD' ? pwdIdNumber : null,
            seniorName: hasDisc && discountType === 'Senior' ? seniorName : null,
            seniorBirthdate: hasDisc && discountType === 'Senior' ? seniorBirthdate : null,
        });
    });
    ['#v-pwd-id', '#v-senior-name', '#v-senior-birthdate'].forEach(selector => {
        q(selector).addEventListener('input', () => { q('#v-err').textContent = ''; });
    });
    q('#v-pwd-id').addEventListener('input', formatPwdIdInput);
    q('#v-senior-birthdate').addEventListener('input', () => {
        const age = seniorAge(q('#v-senior-birthdate').value);
        q('#v-senior-age').textContent = age === null
            ? 'Enter a valid birthdate to confirm age eligibility.'
            : age >= 60
                ? `Age: ${age} — meets the minimum age requirement.`
                : `Age: ${age} — must be at least 60 years old.`;
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
            <textarea id="v-other" rows="3" maxlength="255" placeholder="Please specify…" style="display:none;margin-top:6px"></textarea>
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

export function openBulkVoidModal(orders, onVoid, onComplete) {
    const reasons = ['Customer Request', 'Wrong Order', 'Payment Issue', 'Out of Stock', 'System Error', 'Other'];
    const modal = mount(`
      <div class="modal-backdrop"><div class="modal">
        <div class="modal-header" style="background:linear-gradient(90deg,#dc2626,#b91c1c)"><h2 id="bv-title"></h2></div>
        <div class="modal-body" id="bv-body"></div>
        <div class="modal-footer" id="bv-footer"></div>
      </div></div>
    `, { closeOnBackdrop: false });
    let currentIndex = 0;
    let completed = 0;
    let busy = false;

    const finish = () => {
        closeModal();
        onComplete(completed);
    };

    function renderStep() {
        const title = modal.querySelector('#bv-title');
        const body = modal.querySelector('#bv-body');
        const footer = modal.querySelector('#bv-footer');
        if (currentIndex >= orders.length) {
            title.textContent = 'Void Complete';
            body.innerHTML = `<div class="summary-box"><strong>${completed} of ${orders.length} orders voided.</strong></div>`;
            footer.innerHTML = '<button class="btn btn-success" id="bv-done" type="button">Done</button>';
            footer.querySelector('#bv-done').addEventListener('click', finish);
            return;
        }

        const order = orders[currentIndex];
        title.textContent = `Void Orders — ${currentIndex + 1} of ${orders.length}`;
        body.innerHTML = `
          <div class="summary-box" style="background:#fee2e2;color:#991b1b">
            <div class="row"><span>Order Number</span><strong>${order.orderId}</strong></div>
            <div class="row"><span>Order Total</span><span>${peso(order.total)}</span></div>
            <div style="font-size:12px;margin-top:6px">This action cannot be undone.</div>
          </div>
          <div class="field">
            <label for="bv-reason">Reason for voiding this order *</label>
            <select id="bv-reason">
              <option value="">Select a reason</option>
              ${reasons.map(reason => `<option value="${reason}">${reason}</option>`).join('')}
            </select>
            <textarea id="bv-other" rows="3" maxlength="255" placeholder="Please specify…" class="hidden"></textarea>
            <div id="bv-error" class="error-msg" role="alert"></div>
          </div>`;
        footer.innerHTML = `
          <button class="btn btn-outline" id="bv-cancel" type="button">Cancel</button>
          <button class="btn btn-danger" id="bv-confirm" type="button">Void Order and Continue</button>`;

        const reasonInput = body.querySelector('#bv-reason');
        const otherInput = body.querySelector('#bv-other');
        reasonInput.addEventListener('change', () => {
            otherInput.classList.toggle('hidden', reasonInput.value !== 'Other');
        });
        footer.querySelector('#bv-cancel').addEventListener('click', () => {
            if (completed && !confirm(`${completed} order(s) have already been voided. Cancel the remaining orders?`)) return;
            finish();
        });
        footer.querySelector('#bv-confirm').addEventListener('click', async event => {
            if (busy) return;
            const reason = reasonInput.value === 'Other' ? otherInput.value.trim() : reasonInput.value;
            if (!reason) {
                body.querySelector('#bv-error').textContent = reasonInput.value === 'Other'
                    ? 'Enter a reason for this order.'
                    : 'Select a reason for this order.';
                return;
            }
            busy = true;
            event.currentTarget.disabled = true;
            footer.querySelector('#bv-cancel').disabled = true;
            body.querySelector('#bv-error').textContent = '';
            try {
                await onVoid(order, reason);
                completed += 1;
                currentIndex += 1;
                renderStep();
            } catch (error) {
                body.querySelector('#bv-error').textContent = `Could not void ${order.orderId}: ${error.message}`;
                event.currentTarget.disabled = false;
                footer.querySelector('#bv-cancel').disabled = false;
            } finally {
                busy = false;
            }
        });
    }

    renderStep();
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
function normalizeAddOns(addOns = []) {
    return addOns.map(addon => ({
        name: typeof addon === 'string' ? addon : addon.name,
        quantity: typeof addon === 'string' ? 1 : Number(addon.quantity),
    })).filter(addon => addon.name && Number.isInteger(addon.quantity) && addon.quantity > 0);
}

function addOnKey(addOns) {
    return normalizeAddOns(addOns)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(addon => `${addon.name}:${addon.quantity}`)
        .join('|');
}

function mergeMatchingItems(items) {
    const merged = [];
    items.forEach(item => {
        const identity = item.variantId ?? `${item.productId}:${item.size}`;
        const existing = merged.find(candidate =>
            (candidate.variantId ?? `${candidate.productId}:${candidate.size}`) === identity
            && addOnKey(candidate.addOns) === addOnKey(item.addOns)
        );
        if (existing) existing.quantity += item.quantity;
        else merged.push(item);
    });
    items.splice(0, items.length, ...merged);
}

function itemBasePrice(item, product) {
    if (Number.isFinite(item.basePrice)) return item.basePrice;
    const variant = product?.sizes.find(size =>
        Number(size.variantId) === Number(item.variantId) || size.name === item.size
    );
    return variant ? Number(variant.price) : Number(item.price);
}

function itemPrice(item, product, addOnPrices) {
    const addOnTotal = normalizeAddOns(item.addOns).reduce(
        (sum, addon) => sum + (addOnPrices.get(addon.name) || 0) * addon.quantity,
        0
    );
    return itemBasePrice(item, product) + addOnTotal;
}

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

function renderItems(container, items, menu, addOns, onChange) {
    if (!items.length) {
        container.innerHTML = `<p style="color:#6b7280;text-align:center;padding:20px">No items yet.</p>`;
        return;
    }
    const openAddOnItems = new Set(
        Array.from(container.querySelectorAll('.walkin-addons[open]'))
            .map(details => items[Number(details.closest('.editable-item').dataset.idx)])
            .filter(Boolean)
    );
    container.innerHTML = items.map((it, idx) => {
        const product = menu.find(p => p.id === it.productId) || menu.find(p => p.name === it.name);
        const img = it.image || product?.image;
        const selectedAddOns = normalizeAddOns(it.addOns);
        const selectedCount = selectedAddOns.reduce((sum, addon) => sum + addon.quantity, 0);
        const canCustomize = (product?.bundleQuantity || it.bundleQuantity || 1) === 1;
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
              ${canCustomize ? `
                <details class="walkin-addons">
                  <summary>Edit add-ons${selectedCount ? ` · ${selectedCount} selected` : ''}</summary>
                  <div class="walkin-addon-list">
                    ${addOns.map(addon => {
                        const quantity = selectedAddOns.find(selected => selected.name === addon.name)?.quantity || 0;
                        return `
                          <div class="walkin-addon">
                            <div class="walkin-addon-info">
                              <span>${addon.name}</span>
                              <small>₱${Number(addon.price).toFixed(2)} each</small>
                            </div>
                            <div class="walkin-addon-qty">
                              <button type="button" data-act="addon" data-addon="${addon.name}" data-delta="-1" aria-label="Remove ${addon.name}" ${quantity === 0 ? 'disabled' : ''}>−</button>
                              <span>${quantity}</span>
                              <button type="button" data-act="addon" data-addon="${addon.name}" data-delta="1" aria-label="Add ${addon.name}" ${selectedCount >= 10 ? 'disabled' : ''}>+</button>
                            </div>
                          </div>`;
                    }).join('')}
                    ${addOns.length ? '' : '<p class="walkin-no-addons">No add-ons are currently available.</p>'}
                  </div>
                </details>` : ''}
            </div>
          </div>`;
    }).join('');

    container.querySelectorAll('.editable-item').forEach(el => {
        if (openAddOnItems.has(items[Number(el.dataset.idx)])) {
            el.querySelector('.walkin-addons')?.setAttribute('open', '');
        }
    });

    container.querySelectorAll('.editable-item').forEach(el => {
        const idx = Number(el.dataset.idx);
        el.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
            const act = btn.dataset.act;
            if (act === 'inc') items[idx].quantity += 1;
            else if (act === 'dec') items[idx].quantity = Math.max(1, items[idx].quantity - 1);
            else if (act === 'rm') items.splice(idx, 1);
            else if (act === 'size') {
                items[idx].size = btn.dataset.size;
                items[idx].variantId = Number(btn.dataset.vid);
                items[idx].basePrice = Number(btn.dataset.price);
            } else if (act === 'addon') {
                const addonName = btn.dataset.addon;
                const addonQuantity = Number(btn.dataset.delta);
                const selected = normalizeAddOns(items[idx].addOns);
                const addon = selected.find(entry => entry.name === addonName);
                const totalSelected = selected.reduce((sum, entry) => sum + entry.quantity, 0);
                if (!addon && addonQuantity > 0) selected.push({ name: addonName, quantity: 1 });
                else if (addon) {
                    addon.quantity += addonQuantity;
                    if (addon.quantity <= 0) selected.splice(selected.indexOf(addon), 1);
                }
                if (addonQuantity < 0 || totalSelected < 10) {
                    items[idx].addOns = selected;
                }
            }
            const product = menu.find(p => p.id === items[idx]?.productId)
                || menu.find(p => p.name === items[idx]?.name);
            if (items[idx]) items[idx].price = itemPrice(items[idx], product, new Map(addOns.map(addon => [addon.name, Number(addon.price)])));
            onChange();
        }));
    });
}

function itemEditor(title, initialItems, menu, addOns, submitLabel, onSubmit, opts = {}) {
    const modal = mount(itemEditorHtml(title, submitLabel));
    const addOnPrices = new Map(addOns.map(addon => [addon.name, Number(addon.price)]));
    const items = initialItems.map(x => {
        const normalizedAddOns = normalizeAddOns(x.addOns);
        const previousAddOnTotal = normalizedAddOns.reduce(
            (sum, addon) => sum + (addOnPrices.get(addon.name) || 0) * addon.quantity,
            0
        );
        return {
            ...x,
            addOns: normalizedAddOns,
            basePrice: Number(x.price) - previousAddOnTotal,
        };
    });
    const container = modal.querySelector('#items-container');
    const totalEl = modal.querySelector('#ie-total');

    function refresh() {
        if (opts.combineItems) mergeMatchingItems(items);
        renderItems(container, items, menu, addOns, refresh);
        const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
        totalEl.textContent = peso(total);
    }
    items.forEach(item => {
        const product = menu.find(p => p.id === item.productId) || menu.find(p => p.name === item.name);
        item.price = itemPrice(item, product, addOnPrices);
    });
    refresh();

    const addItem = () => {
        openMenuPicker(menu, item => {
            items.push(item);
            refresh();
        });
    };
    modal.querySelector('#add-item').addEventListener('click', addItem);
    if (opts.openItemPickerOnOpen) addItem();
    modal.querySelector('#cancel').addEventListener('click', closeModal);
    modal.querySelector('#submit').addEventListener('click', () => {
        if (!items.length) { alert('Add at least one item.'); return; }
        onSubmit(items);
    });
}

export function openWalkInModal(menu, addOns, onCreate) {
    itemEditor('New Walk-in Order', [], menu, addOns, 'Create Order', onCreate, {
        combineItems: true,
        openItemPickerOnOpen: true,
    });
}

export function openEditModal(order, menu, addOns, onSave) {
    // Ensure edit items have variantId
    const seeded = order.items.map(i => {
        if (i.variantId) return i;
        const product = menu.find(p => p.id === i.productId) || menu.find(p => p.name === i.name);
        const sz = product?.sizes.find(s => s.name === i.size);
        return { ...i, variantId: sz?.variantId };
    });
    itemEditor(`Edit ${order.orderId}`, seeded, menu, addOns, 'Save Changes', onSave);
}
