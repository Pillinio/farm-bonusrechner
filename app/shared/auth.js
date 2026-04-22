import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

/**
 * Initialise the Supabase client.
 *
 * Expects the Supabase JS library to be loaded globally via CDN
 * (<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2">).
 *
 * @returns {object} Supabase client instance
 */
export function initSupabase() {
  if (!window.supabase) {
    throw new Error(
      'Supabase JS not loaded. Add <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> before this module.'
    );
  }
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/**
 * Require an authenticated session.
 *
 * If no active session exists the user is alerted and (once a login
 * page is available) redirected.
 *
 * @param {object} supabase - Supabase client from initSupabase()
 * @returns {Promise<object>} The authenticated user object
 */
export async function requireAuth(supabase) {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    const here = location.pathname + location.search + location.hash;
    location.href = 'login.html?redirect=' + encodeURIComponent(here);
    return null;
  }

  return session.user;
}
