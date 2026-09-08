import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Configuración de Supabase
const SUPABASE_URL = 'https://mawixmfhfwxsnxsgpgja.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rYDmjondp3uHdqW4lIT9TA_gFXi0yxJ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Analytics propio y respetuoso de la privacidad.
// Nunca se envían correos, IDs reales, títulos, instrucciones ni errores completos.
const ANALYTICS_TABLE = 'analytics_events';
const ANALYTICS_VERSION = '1.0.0';
const ANALYTICS_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const ANALYTICS_ANONYMOUS_ID_KEY = 'alacena.analytics.anonymousId.v1';
const ANALYTICS_SESSION_ID_KEY = 'alacena.analytics.sessionId.v1';
const ANALYTICS_LAST_ACTIVITY_KEY = 'alacena.analytics.lastActivity.v1';

let analyticsReady = false;
let analyticsAnonymousId = null;
let analyticsSessionId = null;
let analyticsIsNewSession = false;
let currentPlanState = {
    plan: 'free',
    generation_limit: 3,
    generation_used: 0,
    generation_remaining: 3,
    pantry_limit: 20,
    saved_recipe_limit: 10,
    alacena_results: 2,
    suggestion_results: 1
};

function crearIdAnonimo() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
        const random = Math.floor(Math.random() * 16);
        const value = character === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
}

function prepararSesionAnalytics() {
    const ahora = Date.now();
    const ultimaActividad = Number(localStorage.getItem(ANALYTICS_LAST_ACTIVITY_KEY)) || 0;

    analyticsAnonymousId = localStorage.getItem(ANALYTICS_ANONYMOUS_ID_KEY) || crearIdAnonimo();
    localStorage.setItem(ANALYTICS_ANONYMOUS_ID_KEY, analyticsAnonymousId);

    analyticsSessionId = localStorage.getItem(ANALYTICS_SESSION_ID_KEY);
    analyticsIsNewSession = !analyticsSessionId || (ahora - ultimaActividad) > ANALYTICS_SESSION_TIMEOUT_MS;

    if (analyticsIsNewSession) {
        analyticsSessionId = crearIdAnonimo();
        localStorage.setItem(ANALYTICS_SESSION_ID_KEY, analyticsSessionId);
    }

    localStorage.setItem(ANALYTICS_LAST_ACTIVITY_KEY, String(ahora));
}

function sendAnalyticsEvent(eventName, properties = {}) {
    // El fallo de Analytics nunca debe afectar la experiencia principal.
    void supabase.from(ANALYTICS_TABLE).insert([{
        anonymous_id: analyticsAnonymousId,
        session_id: analyticsSessionId,
        event_name: eventName,
        client_occurred_at: new Date().toISOString(),
        properties: {
            ...properties,
            plan_tier: currentPlanState.plan
        },
        app_version: ANALYTICS_VERSION
    }]).then(() => {}).catch(() => {});
}

function trackAnalyticsEvent(eventName, properties = {}) {
    if (!analyticsReady || !analyticsAnonymousId || !analyticsSessionId) return;

    const ahora = Date.now();
    const ultimaActividad = Number(localStorage.getItem(ANALYTICS_LAST_ACTIVITY_KEY)) || 0;
    const sessionExpired = ultimaActividad > 0 && (ahora - ultimaActividad) > ANALYTICS_SESSION_TIMEOUT_MS;

    if (sessionExpired) {
        analyticsSessionId = crearIdAnonimo();
        localStorage.setItem(ANALYTICS_SESSION_ID_KEY, analyticsSessionId);
        sendAnalyticsEvent('session_started');
    }

    localStorage.setItem(ANALYTICS_LAST_ACTIVITY_KEY, String(ahora));
    sendAnalyticsEvent(eventName, properties);
}

async function crearHuellaPrivada(value) {
    const normalizedValue = String(value || '').trim().toLocaleLowerCase('es');
    if (!normalizedValue || !window.crypto?.subtle) return null;

    try {
        const bytes = new TextEncoder().encode(normalizedValue);
        const digest = await window.crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)]
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('')
            .slice(0, 24);
    } catch (error) {
        return null;
    }
}

async function obtenerMetricasIngredientes(ingredients) {
    const entries = Array.isArray(ingredients)
        ? ingredients.map(item => ({
            name: typeof item === 'string' ? item : (item?.ingredient || item?.name),
            quantity: typeof item === 'string' ? 1 : (Number(item?.quantity) || 1),
            unit: typeof item === 'string' ? 'unidad' : (item?.unit || 'unidad')
        })).filter(item => item.name)
        : [];
    const sampledEntries = entries.slice(0, 50);
    const ingredientIds = await Promise.all(sampledEntries.map(item => crearHuellaPrivada(item.name)));
    const ingredientInventory = sampledEntries.map((item, index) => ({
        ingredient_id: ingredientIds[index],
        quantity: item.quantity,
        unit: item.unit
    })).filter(item => item.ingredient_id);

    return {
        ingredient_count: entries.length,
        ingredient_ids: ingredientInventory.map(item => item.ingredient_id),
        ingredient_inventory: ingredientInventory,
        ingredient_sample_truncated: entries.length > sampledEntries.length
    };
}

async function obtenerIdReceta(title) {
    return crearHuellaPrivada(title);
}

function trackTechnicalError(context, error, extra = {}) {
    trackAnalyticsEvent('technical_error', {
        context,
        error_type: error?.name || 'UnknownError',
        ...extra
    });
}

function inicializarAnalytics() {
    prepararSesionAnalytics();
    analyticsReady = true;

    if (analyticsIsNewSession) {
        trackAnalyticsEvent('session_started');
    }

    trackAnalyticsEvent('app_opened', {
        returning_session: !analyticsIsNewSession
    });
    trackAnalyticsEvent('screen_view', { screen: 'cook' });
}

window.addEventListener('error', event => {
    const sourceFile = event.filename ? event.filename.split('/').pop() : null;
    trackTechnicalError('runtime', event.error, {
        source_file: sourceFile,
        line: event.lineno || null,
        column: event.colno || null
    });
});

window.addEventListener('unhandledrejection', event => {
    trackTechnicalError('unhandled_promise', event.reason);
});

// Elementos del DOM
const authView = document.getElementById('auth-view');
const mainView = document.getElementById('main-view');
const authForm = document.getElementById('auth-form');
const ingredientInput = document.getElementById('ingredient-input');
const addIngredientBtn = document.getElementById('add-ingredient-btn');
const ingredientsList = document.getElementById('ingredients-list');
const generateBtn = document.getElementById('generate-btn');
const recipesContainer = document.getElementById('recipes-container');

let userIngredients = [];

// Inicializar Iconos
lucide.createIcons();

// Control de Sesión y Redirección de Seguridad
supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) {
        window.location.href = 'login.html';
    } else {
        await loadPlanState();
        inicializarAnalytics();
        loadPantry();
    }
});

supabase.auth.onAuthStateChange((event, session) => {
    if (!session) {
        window.location.href = 'login.html';
    }
});

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
}

// Manejo de Alacena
function aplicarEstadoPlan(planData) {
    if (!planData || typeof planData !== 'object') return;

    currentPlanState = {
        ...currentPlanState,
        ...planData
    };

    const isPremium = currentPlanState.plan === 'premium';
    const badge = document.getElementById('plan-badge');
    const resultInfo = document.getElementById('generation-result-info');
    const usageInfo = document.getElementById('generation-usage-info');
    const premiumFields = document.getElementById('premium-preferences-fields');
    const premiumMessage = document.getElementById('premium-preferences-message');
    const weeklyPlanLocked = document.getElementById('weekly-plan-locked');
    const weeklyPlanContent = document.getElementById('weekly-plan-content');
    const savedPremiumTools = document.getElementById('saved-premium-tools');

    if (badge) {
        badge.textContent = isPremium ? 'Premium' : 'Free';
        badge.classList.toggle('plan-badge--free', !isPremium);
        badge.classList.toggle('plan-badge--premium', isPremium);
    }

    if (resultInfo) {
        resultInfo.textContent = `${currentPlanState.alacena_results} recetas + ${currentPlanState.suggestion_results} ${currentPlanState.suggestion_results === 1 ? 'sugerencia' : 'sugerencias'}`;
    }

    if (usageInfo) {
        usageInfo.textContent = `${currentPlanState.generation_remaining} de ${currentPlanState.generation_limit} generaciones disponibles hoy`;
        usageInfo.classList.toggle('limit-reached', currentPlanState.generation_remaining <= 0);
    }

    if (premiumFields) premiumFields.disabled = !isPremium;
    if (premiumMessage) premiumMessage.classList.toggle('visible', !isPremium);
    if (weeklyPlanLocked) weeklyPlanLocked.classList.toggle('hidden', isPremium);
    if (weeklyPlanContent) weeklyPlanContent.classList.toggle('hidden', !isPremium);
    if (savedPremiumTools) savedPremiumTools.classList.toggle('hidden', !isPremium);
    updatePlansView();

}

async function loadPlanState() {
    const { data, error } = await supabase.rpc('get_my_plan_limits');

    if (error) {
        trackTechnicalError('plan_load', error);
        aplicarEstadoPlan(currentPlanState);
        return;
    }

    aplicarEstadoPlan(data);
}

async function loadPantry() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('pantry').select('*').eq('user_id', user.id);
    if (data) {
        userIngredients = data;
        renderIngredients();
        renderIngredientBulkPreview();
        void obtenerMetricasIngredientes(data).then(metrics => {
            trackAnalyticsEvent('ingredient_inventory_snapshot', metrics);
        });
    } else if (error) {
        trackTechnicalError('pantry_load', error);
    }
}

const INGREDIENT_UNIT_PATTERN = '(?:unidades?|uds?|u|gramos?|grs?|gr|g|kilogramos?|kilos?|kg|mililitros?|ml|cc|litros?|lts?|lt|l|tazas?|cucharadas?|cdas?|cda|cucharaditas?|cditas?|cdita)\\b';

function normalizarUnidadIngrediente(value) {
    const unit = String(value || '').trim().toLocaleLowerCase('es');
    if (!unit) return 'unidad';
    if (/^(u|ud|uds|unidad|unidades)$/.test(unit)) return 'unidad';
    if (/^(g|gr|grs|gramo|gramos)$/.test(unit)) return 'g';
    if (/^(kg|kilo|kilos|kilogramo|kilogramos)$/.test(unit)) return 'kg';
    if (/^(ml|cc|mililitro|mililitros)$/.test(unit)) return 'ml';
    if (/^(l|lt|lts|litro|litros)$/.test(unit)) return 'l';
    if (/^(taza|tazas)$/.test(unit)) return 'taza';
    if (/^(cda|cdas|cucharada|cucharadas)$/.test(unit)) return 'cda';
    if (/^(cdita|cditas|cucharadita|cucharaditas)$/.test(unit)) return 'cdita';
    return 'unidad';
}

function interpretarLineaIngrediente(line) {
    const cleanLine = String(line || '').trim().replace(/\s+/g, ' ');
    if (!cleanLine) return null;

    const prefixMatch = cleanLine.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${INGREDIENT_UNIT_PATTERN})?\\s*(?:de\\s+)?(.+)$`, 'i'));
    const suffixMatch = cleanLine.match(new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(${INGREDIENT_UNIT_PATTERN})$`, 'i'));
    let name = cleanLine;
    let quantity = 1;
    let unit = 'unidad';

    if (prefixMatch) {
        quantity = Number(prefixMatch[1].replace(',', '.'));
        unit = normalizarUnidadIngrediente(prefixMatch[2]);
        name = prefixMatch[3];
    } else if (suffixMatch) {
        name = suffixMatch[1];
        quantity = Number(suffixMatch[2].replace(',', '.'));
        unit = normalizarUnidadIngrediente(suffixMatch[3]);
    }

    name = name.trim().replace(/^de\s+/i, '').slice(0, 100);
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || quantity > 99999) {
        return { error: true, original: cleanLine };
    }

    return { name, quantity, unit };
}

function parsearCargaMasivaIngredientes(value) {
    const decimalSafeText = String(value || '').replace(/(\d),(\d)/g, '$1.$2');
    const lines = decimalSafeText.split(/[\n,;]+/).map(line => line.trim()).filter(Boolean);
    const parsed = lines.map(interpretarLineaIngrediente).filter(Boolean);
    const invalid = parsed.filter(item => item.error);
    const consolidated = new Map();

    parsed.filter(item => !item.error).forEach(item => {
        const key = `${normalizarClaveCompra(item.name)}|${item.unit}`;
        const current = consolidated.get(key);
        if (current) {
            current.quantity = redondearCantidadCompra(current.quantity + item.quantity);
        } else {
            consolidated.set(key, { ...item });
        }
    });

    const items = [...consolidated.values()];
    items.forEach(item => {
        if (item.quantity > 99999) invalid.push({ error: true, original: item.name });
    });

    return {
        items: items.filter(item => item.quantity <= 99999),
        invalid,
        originalCount: lines.length
    };
}

function renderIngredientBulkPreview() {
    const preview = document.getElementById('ingredient-bulk-preview');
    const label = document.getElementById('add-ingredients-label');
    const parsed = parsearCargaMasivaIngredientes(ingredientInput.value);
    const existingKeys = new Set(userIngredients.map(item =>
        `${normalizarClaveCompra(item.ingredient)}|${normalizarUnidadIngrediente(item.unit)}`
    ));

    addIngredientBtn.disabled = parsed.items.length === 0 || parsed.invalid.length > 0;
    label.textContent = parsed.items.length > 0
        ? `Agregar ${parsed.items.length} ${parsed.items.length === 1 ? 'ingrediente' : 'ingredientes'}`
        : 'Agregar ingredientes';

    if (parsed.originalCount === 0) {
        preview.innerHTML = '<span class="ingredient-preview-empty">La vista previa aparecerá acá.</span>';
        return;
    }

    const visibleItems = parsed.items.slice(0, 8);
    preview.innerHTML = `
        ${visibleItems.map(item => `
            <span class="ingredient-preview-chip">
                <strong>${formatearCantidad(item.quantity)} ${escaparHTML(item.unit)}</strong>
                ${escaparHTML(item.name)}
                ${existingKeys.has(`${normalizarClaveCompra(item.name)}|${item.unit}`) ? '<em>actualiza</em>' : ''}
            </span>
        `).join('')}
        ${parsed.items.length > visibleItems.length ? `<span class="ingredient-preview-more">+${parsed.items.length - visibleItems.length} más</span>` : ''}
        ${parsed.invalid.length > 0 ? '<span class="ingredient-preview-error">Revisá las cantidades marcadas.</span>' : ''}
    `;
}

ingredientInput.addEventListener('input', renderIngredientBulkPreview);
ingredientInput.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !addIngredientBtn.disabled) {
        addIngredientBtn.click();
    }
});

addIngredientBtn.addEventListener('click', async () => {
    const parsed = parsearCargaMasivaIngredientes(ingredientInput.value);
    if (parsed.items.length === 0 || parsed.invalid.length > 0) {
        showAlert('Revisá la lista', 'Todas las cantidades deben ser mayores que cero.', 'warning');
        return;
    }

    const existingKeys = new Set(userIngredients.map(item =>
        `${normalizarClaveCompra(item.ingredient)}|${normalizarUnidadIngrediente(item.unit)}`
    ));
    const newIngredientCount = parsed.items.filter(item =>
        !existingKeys.has(`${normalizarClaveCompra(item.name)}|${item.unit}`)
    ).length;

    if (
        currentPlanState.pantry_limit !== null
        && userIngredients.length + newIngredientCount > currentPlanState.pantry_limit
    ) {
        const availableSlots = Math.max(currentPlanState.pantry_limit - userIngredients.length, 0);
        showAlert('Límite del plan Free', `Podés agregar ${availableSlots} ingredientes nuevos antes de alcanzar el límite de ${currentPlanState.pantry_limit}.`, 'warning');
        return;
    }

    addIngredientBtn.disabled = true;
    const { data, error } = await supabase.rpc('add_pantry_ingredients_bulk', {
        p_items: parsed.items
    });

    if (error) {
        trackTechnicalError('ingredients_bulk_add', error);
        const message = error.message?.includes('FREE_PANTRY_LIMIT')
            ? 'La carga supera el máximo de ingredientes de tu plan Free.'
            : 'No se pudo guardar la lista. No se agregó ningún ingrediente.';
        showAlert('Error', message, 'error');
        renderIngredientBulkPreview();
        return;
    }

    ingredientInput.value = '';
    await loadPantry();
    const metrics = await obtenerMetricasIngredientes(userIngredients);
    trackAnalyticsEvent('ingredients_bulk_added', {
        ...metrics,
        submitted_count: parsed.items.length,
        added_count: Number(data?.added_count) || 0,
        updated_count: Number(data?.updated_count) || 0
    });
    showAlert(
        'Alacena actualizada',
        `${Number(data?.added_count) || 0} nuevos y ${Number(data?.updated_count) || 0} actualizados.`,
        'success'
    );
});

function renderIngredients() {
    if (userIngredients.length === 0) {
        ingredientsList.innerHTML = '<span class="empty-hint">Todavía no agregaste ingredientes...</span>';
        return;
    }

    ingredientsList.innerHTML = userIngredients.map(item => `
        <span class="ingredient-chip">
            <strong>${formatearCantidad(item.quantity || 1)} ${escaparHTML(item.unit || 'unidad')}</strong>
            ${escaparHTML(item.ingredient)}
            <button onclick="deleteIngredient('${escaparHTML(item.id)}')" class="chip-delete-btn">×</button>
        </span>
    `).join('');
}

window.deleteIngredient = async function(id) {
    const removedIngredient = userIngredients.find(item => String(item.id) === String(id));
    const { error } = await supabase.from('pantry').delete().eq('id', id);

    if (!error) {
        await loadPantry();
        const ingredientId = await crearHuellaPrivada(removedIngredient?.ingredient);
        trackAnalyticsEvent('ingredient_removed', {
            ingredient_id: ingredientId,
            ingredient_count: userIngredients.length,
            quantity: Number(removedIngredient?.quantity) || 1,
            unit: removedIngredient?.unit || 'unidad'
        });
    } else {
        trackTechnicalError('ingredient_remove', error);
    }
}

// Sistema de Alerta Customizada (Modal)
window.showAlert = function(title, text, type = 'info') {
    const modalTitle = document.getElementById('modal-title');
    const modalText = document.getElementById('modal-text');
    const modal = document.getElementById('custom-modal');

    if (!modal) return;

    if (modalTitle) modalTitle.innerText = title;
    if (modalText) modalText.innerText = text;

    modal.style.display = 'flex';
    modal.classList.add('active');

    if (window.alertTimeout) clearTimeout(window.alertTimeout);
    
    window.alertTimeout = setTimeout(() => {
        cerrarModalAlerta();
    }, 2500);
}

window.cerrarModalAlerta = function() {
    const modal = document.getElementById('custom-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
}

// Guardar Receta en Favoritos (Supabase)
window.saveRecipe = async function(recipe, event) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (currentPlanState.saved_recipe_limit !== null) {
        const { count, error: countError } = await supabase
            .from('saved_recipes')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id);

        if (!countError && count >= currentPlanState.saved_recipe_limit) {
            showAlert('Límite del plan Free', `Podés guardar hasta ${currentPlanState.saved_recipe_limit} recetas.`, 'warning');
            return;
        }
    }

    const { data, error } = await supabase.from('saved_recipes').insert([{
        user_id: user.id,
        title: recipe.title,
        time: recipe.time,
        difficulty: String(recipe.difficulty),
        ingredients: Array.isArray(userIngredients) ? userIngredients.map(i => i.ingredient) : [],
        steps: [recipe.instructions],
        required_ingredients: Array.isArray(recipe.required_ingredients) ? recipe.required_ingredients : [],
        missing_ingredients: Array.isArray(recipe.missing_ingredients) ? recipe.missing_ingredients : [],
        servings: Number(recipe.servings) || 2,
        duration_minutes: Number(recipe.duration_minutes) || null,
        recipe_type: recipe.type === 'sugerencia' ? 'sugerencia' : 'alacena',
        chef_tip: recipe.chef_tip || null,
        tags: Array.isArray(recipe.tags) ? recipe.tags : []
    }]);

    if (error) {
        trackTechnicalError('recipe_save', error);
        const message = error.message?.includes('FREE_SAVED_RECIPE_LIMIT')
            ? 'Alcanzaste el máximo de 10 recetas guardadas del plan Free.'
            : 'No se pudo guardar la receta.';
        showAlert('Error', message, 'error');
    } else {
        trackAnalyticsEvent('recipe_saved', {
            recipe_id: await obtenerIdReceta(recipe.title)
        });
        showAlert('¡Guardada!', 'La receta se guardó en tus favoritas con éxito.', 'success');
        // Pequeño pulso visual en el botón de guardar como confirmación extra
        const btn = event && event.currentTarget;
        if (btn) {
            btn.classList.remove('saved-pulse');
            void btn.offsetWidth; // fuerza reinicio de la animación si se guarda varias veces
            btn.classList.add('saved-pulse');
        }
    }
}

// Convierte el texto de instrucciones de la IA en un array de pasos limpios.
// Soporta recetas numeradas (en líneas separadas o todas seguidas en el mismo string),
// recetas con viñetas, y texto corrido sin formato.
function parsearPasos(instructions) {
    if (typeof instructions !== 'string') return [instructions];

    const texto = instructions.trim();

    // 1) Buscar marcadores de numeración tipo "1. ", "2) ", etc. en cualquier parte
    //    del texto -- estén separados por saltos de línea o todos en la misma línea.
    const regexNumeracion = /(?:^|[\n\s])(\d{1,2})[\.\)]\s+/g;
    const marcas = [...texto.matchAll(regexNumeracion)];

    if (marcas.length >= 2) {
        const pasos = [];
        for (let i = 0; i < marcas.length; i++) {
            const inicio = marcas[i].index + marcas[i][0].length;
            const fin = (i + 1 < marcas.length) ? marcas[i + 1].index : texto.length;
            const paso = texto.slice(inicio, fin).trim();
            if (paso.length > 0) pasos.push(paso);
        }
        if (pasos.length > 0) return pasos;
    }

    // 2) Sin numeración: si hay líneas separadas, ver si son viñetas ("-", "*", "•")
    const lineas = texto.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
    const prefijoViñeta = /^[-*•]\s*/;

    if (lineas.length > 1) {
        if (lineas.every(l => prefijoViñeta.test(l))) {
            return lineas.map(l => l.replace(prefijoViñeta, '').trim()).filter(p => p.length > 0);
        }
        // Varias líneas sin numeración ni viñetas: respetarlas tal cual.
        return lineas;
    }

    // 3) Texto corrido en un solo bloque: separar por oraciones.
    return texto.split(/\.\s+/).map(p => p.trim()).filter(p => p.length > 0);
}

function formatearCantidad(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '1';
    return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(number);
}

function renderIngredientesEstructurados(requiredIngredients) {
    if (!Array.isArray(requiredIngredients) || requiredIngredients.length === 0) return '';

    return `
        <div class="recipe-ingredients-box">
            <strong class="recipe-ingredients-title">Ingredientes para la receta</strong>
            <ul class="recipe-ingredients-list">
                ${requiredIngredients.map(item => {
                    const isMissing = item.availability === 'missing';
                    return `
                        <li class="recipe-ingredient ${isMissing ? 'recipe-ingredient--missing' : ''}">
                            <span>${formatearCantidad(item.quantity)} ${escaparHTML(item.unit)} · ${escaparHTML(item.name)}</span>
                            <span class="recipe-ingredient-status">${isMissing ? 'Comprar' : 'Disponible'}</span>
                        </li>
                    `;
                }).join('')}
            </ul>
        </div>
    `;
}

function renderRecipeTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return '';
    return `<div class="recipe-tags">${tags.map(tag => `<span>${escaparHTML(tag)}</span>`).join('')}</div>`;
}

async function ejecutarGeneracion() {
    if (userIngredients.length === 0) {
        showAlert('Faltan ingredientes', 'Agregá al menos un ingrediente.', 'warning');
        return;
    }

    if (currentPlanState.generation_remaining <= 0) {
        await loadPlanState();
        if (currentPlanState.generation_remaining <= 0) {
            showAlert('Límite diario alcanzado', `Ya usaste tus ${currentPlanState.generation_limit} generaciones de hoy.`, 'warning');
            return;
        }
    }

    // Restablecer estado visual del botón
    generateBtn.innerHTML = '<span>Generar Receta</span>';
    generateBtn.disabled = true;

    // 1. Mostrar la animación del cocinerito
    mostrarCargando();

    const ingredientesDisponibles = Array.isArray(userIngredients)
        ? userIngredients.map(item => ({
            name: item.ingredient,
            quantity: Number(item.quantity) || 1,
            unit: item.unit || 'unidad'
        }))
        : [];
    const ingredientMetrics = await obtenerMetricasIngredientes(userIngredients);
    let responseStatus = null;

    trackAnalyticsEvent('recipe_generation_started', ingredientMetrics);

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
            throw new Error('Tu sesión venció. Volvé a iniciar sesión.');
        }

        const respuesta = await fetch('/api/generar-receta', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ ingredientes: ingredientesDisponibles })
        });
        responseStatus = respuesta.status;

        if (!respuesta.ok) {
            const errorData = await respuesta.json().catch(() => ({}));
            if (errorData.entitlement) aplicarEstadoPlan(errorData.entitlement);
            const requestError = new Error(errorData.error || `Error HTTP: ${respuesta.status} - No se pudo generar la receta.`);
            requestError.code = errorData.code;
            throw requestError;
        }

        const data = await respuesta.json();
        const recipes = Array.isArray(data.recipes) ? data.recipes : [];
        if (data.entitlement) aplicarEstadoPlan(data.entitlement);

        trackAnalyticsEvent('recipe_generation_succeeded', {
            ...ingredientMetrics,
            result_count: recipes.length
        });

        recipesContainer.innerHTML = recipes.map(recipe => {
            const esSugerencia = recipe.type === 'sugerencia' || (recipe.missing_ingredients && recipe.missing_ingredients.length > 0);

            const badgeHTML = esSugerencia 
                ? `<div class="recipe-badge recipe-badge--missing">
                   <span>🛒 Falta comprar:</span> <strong>${recipe.missing_ingredients.join(', ')}</strong>
                   </div>`
                : `<div class="recipe-badge recipe-badge--success">
                   ✨ 100% con tu alacena
                   </div>`;

            const botonWhatsApp = esSugerencia && recipe.missing_ingredients && recipe.missing_ingredients.length > 0
                ? `<button onclick='enviarPorWhatsApp(${JSON.stringify(recipe.title)}, ${JSON.stringify(recipe.missing_ingredients)})' class="btn-whatsapp">
                     <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                     Enviar faltantes por WhatsApp
                   </button>`
                : '';

            const chefTipHTML = recipe.chef_tip 
                ? `<div class="chef-tip-box">
                        <span class="chef-tip-icon">🌱</span>
                        <div>
                            <strong class="chef-tip-label">Toque del Chef:</strong>
                            <p class="chef-tip-text">${recipe.chef_tip}</p>
                        </div>
                   </div>`
                : '';

            const pasosArray = parsearPasos(recipe.instructions);
            const requiredIngredientsHTML = renderIngredientesEstructurados(recipe.required_ingredients);
            const tagsHTML = renderRecipeTags(recipe.tags);

            return `
                <div class="recipe-card-container">
                    <button onclick='saveRecipe(${JSON.stringify(recipe)}, event)' class="recipe-action-btn btn-save" title="Guardar receta">
                        <i data-lucide="bookmark"></i>
                    </button>
                    <div>
                        <h3 class="recipe-card-title">${recipe.title}</h3>
                    </div>
                    ${badgeHTML}
                    <div class="recipe-meta-row">
                        <span class="recipe-pill recipe-pill--time">${recipe.duration_minutes ? `${recipe.duration_minutes} min` : recipe.time}</span>
                        <span class="recipe-pill recipe-pill--difficulty">${recipe.difficulty}</span>
                        <span class="recipe-pill recipe-pill--servings">${recipe.servings || 2} porciones</span>
                    </div>
                    ${tagsHTML}
                    ${requiredIngredientsHTML}
                    <p class="recipe-instructions">${recipe.instructions}</p>

                    ${chefTipHTML}
                    <button type="button" class="btn-cook-today btn-abrir-cocina" data-title="${encodeURIComponent(recipe.title)}" data-steps="${encodeURIComponent(JSON.stringify(pasosArray))}">
                    <i data-lucide="chef-hat"></i>
                    <span>👨‍🍳 Cocinar Paso a Paso</span>
                    </button>
                    ${botonWhatsApp}
                </div>
            `;
        }).join('');

        lucide.createIcons();

        // Cambiamos el texto y asignamos la reconexión limpia
        generateBtn.innerHTML = '<span>🔄 Generar Nuevas Recetas</span>';

    } catch (error) {
        console.error("Error capturado:", error);
        trackAnalyticsEvent('recipe_generation_failed', {
            ...ingredientMetrics,
            http_status: responseStatus,
            error_type: error?.code || error?.name || 'GenerationError'
        });
        trackTechnicalError('recipe_generation', error, { http_status: responseStatus });
        showAlert('Error', error.message, 'error');
        recipesContainer.innerHTML = '';
    } finally {
        // 2. Ocultar la animación SIEMPRE al terminar
        ocultarCargando();
        generateBtn.disabled = false;
    }
}

// Funciones auxiliares para controlar el modal del cocinerito
function mostrarCargando() {
    const loader = document.getElementById('loading-modal');
    if (loader) loader.classList.remove('hidden');
}

function ocultarCargando() {
    const loader = document.getElementById('loading-modal');
    if (loader) loader.classList.add('hidden');
}

generateBtn.addEventListener('click', ejecutarGeneracion);

// Navegación entre vistas
const viewCook = document.getElementById('view-cook');
const viewSaved = document.getElementById('view-saved');
const viewPreferences = document.getElementById('view-preferences');
const viewWeeklyPlan = document.getElementById('view-weekly-plan');
const viewShoppingList = document.getElementById('view-shopping-list');
const viewPlans = document.getElementById('view-plans');
const tabSaved = document.getElementById('tab-saved');
const tabCook = document.querySelector('nav button:first-child');
const tabPreferences = document.getElementById('tab-preferences');
const tabWeeklyPlan = document.getElementById('tab-weekly-plan');

function mostrarSubVista(view, activeTab, screenName) {
    [viewCook, viewSaved, viewPreferences, viewWeeklyPlan, viewShoppingList, viewPlans].forEach(item => item?.classList.add('hidden'));
    [tabCook, tabSaved, tabPreferences, tabWeeklyPlan].forEach(item => item?.classList.remove('active'));

    view?.classList.remove('hidden');
    activeTab?.classList.add('active');
    trackAnalyticsEvent('screen_view', { screen: screenName });
}

tabSaved.addEventListener('click', () => {
    mostrarSubVista(viewSaved, tabSaved, 'saved_recipes');
    loadSavedRecipes();
});

tabCook.addEventListener('click', () => {
    mostrarSubVista(viewCook, tabCook, 'cook');
});

tabPreferences.addEventListener('click', () => {
    mostrarSubVista(viewPreferences, tabPreferences, 'preferences');
    loadPreferences();
});

tabWeeklyPlan.addEventListener('click', () => {
    mostrarSubVista(viewWeeklyPlan, tabWeeklyPlan, 'weekly_plan');
    if (currentPlanState.plan === 'premium') loadWeeklyPlan();
});

let plansReturnState = { view: viewCook, tab: tabCook, screen: 'cook' };

function obtenerVistaActualParaVolver() {
    if (!viewShoppingList.classList.contains('hidden')) {
        return { view: viewShoppingList, tab: tabWeeklyPlan, screen: 'shopping_list' };
    }
    if (!viewWeeklyPlan.classList.contains('hidden')) {
        return { view: viewWeeklyPlan, tab: tabWeeklyPlan, screen: 'weekly_plan' };
    }
    if (!viewSaved.classList.contains('hidden')) {
        return { view: viewSaved, tab: tabSaved, screen: 'saved_recipes' };
    }
    if (!viewPreferences.classList.contains('hidden')) {
        return { view: viewPreferences, tab: tabPreferences, screen: 'preferences' };
    }
    return { view: viewCook, tab: tabCook, screen: 'cook' };
}

function updatePlansView() {
    const isPremium = currentPlanState.plan === 'premium';
    const used = Math.max(Number(currentPlanState.generation_used) || 0, 0);
    const limit = Math.max(Number(currentPlanState.generation_limit) || 1, 1);
    const usagePercent = Math.min((used / limit) * 100, 100);
    const currentBadge = document.getElementById('plans-current-badge');
    const usageText = document.getElementById('plans-usage-text');
    const usageFill = document.getElementById('plans-usage-fill');
    const resultsText = document.getElementById('plans-results-text');
    const freeLabel = document.getElementById('free-current-label');
    const freeCard = document.getElementById('free-plan-card');
    const premiumCard = document.getElementById('premium-plan-card');
    const requestButton = document.getElementById('request-premium-btn');

    if (currentBadge) currentBadge.textContent = `Tu plan actual: ${isPremium ? 'Premium' : 'Free'}`;
    if (usageText) usageText.textContent = `${used} de ${limit} usadas`;
    if (usageFill) usageFill.style.width = `${usagePercent}%`;
    if (resultsText) {
        resultsText.textContent = `Cada generación entrega ${currentPlanState.alacena_results} recetas y ${currentPlanState.suggestion_results} ${currentPlanState.suggestion_results === 1 ? 'sugerencia' : 'sugerencias'}.`;
    }
    freeLabel?.classList.toggle('hidden', isPremium);
    freeCard?.classList.toggle('is-current', !isPremium);
    premiumCard?.classList.toggle('is-current', isPremium);

    if (requestButton && isPremium) {
        requestButton.disabled = true;
        requestButton.textContent = 'Tu plan Premium está activo';
    } else if (requestButton) {
        requestButton.disabled = false;
        requestButton.textContent = 'Solicitar acceso Premium';
    }
}

async function loadPremiumRequestStatus() {
    updatePlansView();
    const statusText = document.getElementById('premium-request-status');
    const requestButton = document.getElementById('request-premium-btn');
    if (currentPlanState.plan === 'premium') {
        statusText.textContent = 'Todas las funciones están desbloqueadas en esta cuenta.';
        return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
        .from('premium_upgrade_requests')
        .select('status,requested_at')
        .eq('user_id', user.id)
        .maybeSingle();

    if (error) {
        trackTechnicalError('premium_request_status_load', error);
        statusText.textContent = 'No pudimos consultar el estado de la solicitud.';
        return;
    }

    if (data?.status === 'pending' || data?.status === 'contacted') {
        requestButton.disabled = true;
        requestButton.textContent = 'Solicitud enviada';
        statusText.textContent = 'Tu solicitud está registrada. Solicitar acceso no genera ningún cobro.';
    } else if (data?.status === 'approved') {
        requestButton.disabled = true;
        requestButton.textContent = 'Solicitud aprobada';
        statusText.textContent = 'El acceso fue aprobado. Volvé a entrar si el plan todavía figura como Free.';
    } else if (data?.status === 'rejected' || data?.status === 'cancelled') {
        statusText.textContent = 'Podés enviar una nueva solicitud cuando quieras.';
    } else {
        statusText.textContent = 'Registrá tu interés para acceder cuando habilitemos la activación.';
    }
}

document.getElementById('plan-badge').addEventListener('click', async () => {
    plansReturnState = obtenerVistaActualParaVolver();
    mostrarSubVista(viewPlans, null, 'plans');
    await loadPlanState();
    await loadPremiumRequestStatus();
});

document.getElementById('weekly-plan-upgrade-btn').addEventListener('click', async () => {
    plansReturnState = { view: viewWeeklyPlan, tab: tabWeeklyPlan, screen: 'weekly_plan' };
    trackAnalyticsEvent('premium_feature_cta_clicked', { feature: 'weekly_plan' });
    mostrarSubVista(viewPlans, null, 'plans');
    await loadPlanState();
    await loadPremiumRequestStatus();
});

document.getElementById('back-from-plans-btn').addEventListener('click', () => {
    mostrarSubVista(plansReturnState.view, plansReturnState.tab, plansReturnState.screen);
});

document.getElementById('request-premium-btn').addEventListener('click', async event => {
    if (currentPlanState.plan === 'premium') return;
    event.currentTarget.disabled = true;

    const { data, error } = await supabase.rpc('request_premium_upgrade');
    if (error) {
        trackTechnicalError('premium_upgrade_request', error);
        event.currentTarget.disabled = false;
        showAlert('Error', 'No se pudo registrar la solicitud.', 'error');
        return;
    }

    if (data?.status === 'already_premium') {
        await loadPlanState();
    }

    trackAnalyticsEvent('premium_upgrade_requested', {
        request_status: data?.status || 'pending'
    });
    showAlert('Solicitud registrada', 'No se realizó ningún cobro.', 'success');
    await loadPremiumRequestStatus();
});

function normalizarListaPreferencias(value) {
    return [...new Set(String(value || '')
        .split(/[,\n]+/)
        .map(item => item.trim().slice(0, 80))
        .filter(Boolean))]
        .slice(0, 30);
}

async function loadPreferences() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
        .from('user_recipe_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

    if (error) {
        trackTechnicalError('preferences_load', error);
        showAlert('Error', 'No se pudieron cargar tus preferencias.', 'error');
        return;
    }

    const preferences = data || {};
    document.getElementById('preference-diet').value = preferences.diet_type || 'sin_preferencia';
    document.getElementById('preference-avoid').value = Array.isArray(preferences.avoid_ingredients)
        ? preferences.avoid_ingredients.join(', ')
        : '';
    document.getElementById('preference-servings').value = preferences.default_servings || 2;
    document.getElementById('preference-max-time').value = preferences.max_time_minutes || '';
    document.getElementById('preference-goal').value = preferences.cooking_goal || '';

    const selectedEquipment = new Set(Array.isArray(preferences.equipment) ? preferences.equipment : []);
    document.querySelectorAll('input[name="preference-equipment"]').forEach(input => {
        input.checked = selectedEquipment.has(input.value);
    });
}

document.getElementById('preferences-form').addEventListener('submit', async event => {
    event.preventDefault();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
        user_id: user.id,
        diet_type: document.getElementById('preference-diet').value,
        avoid_ingredients: normalizarListaPreferencias(document.getElementById('preference-avoid').value),
        updated_at: new Date().toISOString()
    };

    if (currentPlanState.plan === 'premium') {
        payload.default_servings = Number(document.getElementById('preference-servings').value) || 2;
        payload.max_time_minutes = Number(document.getElementById('preference-max-time').value) || null;
        payload.cooking_goal = document.getElementById('preference-goal').value || null;
        payload.equipment = [...document.querySelectorAll('input[name="preference-equipment"]:checked')]
            .map(input => input.value);
    }

    const saveButton = document.getElementById('save-preferences-btn');
    saveButton.disabled = true;

    const { error } = await supabase
        .from('user_recipe_preferences')
        .upsert(payload, { onConflict: 'user_id' });

    saveButton.disabled = false;

    if (error) {
        trackTechnicalError('preferences_save', error);
        showAlert('Error', 'No se pudieron guardar tus preferencias.', 'error');
        return;
    }

    showAlert('Preferencias guardadas', 'Las próximas recetas respetarán tu configuración.', 'success');
});

const WEEKLY_MEAL_TYPES = [
    { key: 'lunch', label: 'Almuerzo' },
    { key: 'dinner', label: 'Cena' }
];

const weeklyPlanState = {
    weekStart: obtenerInicioSemana(new Date()),
    planId: null,
    userId: null,
    recipes: [],
    collections: [],
    collectionItems: [],
    collectionFilter: 'all',
    meals: new Map(),
    defaultServings: 2,
    movingKey: null,
    loadVersion: 0
};

function obtenerInicioSemana(date) {
    const result = new Date(date);
    result.setHours(12, 0, 0, 0);
    const day = result.getDay();
    result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
    return result;
}

function sumarDias(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function fechaLocalISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function escaparHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function crearMealKey(date, mealType) {
    return `${date}|${mealType}`;
}

function separarMealKey(key) {
    const [mealDate, mealType] = key.split('|');
    return { mealDate, mealType };
}

function obtenerSlotsSemana() {
    const slots = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const date = fechaLocalISO(sumarDias(weeklyPlanState.weekStart, dayIndex));
        WEEKLY_MEAL_TYPES.forEach(type => slots.push({ date, mealType: type.key }));
    }
    return slots;
}

function crearRecipeSnapshot(recipe) {
    return {
        title: recipe.title,
        time: recipe.time,
        duration_minutes: recipe.duration_minutes,
        difficulty: recipe.difficulty,
        servings: recipe.servings || 2,
        required_ingredients: Array.isArray(recipe.required_ingredients) ? recipe.required_ingredients : [],
        missing_ingredients: Array.isArray(recipe.missing_ingredients) ? recipe.missing_ingredients : [],
        recipe_type: recipe.recipe_type || 'alacena',
        tags: Array.isArray(recipe.tags) ? recipe.tags : [],
        steps: Array.isArray(recipe.steps) ? recipe.steps : []
    };
}

function obtenerWeeklyRecipesDisponibles() {
    if (weeklyPlanState.collectionFilter === 'all') return weeklyPlanState.recipes;
    const allowedRecipeIds = new Set(
        weeklyPlanState.collectionItems
            .filter(item => item.collection_id === weeklyPlanState.collectionFilter)
            .map(item => String(item.saved_recipe_id))
    );
    return weeklyPlanState.recipes.filter(recipe => allowedRecipeIds.has(String(recipe.id)));
}

function renderWeeklyMealSlot(date, mealType, label) {
    const key = crearMealKey(date, mealType);
    const meal = weeklyPlanState.meals.get(key);
    const recipeId = meal?.saved_recipe_id || '';
    const filteredRecipes = obtenerWeeklyRecipesDisponibles();
    const selectedRecipe = weeklyPlanState.recipes.find(recipe => String(recipe.id) === String(recipeId));
    const selectableRecipes = selectedRecipe && !filteredRecipes.some(recipe => String(recipe.id) === String(recipeId))
        ? [selectedRecipe, ...filteredRecipes]
        : filteredRecipes;
    const options = selectableRecipes.map(recipe => `
        <option value="${escaparHTML(recipe.id)}" ${String(recipe.id) === String(recipeId) ? 'selected' : ''}>
            ${escaparHTML(recipe.title)}
        </option>
    `).join('');
    const isLocked = Boolean(meal?.is_locked);
    const isCooked = Boolean(meal?.is_cooked);
    const isMoving = weeklyPlanState.movingKey === key;

    return `
        <div class="meal-slot ${isLocked ? 'is-locked' : ''} ${isCooked ? 'is-cooked' : ''} ${isMoving ? 'is-moving' : ''}" data-meal-key="${key}">
            <div class="meal-slot-title">
                <span>${label}</span>
                <span>${isCooked ? '✓ Cocinada' : (isLocked ? '🔒 Fija' : '')}</span>
            </div>
            <select class="meal-recipe-select" ${isLocked ? 'disabled' : ''} aria-label="Receta para ${label}">
                <option value="">Sin asignar</option>
                ${options}
            </select>
            <label class="meal-servings-row">
                Porciones
                <input class="meal-servings-input" type="number" min="1" max="20" value="${meal?.desired_servings || weeklyPlanState.defaultServings}" ${isLocked || !recipeId ? 'disabled' : ''}>
            </label>
            <div class="meal-slot-actions">
                <button type="button" class="meal-slot-btn ${isLocked ? 'active' : ''}" data-action="lock" ${!recipeId ? 'disabled' : ''}>${isLocked ? 'Desbloquear' : 'Bloquear'}</button>
                <button type="button" class="meal-slot-btn" data-action="move" ${isLocked || !recipeId && !weeklyPlanState.movingKey ? 'disabled' : ''}>Mover</button>
                <button type="button" class="meal-slot-btn ${isCooked ? 'active' : ''}" data-action="cooked" ${!recipeId ? 'disabled' : ''}>${isCooked ? 'Desmarcar' : 'Cocinada'}</button>
            </div>
        </div>
    `;
}

function renderWeeklyPlan() {
    const grid = document.getElementById('weekly-plan-grid');
    const range = document.getElementById('weekly-plan-range');
    if (!grid || !range) return;

    const weekEnd = sumarDias(weeklyPlanState.weekStart, 6);
    const formatter = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' });
    range.textContent = `${formatter.format(weeklyPlanState.weekStart)} – ${formatter.format(weekEnd)}`;
    const collectionFilter = document.getElementById('weekly-collection-filter');
    if (collectionFilter) {
        collectionFilter.innerHTML = `
            <option value="all">Todas mis favoritas</option>
            ${weeklyPlanState.collections.map(collection => `
                <option value="${escaparHTML(collection.id)}">${escaparHTML(collection.name)}</option>
            `).join('')}
        `;
        if (!weeklyPlanState.collections.some(item => item.id === weeklyPlanState.collectionFilter)) {
            weeklyPlanState.collectionFilter = 'all';
        }
        collectionFilter.value = weeklyPlanState.collectionFilter;
    }

    grid.innerHTML = Array.from({ length: 7 }, (_, dayIndex) => {
        const dateObject = sumarDias(weeklyPlanState.weekStart, dayIndex);
        const date = fechaLocalISO(dateObject);
        const dayName = new Intl.DateTimeFormat('es-AR', { weekday: 'long' }).format(dateObject);
        const dayLabel = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(dateObject);

        return `
            <section class="week-day-card">
                <div class="week-day-heading">
                    <strong>${dayName}</strong>
                    <span>${dayLabel}</span>
                </div>
                <div class="day-meals">
                    ${WEEKLY_MEAL_TYPES.map(type => renderWeeklyMealSlot(date, type.key, type.label)).join('')}
                </div>
            </section>
        `;
    }).join('');

    const moveHint = document.getElementById('weekly-move-hint');
    moveHint?.classList.toggle('hidden', !weeklyPlanState.movingKey);
}

async function loadWeeklyPlan() {
    if (currentPlanState.plan !== 'premium') return;

    const loadVersion = ++weeklyPlanState.loadVersion;
    const grid = document.getElementById('weekly-plan-grid');
    if (grid) grid.innerHTML = '<p class="weekly-empty-state">Cargando tu semana…</p>';

    const { data: { user } } = await supabase.auth.getUser();
    if (!user || loadVersion !== weeklyPlanState.loadVersion) return;

    const weekStart = fechaLocalISO(weeklyPlanState.weekStart);
    const [recipesResult, preferencesResult, collectionsResult, collectionItemsResult] = await Promise.all([
        supabase.from('saved_recipes').select('*').eq('user_id', user.id).order('title'),
        supabase.rpc('get_my_recipe_preferences'),
        supabase.from('recipe_collections').select('*').eq('user_id', user.id).order('name'),
        supabase.from('recipe_collection_items').select('*').eq('user_id', user.id)
    ]);

    if (recipesResult.error || preferencesResult.error || collectionsResult.error || collectionItemsResult.error) {
        trackTechnicalError('weekly_plan_dependencies_load', recipesResult.error || preferencesResult.error || collectionsResult.error || collectionItemsResult.error);
        showAlert('Error', 'No se pudo preparar el plan semanal.', 'error');
        return;
    }

    const { data: plan, error: planError } = await supabase
        .from('weekly_plans')
        .upsert({ user_id: user.id, week_start: weekStart, updated_at: new Date().toISOString() }, {
            onConflict: 'user_id,week_start'
        })
        .select('*')
        .single();

    if (planError || loadVersion !== weeklyPlanState.loadVersion) {
        trackTechnicalError('weekly_plan_load', planError);
        showAlert('Error', 'No se pudo cargar esta semana.', 'error');
        return;
    }

    const { data: meals, error: mealsError } = await supabase
        .from('weekly_plan_meals')
        .select('*')
        .eq('plan_id', plan.id);

    if (mealsError || loadVersion !== weeklyPlanState.loadVersion) {
        trackTechnicalError('weekly_meals_load', mealsError);
        showAlert('Error', 'No se pudieron cargar las comidas.', 'error');
        return;
    }

    weeklyPlanState.planId = plan.id;
    weeklyPlanState.userId = user.id;
    weeklyPlanState.recipes = recipesResult.data || [];
    weeklyPlanState.collections = collectionsResult.data || [];
    weeklyPlanState.collectionItems = collectionItemsResult.data || [];
    weeklyPlanState.defaultServings = Number(preferencesResult.data?.default_servings) || 2;
    weeklyPlanState.meals = new Map((meals || []).map(meal => [
        crearMealKey(meal.meal_date, meal.meal_type),
        meal
    ]));
    weeklyPlanState.movingKey = null;
    renderWeeklyPlan();
}

async function guardarWeeklyMeal(key, content) {
    const { mealDate, mealType } = separarMealKey(key);

    if (!content?.saved_recipe_id) {
        const existing = weeklyPlanState.meals.get(key);
        if (existing?.id) {
            const { error } = await supabase.from('weekly_plan_meals').delete().eq('id', existing.id);
            if (error) throw error;
        }
        weeklyPlanState.meals.delete(key);
        return;
    }

    const payload = {
        plan_id: weeklyPlanState.planId,
        user_id: weeklyPlanState.userId,
        meal_date: mealDate,
        meal_type: mealType,
        saved_recipe_id: String(content.saved_recipe_id),
        recipe_snapshot: content.recipe_snapshot || {},
        desired_servings: Math.min(Math.max(Number(content.desired_servings) || 2, 1), 20),
        is_locked: Boolean(content.is_locked),
        is_cooked: Boolean(content.is_cooked),
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from('weekly_plan_meals')
        .upsert(payload, { onConflict: 'plan_id,meal_date,meal_type' })
        .select('*')
        .single();

    if (error) throw error;
    weeklyPlanState.meals.set(key, data);
}

document.getElementById('weekly-plan-grid').addEventListener('change', async event => {
    const slot = event.target.closest('.meal-slot');
    if (!slot) return;

    const key = slot.dataset.mealKey;
    try {
        if (event.target.classList.contains('meal-recipe-select')) {
            const recipe = weeklyPlanState.recipes.find(item => String(item.id) === event.target.value);
            if (!recipe) {
                await guardarWeeklyMeal(key, null);
            } else {
                await guardarWeeklyMeal(key, {
                    saved_recipe_id: recipe.id,
                    recipe_snapshot: crearRecipeSnapshot(recipe),
                    desired_servings: weeklyPlanState.defaultServings || recipe.servings || 2,
                    is_locked: false,
                    is_cooked: false
                });
            }
        }

        if (event.target.classList.contains('meal-servings-input')) {
            const meal = weeklyPlanState.meals.get(key);
            if (meal) {
                await guardarWeeklyMeal(key, {
                    ...meal,
                    desired_servings: event.target.value
                });
            }
        }

        renderWeeklyPlan();
    } catch (error) {
        trackTechnicalError('weekly_meal_change', error);
        showAlert('Error', 'No se pudo guardar el cambio.', 'error');
        await loadWeeklyPlan();
    }
});

document.getElementById('weekly-plan-grid').addEventListener('click', async event => {
    const actionButton = event.target.closest('[data-action]');
    const slot = event.target.closest('.meal-slot');
    if (!actionButton || !slot) return;

    const key = slot.dataset.mealKey;
    const meal = weeklyPlanState.meals.get(key);
    const action = actionButton.dataset.action;

    try {
        if (action === 'lock' && meal) {
            await guardarWeeklyMeal(key, { ...meal, is_locked: !meal.is_locked });
        }

        if (action === 'cooked' && meal) {
            const isCooked = !meal.is_cooked;
            await guardarWeeklyMeal(key, { ...meal, is_cooked: isCooked });
            if (isCooked) {
                trackAnalyticsEvent('recipe_marked_cooked', {
                    recipe_id: await crearHuellaPrivada(meal.saved_recipe_id),
                    source: 'weekly_plan'
                });
            }
        }

        if (action === 'move') {
            if (!weeklyPlanState.movingKey) {
                if (!meal || meal.is_locked) return;
                weeklyPlanState.movingKey = key;
            } else if (weeklyPlanState.movingKey === key) {
                weeklyPlanState.movingKey = null;
            } else {
                const sourceKey = weeklyPlanState.movingKey;
                const sourceMeal = weeklyPlanState.meals.get(sourceKey);
                const targetMeal = weeklyPlanState.meals.get(key);

                if (targetMeal?.is_locked) {
                    showAlert('Horario bloqueado', 'Desbloquealo antes de mover una receta.', 'warning');
                    return;
                }

                weeklyPlanState.movingKey = null;
                const sourceSlot = separarMealKey(sourceKey);
                const targetSlot = separarMealKey(key);
                const { error } = await supabase.rpc('move_weekly_plan_meal', {
                    p_plan_id: weeklyPlanState.planId,
                    p_source_date: sourceSlot.mealDate,
                    p_source_type: sourceSlot.mealType,
                    p_target_date: targetSlot.mealDate,
                    p_target_type: targetSlot.mealType
                });

                if (error) throw error;
                await loadWeeklyPlan();
                return;
            }
        }

        renderWeeklyPlan();
    } catch (error) {
        trackTechnicalError('weekly_meal_action', error);
        showAlert('Error', 'No se pudo actualizar el plan.', 'error');
        await loadWeeklyPlan();
    }
});

document.getElementById('weekly-collection-filter').addEventListener('change', event => {
    weeklyPlanState.collectionFilter = event.target.value;
    trackAnalyticsEvent('weekly_plan_collection_filtered', {
        filtered: event.target.value !== 'all'
    });
    renderWeeklyPlan();
});

document.getElementById('autofill-week-btn').addEventListener('click', async () => {
    const availableRecipes = obtenerWeeklyRecipesDisponibles();
    if (availableRecipes.length === 0) {
        const message = weeklyPlanState.collectionFilter === 'all'
            ? 'Guardá al menos una receta antes de completar la semana.'
            : 'La colección elegida todavía no tiene recetas.';
        showAlert('Faltan favoritas', message, 'warning');
        return;
    }

    const emptySlots = obtenerSlotsSemana().filter(slot => {
        const meal = weeklyPlanState.meals.get(crearMealKey(slot.date, slot.mealType));
        return !meal?.saved_recipe_id && !meal?.is_locked;
    });

    if (emptySlots.length === 0) {
        showAlert('Semana completa', 'No hay espacios vacíos para completar.', 'info');
        return;
    }

    try {
        const payloads = emptySlots.map((slot, index) => {
            const recipe = availableRecipes[index % availableRecipes.length];
            return {
                plan_id: weeklyPlanState.planId,
                user_id: weeklyPlanState.userId,
                meal_date: slot.date,
                meal_type: slot.mealType,
                saved_recipe_id: String(recipe.id),
                recipe_snapshot: crearRecipeSnapshot(recipe),
                desired_servings: weeklyPlanState.defaultServings || recipe.servings || 2,
                is_locked: false,
                is_cooked: false,
                updated_at: new Date().toISOString()
            };
        });

        const { data, error } = await supabase
            .from('weekly_plan_meals')
            .upsert(payloads, { onConflict: 'plan_id,meal_date,meal_type' })
            .select('*');

        if (error) throw error;
        (data || []).forEach(meal => {
            weeklyPlanState.meals.set(crearMealKey(meal.meal_date, meal.meal_type), meal);
        });

        renderWeeklyPlan();
        showAlert('Semana completada', 'Se llenaron los espacios usando tus favoritas.', 'success');
    } catch (error) {
        trackTechnicalError('weekly_plan_autofill', error);
        showAlert('Error', 'No se pudo completar toda la semana.', 'error');
        await loadWeeklyPlan();
    }
});

document.getElementById('clear-week-btn').addEventListener('click', async () => {
    try {
        const { error } = await supabase
            .from('weekly_plan_meals')
            .delete()
            .eq('plan_id', weeklyPlanState.planId)
            .eq('is_locked', false);

        if (error) throw error;

        weeklyPlanState.meals = new Map(
            [...weeklyPlanState.meals].filter(([, meal]) => meal.is_locked)
        );
        weeklyPlanState.movingKey = null;
        renderWeeklyPlan();
        showAlert('Plan actualizado', 'Se conservaron únicamente las comidas bloqueadas.', 'info');
    } catch (error) {
        trackTechnicalError('weekly_plan_clear', error);
        showAlert('Error', 'No se pudo limpiar la semana.', 'error');
    }
});

document.getElementById('previous-week-btn').addEventListener('click', () => {
    weeklyPlanState.weekStart = sumarDias(weeklyPlanState.weekStart, -7);
    loadWeeklyPlan();
});

document.getElementById('next-week-btn').addEventListener('click', () => {
    weeklyPlanState.weekStart = sumarDias(weeklyPlanState.weekStart, 7);
    loadWeeklyPlan();
});

const shoppingListState = {
    listId: null,
    userId: null,
    items: [],
    budgetAmount: null,
    currency: 'ARS',
    loadVersion: 0
};

function normalizarClaveCompra(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLocaleLowerCase('es')
        .replace(/\s+/g, ' ')
        .slice(0, 100);
}

function redondearCantidadCompra(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatearDinero(value) {
    const amount = Number(value) || 0;
    const currency = shoppingListState.currency || 'ARS';
    try {
        return new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency,
            maximumFractionDigits: currency === 'CLP' ? 0 : 2
        }).format(amount);
    } catch (error) {
        return `${currency} ${formatearCantidad(amount)}`;
    }
}

function renderBudgetSummary() {
    const cards = document.getElementById('budget-summary-cards');
    const status = document.getElementById('budget-status-message');
    if (!cards || !status) return;

    const hasBudget = shoppingListState.budgetAmount !== null && Number.isFinite(Number(shoppingListState.budgetAmount));
    const budget = hasBudget ? Number(shoppingListState.budgetAmount) : 0;
    const estimated = shoppingListState.items.reduce((total, item) => total + (Number(item.estimated_cost) || 0), 0);
    const spent = shoppingListState.items.reduce((total, item) => {
        if (!item.is_checked) return total;
        const hasActual = item.actual_cost !== null && item.actual_cost !== undefined;
        return total + (hasActual ? Number(item.actual_cost) : (Number(item.estimated_cost) || 0));
    }, 0);
    const projected = shoppingListState.items.reduce((total, item) => {
        const hasActual = item.actual_cost !== null && item.actual_cost !== undefined;
        return total + (hasActual ? Number(item.actual_cost) : (Number(item.estimated_cost) || 0));
    }, 0);
    const difference = budget - projected;

    cards.innerHTML = `
        <div><span>Presupuesto</span><strong>${hasBudget ? formatearDinero(budget) : 'Sin definir'}</strong></div>
        <div><span>Estimado</span><strong>${formatearDinero(estimated)}</strong></div>
        <div><span>Gastado</span><strong>${formatearDinero(spent)}</strong></div>
        <div class="${hasBudget && difference < 0 ? 'is-over-budget' : 'is-within-budget'}">
            <span>${hasBudget && difference < 0 ? 'Exceso' : 'Disponible'}</span>
            <strong>${hasBudget ? formatearDinero(Math.abs(difference)) : '—'}</strong>
        </div>
    `;

    status.className = 'budget-status-message';
    if (estimated <= 0 && projected <= 0) {
        status.textContent = 'Agregá precios para calcular la proyección semanal.';
    } else if (!hasBudget) {
        status.textContent = `La compra proyectada es de ${formatearDinero(projected)}. Definí un presupuesto para compararla.`;
    } else if (difference >= 0) {
        status.classList.add('is-positive');
        status.textContent = `La compra proyectada entra en el presupuesto y deja ${formatearDinero(difference)} disponibles.`;
    } else {
        status.classList.add('is-negative');
        status.textContent = `La proyección supera el presupuesto por ${formatearDinero(Math.abs(difference))}.`;
    }
}

function calcularComprasDesdePlan(pantryItems) {
    const required = new Map();
    const pantry = new Map();

    (pantryItems || []).forEach(item => {
        const nameKey = normalizarClaveCompra(item.ingredient);
        const unit = String(item.unit || 'unidad').trim().toLocaleLowerCase('es');
        if (!nameKey) return;
        const key = `${nameKey}|${unit}`;
        pantry.set(key, (pantry.get(key) || 0) + (Number(item.quantity) || 0));
    });

    [...weeklyPlanState.meals.values()]
        .filter(meal => meal.saved_recipe_id && !meal.is_cooked)
        .forEach(meal => {
            const snapshot = meal.recipe_snapshot || {};
            const baseServings = Math.max(Number(snapshot.servings) || 2, 1);
            const multiplier = Math.max(Number(meal.desired_servings) || baseServings, 1) / baseServings;

            (Array.isArray(snapshot.required_ingredients) ? snapshot.required_ingredients : []).forEach(item => {
                const name = String(item?.name || '').trim();
                const nameKey = normalizarClaveCompra(name);
                const unit = String(item?.unit || 'unidad').trim().toLocaleLowerCase('es');
                const quantity = Number(item?.quantity);
                if (!nameKey || !Number.isFinite(quantity) || quantity <= 0) return;

                const key = `${nameKey}|${unit}`;
                const current = required.get(key) || { name, unit, quantity: 0 };
                current.quantity += quantity * multiplier;
                required.set(key, current);
            });
        });

    return [...required.entries()].map(([sourceKey, item]) => ({
        source_key: sourceKey,
        name: item.name,
        unit: item.unit,
        quantity: redondearCantidadCompra(Math.max(item.quantity - (pantry.get(sourceKey) || 0), 0))
    })).filter(item => item.quantity > 0);
}

function renderShoppingList() {
    const container = document.getElementById('shopping-list-items');
    const summary = document.getElementById('shopping-list-summary');
    const range = document.getElementById('shopping-list-range');
    if (!container || !summary || !range) return;

    const weekEnd = sumarDias(weeklyPlanState.weekStart, 6);
    const formatter = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' });
    range.textContent = `${formatter.format(weeklyPlanState.weekStart)} – ${formatter.format(weekEnd)}`;

    const pending = shoppingListState.items.filter(item => !item.is_checked);
    const checked = shoppingListState.items.filter(item => item.is_checked);
    summary.innerHTML = `<strong>${pending.length}</strong> pendientes · <strong>${checked.length}</strong> comprados`;
    renderBudgetSummary();

    if (shoppingListState.items.length === 0) {
        container.innerHTML = `
            <div class="shopping-empty-state">
                <span>✓</span>
                <strong>No falta comprar nada</strong>
                <p>Agregá recetas al plan o sumá productos manualmente.</p>
            </div>
        `;
        return;
    }

    const renderGroup = (title, items, checkedGroup) => items.length === 0 ? '' : `
        <section class="shopping-group">
            <h3>${title}</h3>
            ${items.map(item => `
                <div class="shopping-item ${checkedGroup ? 'is-checked' : ''}" data-shopping-item-id="${escaparHTML(item.id)}">
                    <label>
                        <input type="checkbox" class="shopping-item-check" ${item.is_checked ? 'checked' : ''}>
                        <span class="shopping-checkmark"></span>
                        <span class="shopping-item-info">
                            <strong>${escaparHTML(item.name)}</strong>
                            <small>${formatearCantidad(item.quantity)} ${escaparHTML(item.unit)}</small>
                        </span>
                    </label>
                    <span class="shopping-item-origin">${item.source_type === 'manual' ? 'Agregado' : 'Plan'}</span>
                    ${item.source_type === 'manual'
                        ? '<button type="button" class="shopping-item-delete" aria-label="Eliminar producto">×</button>'
                        : ''}
                    <div class="shopping-item-costs">
                        <label>
                            <span>Estimado total</span>
                            <input type="number" class="shopping-cost-input" data-cost-field="estimated_cost" min="0" max="999999999" step="0.01" value="${item.estimated_cost !== null && item.estimated_cost !== undefined ? Number(item.estimated_cost) : ''}" placeholder="0">
                        </label>
                        <label>
                            <span>Pagado total</span>
                            <input type="number" class="shopping-cost-input" data-cost-field="actual_cost" min="0" max="999999999" step="0.01" value="${item.actual_cost !== null && item.actual_cost !== undefined ? Number(item.actual_cost) : ''}" placeholder="0">
                        </label>
                    </div>
                </div>
            `).join('')}
        </section>
    `;

    container.innerHTML = renderGroup('Por comprar', pending, false) + renderGroup('Comprados', checked, true);
}

async function sincronizarComprasDelPlan(existingItems, pantryItems) {
    const desiredItems = calcularComprasDesdePlan(pantryItems);
    const existingPlanItems = new Map(
        existingItems
            .filter(item => item.source_type === 'plan')
            .map(item => [item.source_key, item])
    );
    const desiredKeys = new Set(desiredItems.map(item => item.source_key));
    const obsoleteIds = [...existingPlanItems.values()]
        .filter(item => !desiredKeys.has(item.source_key))
        .map(item => item.id);

    if (obsoleteIds.length > 0) {
        const { error } = await supabase.from('shopping_list_items').delete().in('id', obsoleteIds);
        if (error) throw error;
    }

    if (desiredItems.length > 0) {
        const payload = desiredItems.map(item => ({
            list_id: shoppingListState.listId,
            user_id: shoppingListState.userId,
            source_type: 'plan',
            source_key: item.source_key,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            is_checked: Boolean(existingPlanItems.get(item.source_key)?.is_checked),
            updated_at: new Date().toISOString()
        }));
        const { error } = await supabase
            .from('shopping_list_items')
            .upsert(payload, { onConflict: 'list_id,source_type,source_key' });
        if (error) throw error;
    }

    trackAnalyticsEvent('shopping_list_synced', {
        generated_item_count: desiredItems.length,
        planned_meal_count: [...weeklyPlanState.meals.values()].filter(meal => meal.saved_recipe_id && !meal.is_cooked).length
    });
}

async function loadShoppingList({ syncFromPlan = true } = {}) {
    if (currentPlanState.plan !== 'premium' || !weeklyPlanState.planId) return;

    const loadVersion = ++shoppingListState.loadVersion;
    const container = document.getElementById('shopping-list-items');
    if (container) container.innerHTML = '<p class="weekly-empty-state">Preparando tu lista…</p>';

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || loadVersion !== shoppingListState.loadVersion) return;

        const { data: list, error: listError } = await supabase
            .from('shopping_lists')
            .upsert({
                user_id: user.id,
                weekly_plan_id: weeklyPlanState.planId,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,weekly_plan_id' })
            .select('*')
            .single();
        if (listError) throw listError;

        shoppingListState.listId = list.id;
        shoppingListState.userId = user.id;
        shoppingListState.budgetAmount = list.budget_amount === null || list.budget_amount === undefined
            ? null
            : Number(list.budget_amount);
        shoppingListState.currency = list.currency || 'ARS';
        document.getElementById('weekly-budget-amount').value = shoppingListState.budgetAmount ?? '';
        document.getElementById('weekly-budget-currency').value = shoppingListState.currency;

        const [itemsResult, pantryResult] = await Promise.all([
            supabase.from('shopping_list_items').select('*').eq('list_id', list.id),
            supabase.from('pantry').select('ingredient,quantity,unit').eq('user_id', user.id)
        ]);
        if (itemsResult.error || pantryResult.error) throw itemsResult.error || pantryResult.error;

        if (syncFromPlan) {
            await sincronizarComprasDelPlan(itemsResult.data || [], pantryResult.data || []);
        }

        const { data: finalItems, error: finalError } = await supabase
            .from('shopping_list_items')
            .select('*')
            .eq('list_id', list.id)
            .order('is_checked')
            .order('name');
        if (finalError) throw finalError;
        if (loadVersion !== shoppingListState.loadVersion) return;

        shoppingListState.items = finalItems || [];
        renderShoppingList();
    } catch (error) {
        trackTechnicalError('shopping_list_load', error);
        showAlert('Error', 'No se pudo preparar la lista de compras.', 'error');
    }
}

document.getElementById('open-shopping-list-btn').addEventListener('click', async () => {
    if (currentPlanState.plan !== 'premium') return;
    mostrarSubVista(viewShoppingList, tabWeeklyPlan, 'shopping_list');
    trackAnalyticsEvent('shopping_list_opened');
    await loadShoppingList();
});

document.getElementById('back-to-weekly-plan-btn').addEventListener('click', () => {
    mostrarSubVista(viewWeeklyPlan, tabWeeklyPlan, 'weekly_plan');
});

document.getElementById('refresh-shopping-list-btn').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    await loadWeeklyPlan();
    await loadShoppingList();
    event.currentTarget.disabled = false;
});

document.getElementById('shopping-manual-form').addEventListener('submit', async event => {
    event.preventDefault();
    const nameInput = document.getElementById('shopping-item-name');
    const quantityInput = document.getElementById('shopping-item-quantity');
    const unitInput = document.getElementById('shopping-item-unit');
    const name = nameInput.value.trim();
    const quantity = Number(quantityInput.value);

    if (!name || !Number.isFinite(quantity) || quantity <= 0 || !shoppingListState.listId) {
        showAlert('Producto inválido', 'Ingresá un nombre y una cantidad mayor que cero.', 'warning');
        return;
    }

    const { error } = await supabase.from('shopping_list_items').insert({
        list_id: shoppingListState.listId,
        user_id: shoppingListState.userId,
        source_type: 'manual',
        source_key: crearIdAnonimo(),
        name: name.slice(0, 100),
        quantity: Math.min(quantity, 99999),
        unit: unitInput.value,
        is_checked: false
    });

    if (error) {
        trackTechnicalError('shopping_manual_item_add', error);
        showAlert('Error', 'No se pudo agregar el producto.', 'error');
        return;
    }

    nameInput.value = '';
    quantityInput.value = '1';
    trackAnalyticsEvent('shopping_manual_item_added');
    await loadShoppingList({ syncFromPlan: false });
});

document.getElementById('shopping-list-items').addEventListener('change', async event => {
    const isCheck = event.target.classList.contains('shopping-item-check');
    const isCost = event.target.classList.contains('shopping-cost-input');
    if (!isCheck && !isCost) return;
    const row = event.target.closest('[data-shopping-item-id]');
    const item = shoppingListState.items.find(entry => String(entry.id) === row?.dataset.shoppingItemId);
    if (!item) return;

    const update = { updated_at: new Date().toISOString() };
    let analyticsEvent = 'shopping_item_cost_updated';

    if (isCheck) {
        update.is_checked = event.target.checked;
        analyticsEvent = 'shopping_item_checked';
    } else {
        const field = event.target.dataset.costField;
        const amount = event.target.value === '' ? null : Number(event.target.value);
        if (!['estimated_cost', 'actual_cost'].includes(field) || (amount !== null && (!Number.isFinite(amount) || amount < 0))) {
            showAlert('Importe inválido', 'Ingresá un importe válido o dejá el campo vacío.', 'warning');
            return;
        }
        update[field] = amount;
    }

    const { error } = await supabase.from('shopping_list_items').update(update).eq('id', item.id);

    if (error) {
        trackTechnicalError(isCheck ? 'shopping_item_check' : 'shopping_item_cost', error);
        showAlert('Error', 'No se pudo actualizar el producto.', 'error');
        if (isCheck) event.target.checked = !event.target.checked;
        return;
    }

    trackAnalyticsEvent(analyticsEvent, isCheck ? {
        checked: event.target.checked,
        source_type: item.source_type
    } : { cost_type: event.target.dataset.costField });
    await loadShoppingList({ syncFromPlan: false });
});

document.getElementById('weekly-budget-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!shoppingListState.listId) return;

    const amountInput = document.getElementById('weekly-budget-amount');
    const currencyInput = document.getElementById('weekly-budget-currency');
    const amount = amountInput.value === '' ? null : Number(amountInput.value);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        showAlert('Presupuesto inválido', 'Ingresá un importe válido.', 'warning');
        return;
    }

    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const { error } = await supabase
        .from('shopping_lists')
        .update({
            budget_amount: amount,
            currency: currencyInput.value,
            updated_at: new Date().toISOString()
        })
        .eq('id', shoppingListState.listId);
    submitButton.disabled = false;

    if (error) {
        trackTechnicalError('weekly_budget_save', error);
        showAlert('Error', 'No se pudo guardar el presupuesto.', 'error');
        return;
    }

    shoppingListState.budgetAmount = amount;
    shoppingListState.currency = currencyInput.value;
    renderBudgetSummary();
    trackAnalyticsEvent('weekly_budget_updated', { currency: currencyInput.value });
    showAlert('Presupuesto guardado', 'La comparación semanal ya está actualizada.', 'success');
});

document.getElementById('shopping-list-items').addEventListener('click', async event => {
    const deleteButton = event.target.closest('.shopping-item-delete');
    if (!deleteButton) return;
    const row = deleteButton.closest('[data-shopping-item-id]');
    const item = shoppingListState.items.find(entry => String(entry.id) === row?.dataset.shoppingItemId);
    if (!item || item.source_type !== 'manual') return;

    const { error } = await supabase.from('shopping_list_items').delete().eq('id', item.id);
    if (error) {
        trackTechnicalError('shopping_manual_item_delete', error);
        showAlert('Error', 'No se pudo eliminar el producto.', 'error');
        return;
    }
    await loadShoppingList({ syncFromPlan: false });
});

document.getElementById('clear-checked-shopping-btn').addEventListener('click', async () => {
    const checkedManualIds = shoppingListState.items
        .filter(item => item.is_checked && item.source_type === 'manual')
        .map(item => item.id);
    if (checkedManualIds.length === 0) {
        showAlert('Lista al día', 'No hay productos agregados manualmente para borrar.', 'info');
        return;
    }

    const { error } = await supabase.from('shopping_list_items').delete().in('id', checkedManualIds);
    if (error) {
        trackTechnicalError('shopping_checked_clear', error);
        showAlert('Error', 'No se pudieron borrar los productos.', 'error');
        return;
    }
    await loadShoppingList({ syncFromPlan: false });
});

document.getElementById('share-shopping-list-btn').addEventListener('click', () => {
    const pending = shoppingListState.items.filter(item => !item.is_checked);
    if (pending.length === 0) {
        showAlert('Lista completa', 'No quedan productos pendientes para compartir.', 'info');
        return;
    }

    const lines = pending.map(item => `• ${formatearCantidad(item.quantity)} ${item.unit} de ${item.name}`);
    const message = `Lista de compras de Alacena\n\n${lines.join('\n')}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
    trackAnalyticsEvent('shopping_list_shared', { pending_item_count: pending.length });
});

const savedLibraryState = {
    recipes: [],
    history: [],
    collections: [],
    collectionItems: [],
    collectionFilter: 'all',
    view: 'favorites',
    search: '',
    sort: 'recent'
};

function formatearFechaHistorial(value) {
    if (!value) return 'Fecha no disponible';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
    return new Intl.DateTimeFormat('es-AR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function renderSavedCollectionTools() {
    const filter = document.getElementById('saved-collection-filter');
    const list = document.getElementById('saved-collection-list');
    if (!filter || !list) return;

    filter.innerHTML = `
        <option value="all">Todas las colecciones</option>
        ${savedLibraryState.collections.map(collection => `
            <option value="${escaparHTML(collection.id)}">${escaparHTML(collection.name)}</option>
        `).join('')}
    `;
    filter.value = savedLibraryState.collections.some(item => item.id === savedLibraryState.collectionFilter)
        ? savedLibraryState.collectionFilter
        : 'all';
    savedLibraryState.collectionFilter = filter.value;

    if (savedLibraryState.collections.length === 0) {
        list.innerHTML = '<span class="collection-list-empty">Creá tu primera colección para organizar recetas.</span>';
        return;
    }

    list.innerHTML = savedLibraryState.collections.map(collection => {
        const recipeCount = savedLibraryState.collectionItems.filter(item => item.collection_id === collection.id).length;
        return `
            <span class="saved-collection-pill">
                ${escaparHTML(collection.name)} <small>${recipeCount}</small>
                <button type="button" onclick="deleteRecipeCollection('${escaparHTML(collection.id)}')" aria-label="Eliminar colección">×</button>
            </span>
        `;
    }).join('');
}

function obtenerRecetasFiltradas() {
    const query = normalizarClaveCompra(savedLibraryState.search);
    const filtered = savedLibraryState.recipes.filter(recipe => {
        if (
            savedLibraryState.collectionFilter !== 'all'
            && !savedLibraryState.collectionItems.some(item =>
                item.collection_id === savedLibraryState.collectionFilter
                && String(item.saved_recipe_id) === String(recipe.id)
            )
        ) return false;
        if (!query) return true;
        const searchable = normalizarClaveCompra([
            recipe.title,
            recipe.difficulty,
            ...(Array.isArray(recipe.tags) ? recipe.tags : [])
        ].join(' '));
        return searchable.includes(query);
    });

    return filtered.sort((a, b) => {
        if (savedLibraryState.sort === 'title') {
            return String(a.title || '').localeCompare(String(b.title || ''), 'es');
        }
        if (savedLibraryState.sort === 'most_cooked') {
            return (Number(b.total_cooked) || 0) - (Number(a.total_cooked) || 0);
        }
        if (savedLibraryState.sort === 'pinned') {
            return Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned))
                || String(b.created_at || '').localeCompare(String(a.created_at || ''));
        }
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
}

function renderSavedRecipesLibrary() {
    const container = document.getElementById('saved-recipes-list');
    const historyContainer = document.getElementById('cooking-history-list');
    const controls = document.getElementById('saved-library-controls');
    const collectionTools = document.getElementById('saved-collection-tools');
    const countBadge = document.getElementById('saved-recipes-count');
    const isPremium = currentPlanState.plan === 'premium';

    countBadge.textContent = `${savedLibraryState.recipes.length} ${savedLibraryState.recipes.length === 1 ? 'receta' : 'recetas'}`;
    const showHistory = isPremium && savedLibraryState.view === 'history';
    container.classList.toggle('hidden', showHistory);
    historyContainer.classList.toggle('hidden', !showHistory);
    controls?.classList.toggle('hidden', showHistory);
    collectionTools?.classList.toggle('hidden', showHistory);
    if (isPremium) renderSavedCollectionTools();
    const recipes = obtenerRecetasFiltradas();

    document.querySelectorAll('.saved-library-tab').forEach(button => {
        button.classList.toggle('active', button.dataset.libraryView === savedLibraryState.view);
    });

    if (showHistory) {
        if (savedLibraryState.history.length === 0) {
            historyContainer.innerHTML = '<p class="empty-state">Todavía no hay comidas registradas en el historial.</p>';
            return;
        }

        historyContainer.innerHTML = savedLibraryState.history.map(entry => `
            <article class="cooking-history-item">
                <span class="cooking-history-icon">✓</span>
                <div>
                    <strong>${escaparHTML(entry.title || 'Receta eliminada')}</strong>
                    <small>${formatearFechaHistorial(entry.cooked_at)}</small>
                </div>
                <span class="cooking-history-source">${entry.source === 'weekly_plan' ? 'Plan' : 'Favoritas'}</span>
            </article>
        `).join('');
        return;
    }

    if (recipes.length === 0) {
        container.innerHTML = savedLibraryState.search || savedLibraryState.collectionFilter !== 'all'
            ? '<p class="empty-state">No hay recetas que coincidan con este filtro.</p>'
            : '<p class="empty-state">Aún no guardaste ninguna receta.</p>';
        return;
    }

    container.innerHTML = recipes.map(recipe => {
        const structuredIngredients = renderIngredientesEstructurados(recipe.required_ingredients);
        const tagsHTML = renderRecipeTags(recipe.tags);
        const rawSteps = Array.isArray(recipe.steps) ? recipe.steps : [];
        const cookingSteps = rawSteps.flatMap(step => parsearPasos(step)).filter(Boolean);
        const encodedTitle = encodeURIComponent(recipe.title || 'Receta');
        const encodedSteps = encodeURIComponent(JSON.stringify(cookingSteps));
        const recipeId = escaparHTML(recipe.id);
        const recipeCollections = savedLibraryState.collectionItems
            .filter(item => String(item.saved_recipe_id) === String(recipe.id))
            .map(item => savedLibraryState.collections.find(collection => collection.id === item.collection_id))
            .filter(Boolean);
        const availableCollections = savedLibraryState.collections.filter(collection =>
            !recipeCollections.some(current => current.id === collection.id)
        );
        const createdLabel = recipe.created_at
            ? `Guardada ${new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(recipe.created_at))}`
            : '';

        return `
            <article class="recipe-card-container saved-library-card ${recipe.is_pinned ? 'is-pinned' : ''}" data-saved-recipe-id="${recipeId}">
                <div class="saved-card-actions">
                    ${isPremium ? `
                        <button type="button" onclick="togglePinnedRecipe('${recipeId}', ${!recipe.is_pinned})" class="recipe-action-btn saved-pin-btn ${recipe.is_pinned ? 'active' : ''}" title="${recipe.is_pinned ? 'Desfijar' : 'Fijar'} receta">
                            ${recipe.is_pinned ? '★' : '☆'}
                        </button>
                    ` : ''}
                    <button type="button" onclick="deleteRecipe('${recipeId}', event)" class="recipe-action-btn btn-delete" title="Eliminar receta">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
                <div>
                    <h3 class="recipe-card-title">${escaparHTML(recipe.title)}</h3>
                    ${createdLabel ? `<small class="saved-created-label">${createdLabel}</small>` : ''}
                </div>
                <div class="saved-recipe-meta">
                    <span>${escaparHTML(recipe.duration_minutes ? `${recipe.duration_minutes} min` : recipe.time)} · ${escaparHTML(recipe.difficulty)} · ${Number(recipe.servings) || 2} porciones</span>
                    <span class="cooked-badge">🍳 Cocinada: <strong>${Number(recipe.total_cooked) || 0}</strong> veces</span>
                </div>
                ${tagsHTML}
                ${isPremium ? `
                    <div class="recipe-collections-block">
                        <div class="recipe-collection-memberships">
                            ${recipeCollections.length > 0
                                ? recipeCollections.map(collection => `
                                    <span>${escaparHTML(collection.name)}
                                        <button type="button" onclick="removeRecipeFromCollection('${recipeId}', '${escaparHTML(collection.id)}')" aria-label="Quitar de la colección">×</button>
                                    </span>
                                `).join('')
                                : '<small>Sin colección</small>'}
                        </div>
                        <select onchange="addRecipeToCollection('${recipeId}', this.value); this.value = ''" ${availableCollections.length === 0 ? 'disabled' : ''}>
                            <option value="">${savedLibraryState.collections.length === 0 ? 'Primero creá una colección' : 'Agregar a colección…'}</option>
                            ${availableCollections.map(collection => `<option value="${escaparHTML(collection.id)}">${escaparHTML(collection.name)}</option>`).join('')}
                        </select>
                    </div>
                ` : ''}
                ${structuredIngredients}
                <p class="recipe-instructions recipe-instructions--italic">
                    ${cookingSteps.length > 0 ? escaparHTML(cookingSteps.join(' ')) : 'Sin pasos guardados'}
                </p>
                ${isPremium ? `
                    <div class="saved-personal-details">
                        <label>
                            <span>Tu valoración</span>
                            <select onchange="updateSavedRecipeRating('${recipeId}', this.value)">
                                <option value="">Sin valorar</option>
                                ${[1, 2, 3, 4, 5].map(value => `<option value="${value}" ${Number(recipe.rating) === value ? 'selected' : ''}>${'★'.repeat(value)}</option>`).join('')}
                            </select>
                        </label>
                        <label>
                            <span>Nota privada</span>
                            <textarea maxlength="500" rows="2" placeholder="Ej. usar menos sal la próxima vez…">${escaparHTML(recipe.personal_note || '')}</textarea>
                        </label>
                        <button type="button" onclick="saveRecipeNote('${recipeId}', this.previousElementSibling.querySelector('textarea').value)">Guardar nota</button>
                    </div>
                ` : ''}
                <div class="saved-card-main-actions">
                    <button type="button" class="btn-abrir-cocina" data-title="${encodedTitle}" data-steps="${encodedSteps}">👨‍🍳 Abrir Modo Cocina</button>
                    <button type="button" onclick="marcarCocinada('${recipeId}')" class="btn-cook-today">✨ ¡Cocinada hoy!</button>
                </div>
            </article>
        `;
    }).join('');
    lucide.createIcons();
}

async function loadSavedRecipes() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
        .from('saved_recipes')
        .select('*')
        .eq('user_id', user.id);

    if (error) {
        trackTechnicalError('saved_recipes_load', error);
        showAlert('Error', 'No se pudieron cargar tus recetas guardadas.', 'error');
        return;
    }

    let manualHistory = [];
    let weeklyHistory = [];
    const weeklyCounts = new Map();
    savedLibraryState.collections = [];
    savedLibraryState.collectionItems = [];

    if (currentPlanState.plan === 'premium') {
        const [manualResult, weeklyResult, collectionsResult, collectionItemsResult] = await Promise.all([
            supabase.from('recipe_cooking_history').select('*').eq('user_id', user.id).order('cooked_at', { ascending: false }),
            supabase.from('weekly_plan_meals').select('saved_recipe_id,recipe_snapshot,cooked_at').eq('user_id', user.id).eq('is_cooked', true),
            supabase.from('recipe_collections').select('*').eq('user_id', user.id).order('name'),
            supabase.from('recipe_collection_items').select('*').eq('user_id', user.id)
        ]);

        if (manualResult.error || weeklyResult.error) {
            trackTechnicalError('expanded_history_load', manualResult.error || weeklyResult.error);
        } else {
            manualHistory = (manualResult.data || []).map(item => ({
                title: item.recipe_title,
                cooked_at: item.cooked_at,
                source: item.source
            }));
            weeklyHistory = (weeklyResult.data || []).map(item => {
                const recipeId = String(item.saved_recipe_id || '');
                if (recipeId) weeklyCounts.set(recipeId, (weeklyCounts.get(recipeId) || 0) + 1);
                return {
                    title: item.recipe_snapshot?.title,
                    cooked_at: item.cooked_at,
                    source: 'weekly_plan'
                };
            });
        }

        if (collectionsResult.error || collectionItemsResult.error) {
            trackTechnicalError('recipe_collections_load', collectionsResult.error || collectionItemsResult.error);
        } else {
            savedLibraryState.collections = collectionsResult.data || [];
            savedLibraryState.collectionItems = collectionItemsResult.data || [];
        }
    }

    savedLibraryState.recipes = (data || []).map(recipe => ({
        ...recipe,
        total_cooked: (Number(recipe.times_cooked) || 0) + (weeklyCounts.get(String(recipe.id)) || 0)
    }));
    savedLibraryState.history = [...manualHistory, ...weeklyHistory]
        .filter(item => item.cooked_at)
        .sort((a, b) => String(b.cooked_at).localeCompare(String(a.cooked_at)));
    renderSavedRecipesLibrary();
}

document.querySelectorAll('.saved-library-tab').forEach(button => {
    button.addEventListener('click', () => {
        savedLibraryState.view = button.dataset.libraryView;
        if (savedLibraryState.view === 'history') {
            trackAnalyticsEvent('screen_view', { screen: 'cooking_history' });
        }
        renderSavedRecipesLibrary();
    });
});

document.getElementById('saved-recipe-search').addEventListener('input', event => {
    savedLibraryState.search = event.target.value;
    renderSavedRecipesLibrary();
});

document.getElementById('saved-recipe-sort').addEventListener('change', event => {
    savedLibraryState.sort = event.target.value;
    trackAnalyticsEvent('saved_recipes_sorted', { sort: event.target.value });
    renderSavedRecipesLibrary();
});

document.getElementById('saved-collection-filter').addEventListener('change', event => {
    savedLibraryState.collectionFilter = event.target.value;
    trackAnalyticsEvent('recipe_collection_filtered', {
        filtered: event.target.value !== 'all'
    });
    renderSavedRecipesLibrary();
});

document.getElementById('create-collection-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (currentPlanState.plan !== 'premium') return;

    const input = document.getElementById('new-collection-name');
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!name) {
        showAlert('Falta el nombre', 'Escribí un nombre para la colección.', 'warning');
        return;
    }
    if (savedLibraryState.collections.length >= 30) {
        showAlert('Límite alcanzado', 'Podés crear hasta 30 colecciones.', 'warning');
        return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const { error } = await supabase.from('recipe_collections').insert({
        user_id: user.id,
        name: name.slice(0, 40)
    });
    submitButton.disabled = false;

    if (error) {
        trackTechnicalError('recipe_collection_create', error);
        const message = error.message?.includes('duplicate')
            ? 'Ya existe una colección con ese nombre.'
            : 'No se pudo crear la colección.';
        showAlert('Error', message, 'error');
        return;
    }

    input.value = '';
    trackAnalyticsEvent('recipe_collection_created', {
        collection_count: savedLibraryState.collections.length + 1
    });
    await loadSavedRecipes();
});

window.deleteRecipeCollection = async function(collectionId) {
    if (currentPlanState.plan !== 'premium') return;
    const collection = savedLibraryState.collections.find(item => item.id === collectionId);
    if (!collection || !window.confirm(`¿Eliminar la colección “${collection.name}”? Las recetas no se borrarán.`)) return;

    const { error } = await supabase.from('recipe_collections').delete().eq('id', collectionId);
    if (error) {
        trackTechnicalError('recipe_collection_delete', error);
        showAlert('Error', 'No se pudo eliminar la colección.', 'error');
        return;
    }

    if (savedLibraryState.collectionFilter === collectionId) savedLibraryState.collectionFilter = 'all';
    trackAnalyticsEvent('recipe_collection_deleted');
    await loadSavedRecipes();
};

window.addRecipeToCollection = async function(recipeId, collectionId) {
    if (currentPlanState.plan !== 'premium' || !collectionId) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('recipe_collection_items').insert({
        collection_id: collectionId,
        user_id: user.id,
        saved_recipe_id: String(recipeId)
    });
    if (error) {
        trackTechnicalError('recipe_collection_item_add', error);
        showAlert('Error', 'No se pudo agregar la receta a la colección.', 'error');
        return;
    }

    trackAnalyticsEvent('recipe_added_to_collection');
    await loadSavedRecipes();
};

window.removeRecipeFromCollection = async function(recipeId, collectionId) {
    if (currentPlanState.plan !== 'premium') return;
    const { error } = await supabase
        .from('recipe_collection_items')
        .delete()
        .eq('collection_id', collectionId)
        .eq('saved_recipe_id', String(recipeId));
    if (error) {
        trackTechnicalError('recipe_collection_item_remove', error);
        showAlert('Error', 'No se pudo quitar la receta de la colección.', 'error');
        return;
    }

    trackAnalyticsEvent('recipe_removed_from_collection');
    await loadSavedRecipes();
};

window.togglePinnedRecipe = async function(recipeId, isPinned) {
    if (currentPlanState.plan !== 'premium') return;
    const { error } = await supabase
        .from('saved_recipes')
        .update({ is_pinned: Boolean(isPinned), updated_at: new Date().toISOString() })
        .eq('id', recipeId);

    if (error) {
        trackTechnicalError('saved_recipe_pin', error);
        showAlert('Error', 'No se pudo actualizar la receta fijada.', 'error');
        return;
    }
    trackAnalyticsEvent('saved_recipe_pinned', { pinned: Boolean(isPinned) });
    await loadSavedRecipes();
};

window.updateSavedRecipeRating = async function(recipeId, value) {
    if (currentPlanState.plan !== 'premium') return;
    const rating = value === '' ? null : Number(value);
    const { error } = await supabase
        .from('saved_recipes')
        .update({ rating, updated_at: new Date().toISOString() })
        .eq('id', recipeId);

    if (error) {
        trackTechnicalError('saved_recipe_rating', error);
        showAlert('Error', 'No se pudo guardar la valoración.', 'error');
        return;
    }
    trackAnalyticsEvent('saved_recipe_rated', { has_rating: rating !== null });
};

window.saveRecipeNote = async function(recipeId, note) {
    if (currentPlanState.plan !== 'premium') return;
    const { error } = await supabase
        .from('saved_recipes')
        .update({ personal_note: String(note || '').trim().slice(0, 500) || null, updated_at: new Date().toISOString() })
        .eq('id', recipeId);

    if (error) {
        trackTechnicalError('saved_recipe_note', error);
        showAlert('Error', 'No se pudo guardar la nota.', 'error');
        return;
    }
    trackAnalyticsEvent('saved_recipe_note_updated', { has_note: Boolean(String(note || '').trim()) });
    showAlert('Nota guardada', 'Tu nota privada quedó actualizada.', 'success');
};

window.deleteRecipe = async function(id, event) {
    if (event) {
        event.stopPropagation(); 
        event.preventDefault();
    }

    const { error } = await supabase.from('saved_recipes').delete().eq('id', id);

    if (error) {
        trackTechnicalError('recipe_delete', error);
        showAlert('Error al borrar', 'No se pudo eliminar: ' + error.message, 'error');
    } else {
        trackAnalyticsEvent('recipe_deleted');
        showAlert('Eliminada', 'La receta fue removida de tus favoritas.', 'info');
        loadSavedRecipes();
    }
}

window.enviarPorWhatsApp = function(recipeTitle, missingArray) {
    if (!missingArray || missingArray.length === 0) return;

    let mensaje = `Estaba revisando lo que tenemos para cocinar y encontre esta receta para hacer (${recipeTitle}), pero nos faltan estos ingredientes:\n\n`;
    missingArray.forEach(item => {
        mensaje += `🛒 - ${item}\n`;
    });
    mensaje += `\n¿Me haces el favor de comprarlos de camino a casa? ¡Gracias! ❤️`;

    window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank');
}

window.marcarCocinada = async function(recipeId) {
    const { data, error } = await supabase.rpc('record_recipe_cooked', {
        p_recipe_id: String(recipeId),
        p_source: 'favorites'
    });

    if (error) {
        trackTechnicalError('recipe_mark_cooked', error);
        showAlert('Error', 'No se pudo registrar la cocinada.', 'error');
    } else {
        const nuevoTotal = Number(data?.times_cooked) || 1;
        trackAnalyticsEvent('recipe_marked_cooked', {
            recipe_id: await crearHuellaPrivada(recipeId),
            cooked_count: nuevoTotal
        });
        showAlert('🍳 ¡Buen provecho!', `Esta receta ya te salvó ${nuevoTotal} veces.`, 'info');
        setTimeout(() => loadSavedRecipes(), 800);
    }
}

let currentCookingAnalytics = null;

// Función para abrir el Modo Cocina con los pasos de la receta
async function abrirModoCocina(tituloReceta, pasosArray, source = 'recipe_card') {
    const vistaCocina = document.getElementById('cooking-mode-view');
    const tituloEl = document.getElementById('cooking-recipe-title');
    const container = document.getElementById('cooking-steps-container');
    
    tituloEl.textContent = tituloReceta;
    container.innerHTML = '';

    // Filtrar estrictamente para eliminar elementos vacíos, nulos o con espacios en blanco
    const pasosLimpios = Array.isArray(pasosArray) 
        ? pasosArray.map(p => typeof p === 'string' ? p.trim() : p).filter(p => p && p.length > 0)
        : [];
    const progresoKey = obtenerClaveProgresoCocina(tituloReceta, pasosLimpios);
    const pasosCompletados = obtenerProgresoCocina(progresoKey);
    currentCookingAnalytics = {
        recipe_id: await obtenerIdReceta(tituloReceta),
        finished_tracked: pasosLimpios.length > 0 && pasosLimpios.every((_, index) => Boolean(pasosCompletados[index]))
    };

    trackAnalyticsEvent('recipe_opened', {
        recipe_id: currentCookingAnalytics.recipe_id,
        source
    });
    trackAnalyticsEvent('cooking_started', {
        recipe_id: currentCookingAnalytics.recipe_id,
        source,
        step_count: pasosLimpios.length,
        completed_step_count: pasosCompletados.filter(Boolean).length
    });
    trackAnalyticsEvent('screen_view', { screen: 'cooking_mode' });

    // Generar las tarjetas de pasos dinámicamente solo con los pasos limpios
    pasosLimpios.forEach((paso, index) => {
        const stepCard = document.createElement('div');
        stepCard.className = 'cooking-step-card';
        stepCard.classList.toggle('completed', Boolean(pasosCompletados[index]));
        stepCard.innerHTML = `
            <div class="cooking-step-number">${index + 1}</div>
            <div class="cooking-step-text">${paso}</div>
        `;

        // Evento para marcar/desmarcar el paso al tocarlo
        stepCard.addEventListener('click', () => {
            stepCard.classList.toggle('completed');
            guardarProgresoCocina(progresoKey, container);
            actualizarProgresoCocina();

            const completedCards = container.querySelectorAll('.cooking-step-card.completed').length;
            const totalCards = container.querySelectorAll('.cooking-step-card').length;

            if (stepCard.classList.contains('completed')) {
                trackAnalyticsEvent('cooking_step_completed', {
                    recipe_id: currentCookingAnalytics?.recipe_id || null,
                    step_number: index + 1,
                    completed_step_count: completedCards,
                    step_count: totalCards
                });
            }

            if (totalCards > 0 && completedCards === totalCards && !currentCookingAnalytics?.finished_tracked) {
                if (currentCookingAnalytics) currentCookingAnalytics.finished_tracked = true;
                trackAnalyticsEvent('cooking_finished', {
                    recipe_id: currentCookingAnalytics?.recipe_id || null,
                    step_count: totalCards
                });
            }
        });

        container.appendChild(stepCard);
    });

    actualizarProgresoCocina();
    
    // Mostrar la vista de modo cocina
    vistaCocina.classList.add('active');
    if (window.lucide) lucide.createIcons();
}

const COOKING_PROGRESS_STORAGE_PREFIX = 'alacena.cookingProgress.v1.';

function obtenerClaveProgresoCocina(tituloReceta, pasos) {
    return `${COOKING_PROGRESS_STORAGE_PREFIX}${encodeURIComponent(JSON.stringify([tituloReceta, pasos]))}`;
}

function obtenerProgresoCocina(clave) {
    try {
        const progreso = JSON.parse(localStorage.getItem(clave));
        return Array.isArray(progreso) ? progreso : [];
    } catch (error) {
        return [];
    }
}

function guardarProgresoCocina(clave, container) {
    const progreso = [...container.querySelectorAll('.cooking-step-card')]
        .map(paso => paso.classList.contains('completed'));
    localStorage.setItem(clave, JSON.stringify(progreso));
}

// Función para actualizar la barra de progreso interna
function actualizarProgresoCocina() {
    const total = document.querySelectorAll('.cooking-step-card').length;
    const completados = document.querySelectorAll('.cooking-step-card.completed').length;
    
    const porcentaje = total > 0 ? (completados / total) * 100 : 0;
    const fillEl = document.getElementById('cooking-progress-fill');
    const textEl = document.getElementById('cooking-progress-text');

    fillEl.style.width = `${porcentaje}%`;

    const todoListo = total > 0 && completados === total;
    fillEl.classList.toggle('all-done', todoListo);
    textEl.classList.toggle('all-done', todoListo);
    textEl.textContent = todoListo
        ? `¡Listo! ${total} de ${total} pasos completados 🎉`
        : `Paso ${completados} de ${total} completados`;
}

// Botón para cerrar el modo cocina
document.getElementById('close-cooking-btn').addEventListener('click', () => {
    document.getElementById('cooking-mode-view').classList.remove('active');
    trackAnalyticsEvent('screen_view', { screen: 'cook' });
});

// Escucha global para abrir el modo cocina de forma segura
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-abrir-cocina');
    if (!btn) return;
    
    const titulo = decodeURIComponent(btn.getAttribute('data-title'));
    const pasos = JSON.parse(decodeURIComponent(btn.getAttribute('data-steps')));
    
    abrirModoCocina(titulo, pasos, 'recipe_card');
});

let timerInterval = null;
let timeLeftSeconds = 0;
let isTimerRunning = false;
let timerEndTimestamp = null;
const TIMER_STORAGE_KEY = 'alacena.cookingTimer.v1';

// Actualiza el texto en pantalla del timer
function actualizarDisplayTimer() {
    const mins = Math.floor(timeLeftSeconds / 60);
    const secs = timeLeftSeconds % 60;
    const displayStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    const displayEl = document.getElementById('cooking-timer-display');
    if (displayEl) displayEl.textContent = displayStr;
}

function guardarTimer() {
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify({
        timeLeftSeconds,
        isTimerRunning,
        timerEndTimestamp
    }));
}

function sincronizarTimerConHoraActual() {
    if (!isTimerRunning || !timerEndTimestamp) return false;

    timeLeftSeconds = Math.max(0, Math.ceil((timerEndTimestamp - Date.now()) / 1000));
    return timeLeftSeconds === 0;
}

function actualizarBotonTimer() {
    const toggleBtn = document.getElementById('timer-toggle-btn');
    if (!toggleBtn) return;

    toggleBtn.textContent = isTimerRunning ? 'Pausar' : (timeLeftSeconds > 0 ? 'Reanudar' : 'Iniciar');
    toggleBtn.classList.toggle('running', isTimerRunning);
}

function finalizarTimer() {
    clearInterval(timerInterval);
    isTimerRunning = false;
    timerEndTimestamp = null;
    timeLeftSeconds = 0;
    guardarTimer();
    actualizarDisplayTimer();
    actualizarBotonTimer();
    trackAnalyticsEvent('timer_finished');

    // Efecto visual y vibración inicial
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200, 100, 300]);

    const cajaTimer = document.querySelector('.cooking-timer-box');
    if (cajaTimer) cajaTimer.classList.add('timer-alarm');

    reproducirPitidoAlarma();
    if (alarmaInterval) clearInterval(alarmaInterval);
    alarmaInterval = setInterval(reproducirPitidoAlarma, 400);

    showAlert('⏰ ¡Tiempo cumplido!', 'El temporizador de cocina ha finalizado. Presiona reiniciar o cambiar tiempo para apagar la alarma.', 'warning');
}

function iniciarActualizacionTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (sincronizarTimerConHoraActual()) {
            finalizarTimer();
        } else {
            actualizarDisplayTimer();
            guardarTimer();
        }
    }, 1000);
}

function restaurarTimer() {
    try {
        const timerGuardado = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY));
        if (!timerGuardado) return;

        timeLeftSeconds = Number(timerGuardado.timeLeftSeconds) || 0;
        isTimerRunning = Boolean(timerGuardado.isTimerRunning);
        timerEndTimestamp = Number(timerGuardado.timerEndTimestamp) || null;

        if (sincronizarTimerConHoraActual()) {
            finalizarTimer();
            return;
        }

        actualizarDisplayTimer();
        actualizarBotonTimer();
        if (isTimerRunning) iniciarActualizacionTimer();
    } catch (error) {
        localStorage.removeItem(TIMER_STORAGE_KEY);
    }
}

// Iniciar o pausar el timer
// Función para reproducir un sonido de alarma electrónico
let alarmaInterval = null; // Variable para controlar el bucle del sonido

// Función para reproducir un pitido individual de alarma
function reproducirPitidoAlarma() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // Tono agudo
        
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.2);
    } catch (e) {
        console.warn("Audio Context bloqueado o no soportado:", e);
    }
}

function toggleTimer() {
    if (isTimerRunning) {
        sincronizarTimerConHoraActual();
        clearInterval(timerInterval);
        isTimerRunning = false;
        timerEndTimestamp = null;
        guardarTimer();
        actualizarDisplayTimer();
        actualizarBotonTimer();
        trackAnalyticsEvent('timer_paused', {
            remaining_seconds: timeLeftSeconds
        });
    } else {
        if (timeLeftSeconds <= 0) return;
        
        isTimerRunning = true;
        timerEndTimestamp = Date.now() + (timeLeftSeconds * 1000);
        guardarTimer();
        actualizarBotonTimer();
        trackAnalyticsEvent('timer_started', {
            configured_minutes: Math.ceil(timeLeftSeconds / 60),
            remaining_seconds: timeLeftSeconds
        });

        const cajaTimer = document.querySelector('.cooking-timer-box');
        if (cajaTimer) cajaTimer.classList.remove('timer-alarm');
        
        iniciarActualizacionTimer();
    }
}

// Eventos de control para los botones del timer
document.addEventListener('click', (e) => {
    // Botones de minutos predeterminados (+1, +3, +5, +10)
    if (e.target.classList.contains('timer-preset-btn')) {
        const minutesToAdd = parseInt(e.target.getAttribute('data-time'), 10);
        sincronizarTimerConHoraActual();
        timeLeftSeconds += minutesToAdd * 60;
        if (isTimerRunning) timerEndTimestamp = Date.now() + (timeLeftSeconds * 1000);
        guardarTimer();
        actualizarDisplayTimer();
        trackAnalyticsEvent('timer_configured', {
            minutes_added: minutesToAdd,
            configured_minutes: Math.ceil(timeLeftSeconds / 60)
        });
    }
    
    // Botón Iniciar / Pausar
    if (e.target.id === 'timer-toggle-btn') {
        toggleTimer();
    }
    
    // Botón Reset
    // Botón Reset (asegúrate de agregar esta línea en tu manejador de reset existente)
if (e.target.id === 'timer-reset-btn' || e.target.closest('#timer-reset-btn')) {
    const previousSeconds = timeLeftSeconds;
    const wasRunning = isTimerRunning;
    clearInterval(timerInterval);
    clearInterval(alarmaInterval); // <--- Esto detiene el sonido sin parar
    isTimerRunning = false;
    timeLeftSeconds = 0;
    timerEndTimestamp = null;
    guardarTimer();
    actualizarDisplayTimer();
        trackAnalyticsEvent('timer_reset', {
            previous_seconds: previousSeconds,
            was_running: wasRunning
        });
        const toggleBtn = document.getElementById('timer-toggle-btn');
        if (toggleBtn) {
            toggleBtn.textContent = 'Iniciar';
            toggleBtn.classList.remove('running');
        }
        const cajaTimer = document.querySelector('.cooking-timer-box');
        if (cajaTimer) cajaTimer.classList.remove('timer-alarm');
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (sincronizarTimerConHoraActual()) {
        finalizarTimer();
    } else {
        actualizarDisplayTimer();
        guardarTimer();
    }
});

restaurarTimer();

// =========================================================
// MÓDULO AISLADO: RECUPERACIÓN DE MODO COCINA (CORREGIDO)
// =========================================================
(function() {
    const CLAVE_COCINA = 'alacena.activeCookingSession.v1';

    function guardarSesion(title, steps) {
        if (!title || !steps) return;
        localStorage.setItem(CLAVE_COCINA, JSON.stringify({ title, steps }));
        actualizarBotonRecuperar();
    }

    function borrarSesion() {
        localStorage.removeItem(CLAVE_COCINA);
        actualizarBotonRecuperar();
    }

    // 1. Guardar receta al abrir normalmente desde las tarjetas
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-abrir-cocina');
        if (!btn) return;

        try {
            const title = decodeURIComponent(btn.getAttribute('data-title'));
            const steps = JSON.parse(decodeURIComponent(btn.getAttribute('data-steps')));
            guardarSesion(title, steps);
        } catch (err) {
            console.warn('Error al respaldar receta activa:', err);
        }
    });

    // 2. Controlar visibilidad del widget de recuperación
    function actualizarBotonRecuperar() {
        const btnResume = document.getElementById('btn-resume-cooking');
        const labelTitle = document.getElementById('cooking-resume-title');
        const guardado = localStorage.getItem(CLAVE_COCINA);

        if (!btnResume) return;

        if (guardado) {
            try {
                const { title } = JSON.parse(guardado);
                if (labelTitle) labelTitle.textContent = title;
                btnResume.classList.remove('hidden');
            } catch (e) {
                btnResume.classList.add('hidden');
            }
        } else {
            btnResume.classList.add('hidden');
        }
    }

    // 3. Monitorear cuando se completan las tarjetas de pasos (.cooking-step-card)
    document.addEventListener('click', (e) => {
        const stepCard = e.target.closest('.cooking-step-card');
        const btnCerrar = e.target.closest('#close-cooking-btn, #finish-cooking-btn, .btn-finalizar-cocina');

        // Si tocó un paso, verificamos después de que tu función nativa alterne la clase .completed
        if (stepCard) {
            setTimeout(() => {
                const tarjetas = document.querySelectorAll('.cooking-step-card');
                const completadas = document.querySelectorAll('.cooking-step-card.completed');

                if (tarjetas.length > 0 && tarjetas.length === completadas.length) {
                    borrarSesion();
                }
            }, 50);
        }

        // Si toca el botón de cerrar o finalizar
        if (btnCerrar) {
            const tarjetas = document.querySelectorAll('.cooking-step-card');
            const completadas = document.querySelectorAll('.cooking-step-card.completed');

            if ((tarjetas.length > 0 && tarjetas.length === completadas.length) || e.target.closest('#finish-cooking-btn, .btn-finalizar-cocina')) {
                borrarSesion();
            } else {
                actualizarBotonRecuperar();
            }
        }
    });

    // 4. Reabrir receta guardada desde el widget
    document.addEventListener('click', (e) => {
        const btnResume = e.target.closest('#btn-resume-cooking');
        if (!btnResume) return;

        const guardado = localStorage.getItem(CLAVE_COCINA);
        if (!guardado) return;

        try {
            const { title, steps } = JSON.parse(guardado);
            if (typeof window.abrirModoCocina === 'function') {
                window.abrirModoCocina(title, steps, 'resume_widget');
            } else if (typeof abrirModoCocina === 'function') {
                abrirModoCocina(title, steps, 'resume_widget');
            }
            actualizarBotonRecuperar();
        } catch (err) {
            console.error('Error al reabrir modo cocina:', err);
        }
    });

    window.addEventListener('load', actualizarBotonRecuperar);
})();

// =========================================================
// PERSISTENCIA DE RECETAS EN PANTALLA (PREVIENE PÉRDIDA)
// =========================================================
(function() {
    const CLAVE_RECETAS_PANTALLA = 'alacena.recetasEnPantalla.v1';

    // 1. Guardar el HTML del contenedor de recetas cada vez que cambia
    const observarRecetas = () => {
        const contenedor = document.getElementById('recipes-container') || document.getElementById('view-cook');
        if (!contenedor) return;

        const observer = new MutationObserver(() => {
            if (contenedor.children.length > 0) {
                localStorage.setItem(CLAVE_RECETAS_PANTALLA, contenedor.innerHTML);
            }
        });

        observer.observe(contenedor, { childList: true, subtree: true });
    };

    // 2. Restaurar las recetas al cargar si el usuario no tocó "Generar nuevas"
    window.addEventListener('load', () => {
        const contenedor = document.getElementById('recipes-container') || document.getElementById('view-cook');
        const guardadas = localStorage.getItem(CLAVE_RECETAS_PANTALLA);

        if (contenedor && guardadas && contenedor.children.length === 0) {
            contenedor.innerHTML = guardadas;
            if (window.lucide) lucide.createIcons();
        }
        observarRecetas();
    });

    // 3. Borrar las recetas guardadas SOLO cuando toca "Generar nuevas recetas"
    document.addEventListener('click', (e) => {
        const btnGenerar = e.target.closest('#btn-generate-recipes, .btn-generar-recetas');
        if (btnGenerar) {
            localStorage.removeItem(CLAVE_RECETAS_PANTALLA);
        }
    });
})();

// Listener para borrar las recetas de la pantalla (sin borrar la receta en curso)
document.addEventListener('click', (e) => {
    const btnBorrar = e.target.closest('#btn-delete-recipes');
    if (!btnBorrar) return;

    const contenedor = document.getElementById('recipes-container');
    
    if (contenedor) {
        const deletedRecipeCount = contenedor.querySelectorAll('.recipe-card-container').length;

        // 1. Vaciar únicamente el contenedor de recetas visuales
        contenedor.innerHTML = '';
        
        // 2. Borrar SOLO las recetas de pantalla de la memoria
        localStorage.removeItem('alacena.recetasEnPantalla.v1');

        trackAnalyticsEvent('recipes_cleared', {
            recipe_count: deletedRecipeCount
        });
        
        // ¡OJO! No tocamos 'alacena.activeCookingSession.v1' para mantener la receta en curso activa.
    }
});
