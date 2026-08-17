require('dotenv').config(); // Carga las variables del archivo .env (solo en local)
const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();

// Middleware para entender JSON y servir archivos estáticos
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de Gemini (la key SOLO existe acá, en el servidor)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Modelo principal y modelo de respaldo si el principal está saturado (503)
const MODELO_PRINCIPAL = "gemini-3.5-flash-lite";
const MODELO_RESPALDO = "gemini-3.6-flash";

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Intenta generar contenido con un modelo dado, reintentando en 503/429
async function generarConReintentos(nombreModelo, prompt, intentos = 3) {
    const model = genAI.getGenerativeModel({ model: nombreModelo });

    for (let intento = 1; intento <= intentos; intento++) {
        try {
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            const esSaturado = error.status === 503 || error.status === 429;
            const esUltimoIntento = intento === intentos;

            console.error(`[${nombreModelo}] Intento ${intento}/${intentos} falló:`, error.message);

            if (!esSaturado || esUltimoIntento) {
                throw error; // Error real (no saturación) o se acabaron los intentos: propagar
            }

            // Backoff exponencial: 1s, 2s, 4s...
            await esperar(1000 * Math.pow(2, intento - 1));
        }
    }
}

// Ruta para recibir ingredientes y devolver recetas
app.post('/generar-receta', async (req, res) => {
    const { ingredientes } = req.body;

    if (!ingredientes || !Array.isArray(ingredientes) || ingredientes.length === 0) {
        return res.status(400).json({ error: "Debes enviar al menos un ingrediente." });
    }

    const listaIngredientes = ingredientes.join(', ');

    const prompt = `Eres un chef experto y amigable. Con los ingredientes disponibles: [${listaIngredientes}], genera de 4 a 5 recetas variadas. Si los ingredientes listados son extraños, random o muy pocos, actúa como un chef de reality show de supervivencia que hace magia culinaria sin juzgar al usuario.
Sigue estrictamente estas reglas:
1. Divide las recetas en dos tipos para el campo "type": usa "alacena" para las que se hacen 100% con los ingredientes listados (o sal/agua/aceite básicos), y "sugerencia" para las que requieren comprar 1 o 2 ingredientes extra.
2. Si la receta es de tipo "alacena", el campo "missing_ingredients" debe ser un array vacío [].
3. Si la receta es de tipo "sugerencia", el campo "missing_ingredients" DEBE incluir una lista con los ingredientes exactos que el usuario necesita comprar para hacerla.
4. Incluye un consejo breve y motivacional en el campo "chef_tip" sobre cómo esta receta ayuda a la economía del hogar o evita el desperdicio de comida.

Responde SOLO con un array JSON válido sin texto adicional ni markdown. Debe tener exactamente esta estructura:
[
  {
    "title": "Ejemplo con lo que tengo",
    "time": "15 min",
    "difficulty": "Fácil",
    "instructions": "Pasos detallados...",
    "type": "alacena",
    "missing_ingredients": [],
    "chef_tip": "Aprovecharás ese excedente de la alacena sin gastar un peso extra."
  }
]`;

    try {
        let rawText;
        try {
            // Primero probamos con reintentos en el modelo principal
            rawText = await generarConReintentos(MODELO_PRINCIPAL, prompt, 3);
        } catch (errorPrincipal) {
            const esSaturado = errorPrincipal.status === 503 || errorPrincipal.status === 429;
            if (!esSaturado) throw errorPrincipal;

            // Si el principal sigue saturado después de reintentar, probamos el de respaldo
            console.warn(`Modelo principal (${MODELO_PRINCIPAL}) saturado tras reintentos. Probando respaldo (${MODELO_RESPALDO})...`);
            rawText = await generarConReintentos(MODELO_RESPALDO, prompt, 2);
        }

        rawText = rawText.trim().replace(/```json/g, '').replace(/```/g, '').trim();
        const recetas = JSON.parse(rawText);
        res.json({ recipes: recetas });
    } catch (error) {
        console.error("=== ERROR EN GEMINI ===");
        console.error("Mensaje:", error.message);
        console.error("Status:", error.status || error.statusText || "sin status");
        console.error("========================");

        const esSaturado = error.status === 503 || error.status === 429;
        const mensajeUsuario = esSaturado
            ? "Los servidores de IA están saturados en este momento. Probá de nuevo en unos segundos."
            : "Error al generar la receta";

        res.status(esSaturado ? 503 : 500).json({ error: mensajeUsuario, detalle: error.message });
    }
});

// Arrancar el servidor (solo relevante en local; Vercel usa module.exports)
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor "Alacena" funcionando en http://localhost:${PORT}`);
    });
}

module.exports = app;