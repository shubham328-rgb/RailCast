/* ============================================================================
 * config.js — public runtime configuration (safe to commit)
 * ----------------------------------------------------------------------------
 * Paste your Supabase project URL and ANON (public) key below. The anon key is
 * designed to be shipped to browsers — it is NOT a secret; access is controlled
 * by the row-level-security policies in db/schema.sql. NEVER put the service_role
 * key here.
 *
 * If you leave the placeholders as-is, RailCast runs entirely from the embedded
 * data files (fully offline) — the database layer simply stays dormant.
 * ========================================================================== */
window.RC = window.RC || {};
RC.dbConfig = {
  url:     'https://YOUR_PROJECT.supabase.co',   // <-- replace
  anonKey: 'YOUR_SUPABASE_ANON_KEY'              // <-- replace (the public "anon" key)
};
