const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const plansSql = fs.readFileSync(path.join(projectRoot, 'supabase-plans.sql'), 'utf8');
const migrationSql = fs.readFileSync(path.join(projectRoot, 'supabase-generation-limit.sql'), 'utf8');
const plansHtml = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');

test('limita las generaciones diarias y resultados según el plan', () => {
    // Plan Free: 1 generación diaria, 1 receta normal + 1 sugerencia (2 recetas en total)
    assert.match(plansSql, /v_generation_limit\s*:=\s*1/);
    assert.match(plansSql, /alacena_results\s*:=\s*1/);
    assert.match(plansSql, /suggestion_results\s*:=\s*1/);
});

test('la migración actualiza consulta y reserva con los nuevos límites', () => {
    assert.match(migrationSql, /create or replace function public\.get_my_plan_limits\(\)/);
    assert.match(migrationSql, /create or replace function public\.reserve_recipe_generation\(\)/);
    assert.match(migrationSql, /v_generation_limit integer := 1/);
    assert.match(migrationSql, /v_limit integer := 1/);
    assert.match(migrationSql, /least\(coalesce\(v_generation_used, 0\), v_generation_limit\)/);
});

test('la comparación comunica los totales diarios correctos en la interfaz', () => {
    // Plan Free: 2 recetas totales (1 receta + 1 sugerencia)
    assert.match(plansHtml, /hasta <strong>2 recetas<\/strong>/);
    // Plan Premium: 2 generaciones diarias con 5 recetas + 2 sugerencias (14 recetas total)
    assert.match(plansHtml, /hasta <strong>14 recetas<\/strong>/);
    assert.doesNotMatch(plansHtml, /<strong>50<\/strong> generaciones/);
});