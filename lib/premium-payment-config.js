function getPremiumPaymentConfig(env = process.env) {
    const price = Number(env.PREMIUM_PRICE_ARS);
    const holder = String(env.PREMIUM_PAYMENT_HOLDER || '').trim();
    const alias = String(env.PREMIUM_PAYMENT_ALIAS || '').trim();

    return {
        configured: Number.isFinite(price) && price > 0 && Boolean(holder) && Boolean(alias),
        price: Number.isFinite(price) && price > 0 ? price : null,
        currency: 'ARS',
        duration: String(env.PREMIUM_PLAN_DURATION || '30 días').trim(),
        provider: String(env.PREMIUM_PAYMENT_PROVIDER || 'Transferencia').trim(),
        holder,
        alias,
        accountId: String(env.PREMIUM_PAYMENT_ACCOUNT_ID || '').replace(/\s+/g, '')
    };
}

function handlePremiumPaymentConfig(_request, response) {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json(getPremiumPaymentConfig());
}

module.exports = {
    getPremiumPaymentConfig,
    handlePremiumPaymentConfig
};
