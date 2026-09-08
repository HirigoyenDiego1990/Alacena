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
const ingredientQuantityInput = document.getElementById('ingredient-quantity');
const ingredientUnitInput = document.getElementById('ingredient-unit');
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
        void obtenerMetricasIngredientes(data).then(metrics => {
            trackAnalyticsEvent('ingredient_inventory_snapshot', metrics);
        });
    } else if (error) {
        trackTechnicalError('pantry_load', error);
    }
}

addIngredientBtn.addEventListener('click', async () => {
    const val = ingredientInput.value.trim();
    const quantity = Number(ingredientQuantityInput?.value);
    const unit = ingredientUnitInput?.value || 'unidad';
    if (!val) return;

    if (!Number.isFinite(quantity) || quantity <= 0) {
        showAlert('Cantidad inválida', 'Ingresá una cantidad mayor que cero.', 'warning');
        return;
    }

    if (currentPlanState.pantry_limit !== null && userIngredients.length >= currentPlanState.pantry_limit) {
        showAlert('Límite del plan Free', `Podés guardar hasta ${currentPlanState.pantry_limit} ingredientes.`, 'warning');
        return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    
    const { error } = await supabase.from('pantry').insert([{
        user_id: user.id,
        ingredient: val,
        quantity,
        unit
    }]);
    if (!error) {
        ingredientInput.value = '';
        if (ingredientQuantityInput) ingredientQuantityInput.value = '1';
        await loadPantry();
        const ingredientId = await crearHuellaPrivada(val);
        trackAnalyticsEvent('ingredient_added', {
            ingredient_id: ingredientId,
            ingredient_count: userIngredients.length,
            quantity,
            unit
        });
    } else {
        trackTechnicalError('ingredient_add', error);
        if (error.message?.includes('FREE_PANTRY_LIMIT')) {
            showAlert('Límite del plan Free', 'Alcanzaste el máximo de 20 ingredientes.', 'warning');
        }
    }
});

function renderIngredients() {
    if (userIngredients.length === 0) {
        ingredientsList.innerHTML = '<span class="empty-hint">Todavía no agregaste ingredientes...</span>';
        return;
    }

    ingredientsList.innerHTML = userIngredients.map(item => `
        <span class="ingredient-chip">
            <strong>${formatearCantidad(item.quantity || 1)} ${item.unit || 'unidad'}</strong>
            ${item.ingredient}
            <button onclick="deleteIngredient('${item.id}')" class="chip-delete-btn">×</button>
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
                            <span>${formatearCantidad(item.quantity)} ${item.unit} · ${item.name}</span>
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
    return `<div class="recipe-tags">${tags.map(tag => `<span>${tag}</span>`).join('')}</div>`;
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
const tabSaved = document.getElementById('tab-saved');
const tabCook = document.querySelector('nav button:first-child');
const tabPreferences = document.getElementById('tab-preferences');
const tabWeeklyPlan = document.getElementById('tab-weekly-plan');

function mostrarSubVista(view, activeTab, screenName) {
    [viewCook, viewSaved, viewPreferences, viewWeeklyPlan, viewShoppingList].forEach(item => item?.classList.add('hidden'));
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

function renderWeeklyMealSlot(date, mealType, label) {
    const key = crearMealKey(date, mealType);
    const meal = weeklyPlanState.meals.get(key);
    const recipeId = meal?.saved_recipe_id || '';
    const options = weeklyPlanState.recipes.map(recipe => `
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
    const [recipesResult, preferencesResult] = await Promise.all([
        supabase.from('saved_recipes').select('*').eq('user_id', user.id).order('title'),
        supabase.rpc('get_my_recipe_preferences')
    ]);

    if (recipesResult.error || preferencesResult.error) {
        trackTechnicalError('weekly_plan_dependencies_load', recipesResult.error || preferencesResult.error);
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

document.getElementById('autofill-week-btn').addEventListener('click', async () => {
    if (weeklyPlanState.recipes.length === 0) {
        showAlert('Faltan favoritas', 'Guardá al menos una receta antes de completar la semana.', 'warning');
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
            const recipe = weeklyPlanState.recipes[index % weeklyPlanState.recipes.length];
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
    if (!event.target.classList.contains('shopping-item-check')) return;
    const row = event.target.closest('[data-shopping-item-id]');
    const item = shoppingListState.items.find(entry => String(entry.id) === row?.dataset.shoppingItemId);
    if (!item) return;

    const isChecked = event.target.checked;
    const { error } = await supabase
        .from('shopping_list_items')
        .update({ is_checked: isChecked, updated_at: new Date().toISOString() })
        .eq('id', item.id);

    if (error) {
        trackTechnicalError('shopping_item_check', error);
        showAlert('Error', 'No se pudo actualizar el producto.', 'error');
        event.target.checked = !isChecked;
        return;
    }

    trackAnalyticsEvent('shopping_item_checked', {
        checked: isChecked,
        source_type: item.source_type
    });
    await loadShoppingList({ syncFromPlan: false });
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

async function loadSavedRecipes() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { data, error } = await supabase.from('saved_recipes').select('*').eq('user_id', user.id);
    const container = document.getElementById('saved-recipes-list');

    if (error) {
        trackTechnicalError('saved_recipes_load', error);
    }
    
    if (data && data.length > 0) {
        container.innerHTML = data.map(recipe => {
            const structuredIngredients = renderIngredientesEstructurados(recipe.required_ingredients);
            const tagsHTML = renderRecipeTags(recipe.tags);

            return `
                <div class="recipe-card-container">
                    <button onclick="deleteRecipe('${recipe.id}', event)" class="recipe-action-btn btn-delete" title="Eliminar receta">
                        <i data-lucide="trash-2"></i>
                    </button>
                    <div>
                        <h3 class="recipe-card-title">${recipe.title}</h3>
                    </div>
                    <div class="saved-recipe-meta">
                        <span>${recipe.duration_minutes ? `${recipe.duration_minutes} min` : recipe.time} · ${recipe.difficulty} · ${recipe.servings || 2} porciones</span>
                        <span class="cooked-badge">
                            🍳 Cocinada: <strong>${recipe.times_cooked || 0}</strong> veces
                        </span>
                    </div>
                    ${tagsHTML}
                    ${structuredIngredients}
                    <p class="recipe-instructions recipe-instructions--italic">
                        ${recipe.steps ? recipe.steps.join(' ') : 'Sin pasos guardados'}
                    </p>
                    <button onclick="marcarCocinada('${recipe.id}', ${recipe.times_cooked || 0})" class="btn-cook-today">
                        ✨ ¡Cocinada hoy! (Sumar al historial)
                    </button>
                </div>
            `;
        }).join('');
        lucide.createIcons();
    } else {
        container.innerHTML = '<p class="empty-state">Aún no guardaste ninguna receta.</p>';
    }
}

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

window.marcarCocinada = async function(recipeId, currentCount) {
    const nuevoTotal = (currentCount || 0) + 1;
    const { error } = await supabase.from('saved_recipes').update({ times_cooked: nuevoTotal }).eq('id', recipeId);

    if (error) {
        trackTechnicalError('recipe_mark_cooked', error);
        showAlert('Error', 'No se pudo registrar la cocinada.', 'error');
    } else {
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
