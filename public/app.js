import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Configuración de Supabase
const SUPABASE_URL = 'https://mawixmfhfwxsnxsgpgja.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rYDmjondp3uHdqW4lIT9TA_gFXi0yxJ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session) {
        window.location.href = 'login.html';
    } else {
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
async function loadPantry() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('pantry').select('*').eq('user_id', user.id);
    if (data) {
        userIngredients = data;
        renderIngredients();
    }
}

addIngredientBtn.addEventListener('click', async () => {
    const val = ingredientInput.value.trim();
    if (!val) return;
    const { data: { user } } = await supabase.auth.getUser();
    
    const { error } = await supabase.from('pantry').insert([{ user_id: user.id, ingredient: val }]);
    if (!error) {
        ingredientInput.value = '';
        loadPantry();
    }
});

function renderIngredients() {
    ingredientsList.innerHTML = userIngredients.map(item => `
        <span class="ingredient-chip">
            ${item.ingredient}
            <button onclick="deleteIngredient('${item.id}')" class="chip-delete-btn">×</button>
        </span>
    `).join('');
}

window.deleteIngredient = async function(id) {
    await supabase.from('pantry').delete().eq('id', id);
    loadPantry();
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

    const { data, error } = await supabase.from('saved_recipes').insert([{
        user_id: user.id,
        title: recipe.title,
        time: recipe.time,
        difficulty: String(recipe.difficulty),
        ingredients: Array.isArray(userIngredients) ? userIngredients.map(i => i.ingredient) : [],
        steps: [recipe.instructions]
    }]);

    if (error) {
        showAlert('Error', 'No se pudo guardar: ' + error.message, 'error');
    } else {
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

// Función global para limpiar/reiniciar las recetas generadas
window.resetearRecetas = function() {
    recipesContainer.innerHTML = '';
    generateBtn.innerHTML = '<span>Generar Recetas Mágicas</span>';
    generateBtn.onclick = ejecutarGeneracion;
}

async function ejecutarGeneracion() {
    if (userIngredients.length === 0) {
        showAlert('Faltan ingredientes', 'Agregá al menos un ingrediente.', 'warning');
        return;
    }

    recipesContainer.innerHTML = `
        <div class="recipe-loading">
            <div class="recipe-loading-spinner"></div>
            <p class="recipe-loading-text">Cocinando ideas con IA...</p>
        </div>
    `;

// Lógica de Generación con Gemini
try {
        // Transformamos los objetos en un array de texto plano con los nombres
        const ingredientesStrings = Array.isArray(userIngredients) 
            ? userIngredients.map(i => i.ingredient) 
            : [];

        const respuesta = await fetch('/api/generar-receta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingredientes: ingredientesStrings }) // <--- Enviamos el array de strings limpio
        });

        if (!respuesta.ok) {
            const errorData = await respuesta.json().catch(() => ({}));
            throw new Error(errorData.error || `Error HTTP: ${respuesta.status} - No se pudo generar la receta.`);
        }

        const data = await respuesta.json();
        // ... el resto de tu código para mostrar las recetas ...

        const recipes = data.recipes;

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

            // Convertimos las instrucciones en array (separando por puntos o saltos de línea para el modo cocina)
            // Si la IA manda un texto largo, esto lo divide en pasos limpios
            const pasosArray = parsearPasos(recipe.instructions);

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
                        <span class="recipe-pill recipe-pill--time">${recipe.time}</span>
                        <span class="recipe-pill recipe-pill--difficulty">${recipe.difficulty}</span>
                    </div>
                    <p class="recipe-instructions">${recipe.instructions}</p>

                    ${chefTipHTML}
                    <!-- Botón para disparar el Modo Cocina -->
                    <button type="button" class="btn-cook-today btn-abrir-cocina" data-title="${encodeURIComponent(recipe.title)}" data-steps="${encodeURIComponent(JSON.stringify(pasosArray))}">
                    <i data-lucide="chef-hat"></i>
                    <span>👨‍🍳 Cocinar Paso a Paso</span>
                    </button>
                    ${botonWhatsApp}
                </div>
            `;
        }).join('');

        lucide.createIcons();

        generateBtn.innerHTML = '<span>🔄 Generar Nuevas Recetas</span>';
        generateBtn.onclick = resetearRecetas;

    } catch (error) {
        console.error("Error capturado:", error);
        showAlert('Error', error.message, 'error');
        recipesContainer.innerHTML = '';
    }

}


generateBtn.addEventListener('click', ejecutarGeneracion);

// Navegación entre vistas
const viewCook = document.getElementById('view-cook');
const viewSaved = document.getElementById('view-saved');
const tabSaved = document.getElementById('tab-saved');
const tabCook = document.querySelector('nav button:first-child');

tabSaved.addEventListener('click', () => {
    viewCook.classList.add('hidden');
    viewSaved.classList.remove('hidden');
    tabSaved.classList.replace('text-slate-400', 'text-orange-500');
    tabCook.classList.replace('text-orange-500', 'text-slate-400');
    loadSavedRecipes();
});

tabCook.addEventListener('click', () => {
    viewSaved.classList.add('hidden');
    viewCook.classList.remove('hidden');
    tabCook.classList.replace('text-slate-400', 'text-orange-500');
    tabSaved.classList.replace('text-orange-500', 'text-slate-400');
});

async function loadSavedRecipes() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { data, error } = await supabase.from('saved_recipes').select('*').eq('user_id', user.id);
    const container = document.getElementById('saved-recipes-list');
    
    if (data && data.length > 0) {
        container.innerHTML = data.map(recipe => `
            <div class="recipe-card-container">
                <button onclick="deleteRecipe('${recipe.id}', event)" class="recipe-action-btn btn-delete" title="Eliminar receta">
                    <i data-lucide="trash-2"></i>
                </button>
                <div>
                    <h3 class="recipe-card-title">${recipe.title}</h3>
                </div>
                <div class="saved-recipe-meta">
                    <span>Tiempo: ${recipe.time} | Dificultad: ${recipe.difficulty}</span>
                    <span class="cooked-badge">
                        🍳 Cocinada: <strong>${recipe.times_cooked || 0}</strong> veces
                    </span>
                </div>
                <p class="recipe-instructions recipe-instructions--italic">
                    ${recipe.steps ? recipe.steps.join(' ') : 'Sin pasos guardados'}
                </p>
                <button onclick="marcarCocinada('${recipe.id}', ${recipe.times_cooked || 0})" class="btn-cook-today">
                    ✨ ¡Cocinada hoy! (Sumar al historial)
                </button>
            </div>
        `).join('');
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
        showAlert('Error al borrar', 'No se pudo eliminar: ' + error.message, 'error');
    } else {
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

window.modoEmergencia = function() {
    const inputField = document.getElementById('ingredient-input');
    if (!inputField) return;

    const bancoRandom = [
        "huevo", "arroz", "fideos", "lata de atún", "medio tomate", 
        "queso rallado", "pan lactal viejo", "cebolla", "pimiento triste", 
        "lata de arvejas", "morrón", "paté", "caldo en cubo", "limón", "polenta"
    ];

    const cantidadAElegir = Math.floor(Math.random() * 3) + 3;
    const elegidos = bancoRandom.sort(() => 0.5 - Math.random()).slice(0, cantidadAElegir);

    inputField.value = elegidos.join(', ');
    showAlert('🚨 Ruleta de Supervivencia', `Heladera en cero. El azar dictaminó: [${inputField.value}]. ¡A cocinar!`, 'info');
    ejecutarGeneracion();
}

window.marcarCocinada = async function(recipeId, currentCount) {
    const nuevoTotal = (currentCount || 0) + 1;
    const { error } = await supabase.from('saved_recipes').update({ times_cooked: nuevoTotal }).eq('id', recipeId);

    if (error) {
        showAlert('Error', 'No se pudo registrar la cocinada.', 'error');
    } else {
        showAlert('🍳 ¡Buen provecho!', `Esta receta ya te salvó ${nuevoTotal} veces.`, 'info');
        setTimeout(() => loadSavedRecipes(), 800);
    }
}

// Función para abrir el Modo Cocina con los pasos de la receta
function abrirModoCocina(tituloReceta, pasosArray) {
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
});

// Escucha global para abrir el modo cocina de forma segura
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-abrir-cocina');
    if (!btn) return;
    
    const titulo = decodeURIComponent(btn.getAttribute('data-title'));
    const pasos = JSON.parse(decodeURIComponent(btn.getAttribute('data-steps')));
    
    abrirModoCocina(titulo, pasos);
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
    } else {
        if (timeLeftSeconds <= 0) return;
        
        isTimerRunning = true;
        timerEndTimestamp = Date.now() + (timeLeftSeconds * 1000);
        guardarTimer();
        actualizarBotonTimer();

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
    }
    
    // Botón Iniciar / Pausar
    if (e.target.id === 'timer-toggle-btn') {
        toggleTimer();
    }
    
    // Botón Reset
    // Botón Reset (asegúrate de agregar esta línea en tu manejador de reset existente)
if (e.target.id === 'timer-reset-btn' || e.target.closest('#timer-reset-btn')) {
    clearInterval(timerInterval);
    clearInterval(alarmaInterval); // <--- Esto detiene el sonido sin parar
    isTimerRunning = false;
    timeLeftSeconds = 0;
    timerEndTimestamp = null;
    guardarTimer();
    actualizarDisplayTimer();
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

// ============================================
// RECUPERACIÓN AUTOMÁTICA DEL MODO COCINA
// ============================================

/**
 * Verifica si el usuario salió involuntariamente del Modo Cocina
 * y restaura el estado exacto donde lo dejó (receta, pasos marcados y barra de progreso).
 */
window.recuperarEstadoModoCocina = function() {
    const sesionGuardada = localStorage.getItem(ACTIVE_COOKING_SESSION_KEY);
    
    if (!sesionGuardada) return false;

    try {
        const { title, steps } = JSON.parse(sesionGuardada);

        if (!title || !Array.isArray(steps) || steps.length === 0) {
            localStorage.removeItem(ACTIVE_COOKING_SESSION_KEY);
            return false;
        }

        // Reabre el Modo Cocina con la receta activa recuperada
        abrirModoCocina(title, steps);
        return true;
    } catch (error) {
        console.error("Error al intentar recuperar la sesión del Modo Cocina:", error);
        localStorage.removeItem(ACTIVE_COOKING_SESSION_KEY);
        return false;
    }
};

// Intentar la recuperación automáticamente al cargar/reconectar la app
document.addEventListener('DOMContentLoaded', () => {
    recuperarEstadoModoCocina();
});