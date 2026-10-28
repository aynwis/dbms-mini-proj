/* Client helpers. All data lives in MySQL; this file only talks to the server's /api routes. */
const $ = s => document.querySelector(s),
  esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showSql() { /* SQL debug panel intentionally hidden in production */ }

/* ---- fetch wrapper: throws on errors ---- */
async function api(path, { method = 'GET', body, quiet = false } = {}) {
  const r = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({ ok: false, error: 'The server did not answer correctly.', sql: [] }));
  if (!r.ok || j.ok === false) {
    if (r.status === 401 && !quiet) { location.href = 'index.html'; return new Promise(() => {}); }
    throw new Error(j.error || 'Request failed.');
  }
  return j.data;
}

const Auth = {
  async need(role) { // resolves with the logged-in user, or redirects away
    const s = await api('/me');
    if (s.role !== role) { location.href = s.role + '.html'; return new Promise(() => {}); }
    return s.user;
  },
  login: (role, email, password) => api('/login', { method: 'POST', body: { role, email, password }, quiet: true }),
  register: (role, d) => api('/register', { method: 'POST', body: { role, ...d }, quiet: true }),
  async out() { try { await api('/logout', { method: 'POST', quiet: true }); } catch {} location.href = 'index.html'; }
};

function toast(m, isErr = false) {
  const t = $('#toast'); t.textContent = m; t.className = isErr ? 'err' : ''; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', 3600);
}
const fail = e => toast(e?.message || String(e), true);
const fd = e => { e.preventDefault(); return Object.fromEntries(new FormData(e.target)); };

/* test_paper_link is an http(s) link */
const download = link => window.open(link, '_blank', 'noopener');