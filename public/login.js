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

    authError.textContent = ''; // Limpiamos errores anteriores

    try {
        // 1. Primero intentamos iniciar sesión (por si el usuario ya tiene cuenta)
        let { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        // 2. Si da error porque la cuenta no existe, intentamos registrarlo automáticamente
        if (error) {
            // Puedes revisar si el mensaje indica que no existe el usuario, o probar el signUp directamente
            const signUpResult = await supabase.auth.signUp({
                email: email,
                password: password,
            });

            if (signUpResult.error) {
                // Si el signUp también falla (ej. contraseña muy corta), lanzamos ese error
                throw signUpResult.error;
            }
            
            // Si el registro fue exitoso, ya queda logueado o creado
            data = signUpResult.data;
        }

        // ¡Login o registro exitoso! Redirigimos al index
        window.location.href = 'index.html';

    } catch (error) {
        // Mostrar error visual en la interfaz de forma amigable
        authError.textContent = error.message || 'Ocurrió un error al ingresar.';
        authError.classList.add('show');
    }
});