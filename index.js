require('dotenv').config(); // Carga las variables del archivo .env (solo en local)
const express = require('express');
const path = require('path');
const { handleRecipeRequest } = require('./lib/recipe-service');
const { handlePremiumPaymentConfig } = require('./lib/premium-payment-config');

const app = express();

// Middleware para entender JSON y servir archivos estáticos
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// La misma ruta funciona en local y en el despliegue serverless.
app.post('/generar-receta', handleRecipeRequest);
app.post('/api/generar-receta', handleRecipeRequest);
app.get('/api/premium-payment-config', handlePremiumPaymentConfig);

// Arrancar el servidor (solo relevante en local; Vercel usa module.exports)
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor "Alacena" funcionando en http://localhost:${PORT}`);
    });
}

module.exports = app;
