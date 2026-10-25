const roundCurrency = amount => Math.round((amount + Number.EPSILON) * 100) / 100;

function invalid(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function calculateDiscount({ orderTotal, orderItems = [] }) {
    const firstItem = [...orderItems]
        .sort((a, b) => Number(a.id) - Number(b.id))[0];
    if (!firstItem) {
        throw invalid('Cannot apply a discount to an order without items');
    }

    const bundleQuantity = Number(firstItem.bundleQuantity) || 1;
    const eligibleGross = roundCurrency(Number(firstItem.price) / bundleQuantity);
    if (eligibleGross <= 0 || eligibleGross > orderTotal) {
        throw invalid('Eligible amount must be greater than zero and cannot exceed the order total');
    }

    const vatExclusiveAmount = roundCurrency(eligibleGross / 1.08);
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
            scope: 'single_serving',
            orderItemId: Number(firstItem.id),
            servings: 1,
            eligibleGross,
            vatExclusiveAmount,
        },
    };
}

module.exports = { calculateDiscount, roundCurrency };
