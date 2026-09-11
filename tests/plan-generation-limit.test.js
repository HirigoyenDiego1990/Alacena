const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const plansSql = fs.readFileSync(path.join(projectRoot, 'supabase-plans.sql'), 'utf8');
const migrationSql = fs.readFileSync(path.join(projectRoot, 'supabase-generation-limit.sql'), 'utf8');
const plansHtml = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');

test('limita a tres generaciones diarias en las funciones base', () => {
    assert.match(plansSql, /v_generation_limit\s*:=\s*3/);
    assert.match(plansSql, /v_limit\s*:=\s*3/);
    assert.doesNotMatch(plansSql, /then\s+50\s+else\s+3/i);
});

test('la migración actualiza consulta y reserva con el mismo límite', () => {
    assert.match(migrationSql, /create or replace function public\.get_my_plan_limits\(\)/);
    assert.match(migrationSql, /create or replace function public\.reserve_recipe_generation\(\)/);
    assert.match(migrationSql, /v_generation_limit integer := 3/);
    assert.match(migrationSql, /v_limit integer := 3/);
    assert.match(migrationSql, /least\(coalesce\(v_generation_used, 0\), v_generation_limit\)/);
});

test('la comparación comunica los totales diarios correctos', () => {
    assert.match(plansHtml, /hasta <strong>9 recetas<\/strong>/);
    assert.match(plansHtml, /hasta <strong>30 recetas<\/strong>/);
    assert.doesNotMatch(plansHtml, /<strong>50<\/strong> generaciones/);
});
