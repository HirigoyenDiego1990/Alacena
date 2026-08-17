const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODELO_PRINCIPAL = "gemini-3.5-flash-lite";
const MODELO_RESPALDO = "gemini-3.6-flash";

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function generarConReintentos(nombreModelo, prompt, intentos = 3) {
    const model = genAI.getGenerativeModel({ model: nombreModelo });
    for (let intento = 1; intento <= intentos; intento++) {
        try {
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            const esSaturado = error.status === 503 || error.status === 429;
            if (!esSaturado || intento === intentos) throw error;
            await esperar(1000 * Math.pow(2, intento - 1));
        }
    }
}

module.exports = async (req, res) => {
    // Permitir solo peticiones POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Método no permitido" });
    }

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
            rawText = await generarConReintentos(MODELO_PRINCIPAL, prompt, 3);
        } catch (errorPrincipal) {
            const esSaturado = errorPrincipal.status === 503 || errorPrincipal.status === 429;
            if (!esSaturado) throw errorPrincipal;
            rawText = await generarConReintentos(MODELO_RESPALDO, prompt, 2);
        }

        rawText = rawText.trim().replace(/```json/g, '').replace(/```/g, '').trim();
        const recetas = JSON.parse(rawText);
        return res.status(200).json({ recipes: recetas });
    } catch (error) {
        console.error("=== ERROR EN GEMINI ===", error.message);
        return res.status(500).json({ error: "Error al generar la receta", detalle: error.message });
    }
};