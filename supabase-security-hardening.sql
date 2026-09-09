-- Ejecutar en el SQL Editor de Supabase.
-- Refuerza la función interna que crea el perfil al registrarse un usuario.

-- El cuerpo ya usa public.profiles de forma explícita, por lo que una ruta
-- vacía evita que se resuelvan objetos de esquemas no confiables.
alter function public.handle_new_user()
    set search_path = '';

-- Esta función debe ejecutarse únicamente como trigger del sistema de Auth,
-- nunca directamente desde la API pública.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

-- Conserva el permiso explícito para el servicio interno de autenticación.
grant execute on function public.handle_new_user() to supabase_auth_admin;
