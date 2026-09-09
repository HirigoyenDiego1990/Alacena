const test = require('node:test');
const assert = require('node:assert/strict');
const { handleRecipeRequest, _testing } = require('../lib/recipe-service');

function createRecipe(index, type) {
    const isSuggestion = type === 'sugerencia';
    return {
        title: `Receta ${index} ${index}`,
        time: '20 min',
        difficulty: 'Fácil',
        instructions: '1. Preparar. 2. Cocinar.',
        type,
        missing_ingredients: isSuggestion ? ['queso'] : [],
        required_ingredients: [
            { name: 'arroz', quantity: 200, unit: 'g', availability: 'pantry' },
            ...(isSuggestion
                ? [{ name: 'queso', quantity: 100, unit: 'g', availability: 'missing' }]
                : [])
        ],
        servings: 2,
        duration_minutes: 20,
        tags: ['económica'],
        chef_tip: 'Aprovechá las sobras.'
    };
}

function createAiResponse(pantryCount, suggestionCount) {
    return JSON.stringify([
        ...Array.from({ length: pantryCount }, (_, index) => createRecipe(index + 1, 'alacena')),
        ...Array.from({ length: suggestionCount }, (_, index) => createRecipe(pantryCount + index + 1, 'sugerencia'))
    ]);
}

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

test('selecciona exactamente 2 recetas y 1 sugerencia para Free', () => {
    const recipes = _testing.parsearYSeleccionarRecetas(
        createAiResponse(5, 3),
        2,
        1
    );

    assert.equal(recipes.length, 3);
    assert.equal(recipes.filter(recipe => recipe.type === 'alacena').length, 2);
    assert.equal(recipes.filter(recipe => recipe.type === 'sugerencia').length, 1);
});

test('selecciona exactamente 7 recetas y 3 sugerencias para Premium', () => {
    const recipes = _testing.parsearYSeleccionarRecetas(
        createAiResponse(7, 3),
        7,
        3
    );

    assert.equal(recipes.length, 10);
    assert.equal(recipes.filter(recipe => recipe.type === 'alacena').length, 7);
    assert.equal(recipes.filter(recipe => recipe.type === 'sugerencia').length, 3);
});

test('rechaza una respuesta incompleta de la IA', () => {
    const recipes = _testing.parsearYSeleccionarRecetas(
        createAiResponse(2, 1),
        7,
        3
    );

    assert.equal(recipes, null);
});

test('el prompt no mezcla las cantidades de resultados entre planes', () => {
    const ingredients = [{ name: 'arroz', quantity: 200, unit: 'g' }];
    const freePrompt = _testing.crearPrompt(ingredients, 2, 1);
    const premiumPrompt = _testing.crearPrompt(ingredients, 7, 3);

    assert.match(freePrompt, /genera exactamente 3 recetas/);
    assert.match(freePrompt, /- 2 recetas de tipo "alacena"/);
    assert.match(freePrompt, /- 1 receta de tipo "sugerencia"/);
    assert.match(premiumPrompt, /genera exactamente 10 recetas/);
    assert.match(premiumPrompt, /- 7 recetas de tipo "alacena"/);
    assert.match(premiumPrompt, /- 3 recetas de tipo "sugerencia"/);
});

test('rechaza recetas repetidas dentro de una misma generación', () => {
    const repeated = createRecipe(1, 'alacena');
    const response = JSON.stringify([
        repeated,
        { ...createRecipe(2, 'alacena'), title: repeated.title },
        createRecipe(3, 'sugerencia')
    ]);

    const recipes = _testing.parsearYSeleccionarRecetas(response, 2, 1);
    assert.equal(recipes, null);
});

test('detecta títulos que son reformulaciones del mismo plato', () => {
    assert.equal(_testing.sonTitulosSimilares('Tortilla rápida de papas', 'Tortilla de papa casera'), true);
    assert.equal(_testing.sonTitulosSimilares('Sopa de zapallo', 'Arroz salteado con verduras'), false);
});

test('evita recetas recientes cuando los ingredientes son parecidos', () => {
    const history = [
        { title: 'Tortilla de papas', input_ingredients: ['papa', 'huevo', 'cebolla'] },
        { title: 'Sopa de calabaza', input_ingredients: ['calabaza', 'crema'] }
    ];
    const currentIngredients = [
        { name: 'papa' },
        { name: 'huevo' },
        { name: 'queso' }
    ];

    assert.deepEqual(
        _testing.seleccionarTitulosRecientes(history, currentIngredients, 20),
        ['Tortilla de papas']
    );
});

test('el prompt prohíbe repetir recetas recientes y exige variedad real', () => {
    const prompt = _testing.crearPrompt(
        [{ name: 'papa', quantity: 2, unit: 'unidad' }],
        2,
        1,
        {},
        ['Tortilla de papas']
    );

    assert.match(prompt, /NO debes repetir/);
    assert.match(prompt, /Tortilla de papas/);
    assert.match(prompt, /identidad culinaria realmente distinta/);
    assert.match(prompt, /mayor variedad posible/);
});
