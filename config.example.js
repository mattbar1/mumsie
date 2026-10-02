/* Copy this to config.js for LOCAL testing only — config.js is git-ignored
   and is never committed. On Netlify, build.sh generates the real config.js
   automatically from the SUPABASE_URL / SUPABASE_ANON_KEY environment
   variables set in the site dashboard. */
window.MUMSIE_CONFIG = {
  url: "https://YOUR-PROJECT.supabase.co",
  anonKey: "YOUR-ANON-KEY"
};
