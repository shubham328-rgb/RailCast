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
  url:     'https://xaigaqusupaicrtyzyki.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhaWdhcXVzdXBhaWNydHl6eWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNzQwMzksImV4cCI6MjEwMzY1MDAzOX0.QcXW4-DPGksKEctmvptZ_pYtZE6OSa0QG4GRF6UhE2U'
};
