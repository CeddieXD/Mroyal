const roundCurrency = amount => Math.round((amount + Number.EPSILON) * 100) / 100;

function invalid(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function requirePositiveInteger(value, label) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw invalid(`${label} must be a positive whole number`);
    }
    return parsed;
}

function calculateDiscount({
    orderTotal,
    scope,
    totalPeople,
    cardholderCount,
    eligibleItems = [],
    orderItems = [],
}) {
    let eligibleGross;
    let details;

    if (scope === 'individual_share') {
        const people = requirePositiveInteger(totalPeople, 'Number of people');
        const cardholders = requirePositiveInteger(cardholderCount, 'Number of cardholders');
        if (cardholders > people) {
            throw invalid('Number of cardholders cannot exceed the number of people');
        }
        eligibleGross = roundCurrency(orderTotal * cardholders / people);
        details = { scope, totalPeople: people, cardholderCount: cardholders };
    } else if (scope === 'selected_items') {
        const cardholders = requirePositiveInteger(cardholderCount, 'Number of cardholders');
        if (!Array.isArray(eligibleItems) || eligibleItems.length === 0) {
            throw invalid('Select at least one eligible serving');
        }

        const orderItemsById = new Map(orderItems.map(item => [Number(item.id), item]));
        const seenItemIds = new Set();
        const selectedItems = eligibleItems.map(selection => {
            const itemId = Number(selection.orderItemId);
            const servings = Number(selection.servings);
            const item = orderItemsById.get(itemId);
            if (!item || seenItemIds.has(itemId)) {
                throw invalid('Eligible order items are invalid');
            }
            if (!Number.isInteger(servings) || servings < 1) {
                throw invalid('Eligible servings must be positive whole numbers');
            }
            seenItemIds.add(itemId);

            const bundleQuantity = Number(item.bundleQuantity) || 1;
            const availableServings = Number(item.quantity) * bundleQuantity;
            const maximumEligibleServings = bundleQuantity > 1
                ? Math.min(availableServings, cardholders)
                : availableServings;
            if (servings > maximumEligibleServings) {
                throw invalid('Eligible servings exceed the purchased amount or single-serve limit');
            }

            const eligibleAmount = roundCurrency(Number(item.price) / bundleQuantity * servings);
            return {
                orderItemId: itemId,
                servings,
                eligibleGross: eligibleAmount,
            };
        });
        eligibleGross = roundCurrency(
            selectedItems.reduce((sum, item) => sum + item.eligibleGross, 0)
        );
        details = { scope, cardholderCount: cardholders, eligibleItems: selectedItems };
    } else {
        throw invalid('Select a valid discount calculation method');
    }

    if (eligibleGross <= 0 || eligibleGross > orderTotal) {
        throw invalid('Eligible amount must be greater than zero and cannot exceed the order total');
    }

    const vatExclusiveAmount = roundCurrency(eligibleGross / 1.12);
    const vatExemptAmount = roundCurrency(eligibleGross - vatExclusiveAmount);
    const discountAmount = roundCurrency(vatExclusiveAmount * 0.20);
    const amountDue = roundCurrency(orderTotal - vatExemptAmount - discountAmount);

    return {
        eligibleGross,
        vatExclusiveAmount,
        vatExemptAmount,
        discountAmount,
        amountDue,
        details: {
            ...details,
            eligibleGross,
            vatExclusiveAmount,
        },
    };
}

module.exports = { calculateDiscount, roundCurrency };
