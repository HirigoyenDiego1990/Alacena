const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const migrationSql = fs.readFileSync(path.join(projectRoot, 'supabase-admin-analytics.sql'), 'utf8');
const analyticsSql = fs.readFileSync(path.join(projectRoot, 'supabase-analytics.sql'), 'utf8');
const appJs = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');

test('el resumen de Analytics exige autorización de administrador', () => {
    assert.match(migrationSql, /create or replace function public\.get_admin_analytics\(p_days integer default 30\)/i);
    assert.match(migrationSql, /if not public\.is_app_admin\(\) then/i);
    assert.match(migrationSql, /security definer/i);
    assert.match(migrationSql, /revoke all on function public\.get_admin_analytics\(integer\)/i);
    assert.match(migrationSql, /grant execute on function public\.get_admin_analytics\(integer\) to authenticated/i);
});

test('los nombres de eventos nuevos usan una validación segura y extensible', () => {
    assert.match(analyticsSql, /event_name\s+~\s+'\^\[a-z\]\[a-z0-9_\]\{1,79\}\$'/i);
    assert.match(migrationSql, /drop constraint if exists analytics_events_event_name_check/i);
    assert.match(migrationSql, /add constraint analytics_events_event_name_check/i);
});

test('el panel privado ofrece períodos y métricas principales', () => {
    assert.match(appHtml, /data-admin-view="analytics"/);
    assert.match(appHtml, /data-analytics-days="7"/);
    assert.match(appHtml, /data-analytics-days="30"/);
    assert.match(appHtml, /data-analytics-days="90"/);
    assert.match(appHtml, /id="analytics-recipes"/);
    assert.match(appHtml, /id="analytics-top-screens"/);
    assert.match(appHtml, /id="analytics-pantry-average"/);
    assert.match(appJs, /supabase\.rpc\('get_admin_analytics', \{ p_days: adminAnalyticsDays \}\)/);
    assert.match(migrationSql, /'average_pantry_items'/);
});
