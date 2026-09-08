const test = require('node:test');
const assert = require('node:assert/strict');
const { getPremiumPaymentConfig } = require('../lib/premium-payment-config');

test('no habilita pagos mientras falten datos obligatorios', () => {
    const config = getPremiumPaymentConfig({});

    assert.equal(config.configured, false);
    assert.equal(config.price, null);
    assert.equal(config.duration, '30 días');
});

test('publica únicamente la configuración necesaria para transferir', () => {
    const config = getPremiumPaymentConfig({
        PREMIUM_PRICE_ARS: '4500',
        PREMIUM_PAYMENT_PROVIDER: 'Billetera virtual',
        PREMIUM_PAYMENT_HOLDER: 'Titular de prueba',
        PREMIUM_PAYMENT_ALIAS: 'alacena.premium',
        PREMIUM_PAYMENT_ACCOUNT_ID: '000 123 456',
        PREMIUM_PLAN_DURATION: '30 días',
        PRIVATE_SECRET: 'no debe salir'
    });

    assert.deepEqual(config, {
        configured: true,
        price: 4500,
        currency: 'ARS',
        duration: '30 días',
        provider: 'Billetera virtual',
        holder: 'Titular de prueba',
        alias: 'alacena.premium',
        accountId: '000123456'
    });
    assert.equal('PRIVATE_SECRET' in config, false);
});
