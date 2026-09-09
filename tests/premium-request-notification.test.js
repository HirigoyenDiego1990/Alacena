const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildPremiumRequestEmail,
    escapeHtml,
    getPremiumNotificationConfig
} = require('../lib/premium-request-notification');

test('el aviso por correo solo queda habilitado con clave y destinatario válidos', () => {
    assert.equal(getPremiumNotificationConfig({}).configured, false);
    assert.equal(getPremiumNotificationConfig({
        RESEND_API_KEY: 're_prueba',
        PREMIUM_ADMIN_EMAIL: 'admin@example.com'
    }).configured, true);
});

test('protege el correo frente a contenido HTML ingresado por el usuario', () => {
    assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');

    const email = buildPremiumRequestEmail({
        payer_name: '<img src=x>',
        contact_email: 'persona@example.com',
        request_type: 'activation'
    });

    assert.doesNotMatch(email.html, /<img src=x>/);
    assert.match(email.html, /&lt;img src=x&gt;/);
});

test('distingue una renovación de una activación en el asunto', () => {
    const email = buildPremiumRequestEmail({ request_type: 'renewal' });
    assert.match(email.subject, /renovación Premium/);
});
