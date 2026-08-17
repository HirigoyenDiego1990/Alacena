// Ejemplo para tu script de login (ej: login.js)
// Asumiendo que usas Supabase:

// Reemplaza con tus datos reales de Supabase
const SUPABASE_URL = 'https://mawixmfhfwxsnxsgpgja.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rYDmjondp3uHdqW4lIT9TA_gFXi0yxJ';

// Como ya cargaste el script en el HTML, window.supabase estará disponible
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Ejemplo de uso en el formulario de login:

const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        // Ejemplo de llamada a Supabase Auth (ajustalo a tu cliente actual):
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) throw error;

        // ¡Login exitoso! Redirigimos automáticamente al index.html
        window.location.href = 'index.html';

    } catch (error) {
        // Mostrar error visual en la interfaz
        authError.textContent = error.message || 'Ocurrió un error al ingresar.';
        authError.classList.add('show');
    }
});