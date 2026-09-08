const test = require('node:test');
const assert = require('node:assert/strict');
const { handleRecipeRequest } = require('../lib/recipe-service');

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

test('rechaza métodos distintos de POST', async () => {
    const response = createResponse();

    await handleRecipeRequest({ method: 'GET', headers: {} }, response);

    assert.equal(response.statusCode, 405);
    assert.equal(response.body.code, 'METHOD_NOT_ALLOWED');
});

test('no permite generar recetas sin una sesión autenticada', async () => {
    const response = createResponse();

    await handleRecipeRequest({
        method: 'POST',
        headers: {},
        body: { ingredientes: [{ name: 'arroz', quantity: 200, unit: 'g' }] }
    }, response);

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.code, 'AUTH_REQUIRED');
});

test('rechaza listas vacías antes de contactar servicios externos', async () => {
    const response = createResponse();

    await handleRecipeRequest({
        method: 'POST',
        headers: { authorization: 'Bearer token-de-prueba' },
        body: { ingredientes: [] }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, 'INVALID_INGREDIENTS');
});

test('limita el tamaño de la lista de ingredientes', async () => {
    const response = createResponse();
    const ingredientes = Array.from({ length: 101 }, (_, index) => ({
        name: `ingrediente-${index}`,
        quantity: 1,
        unit: 'unidad'
    }));

    await handleRecipeRequest({
        method: 'POST',
        headers: { authorization: 'Bearer token-de-prueba' },
        body: { ingredientes }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, 'TOO_MANY_INGREDIENTS');
});
