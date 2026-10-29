/* Browser helpers. Nothing is stored in the browser: every page asks the server (and so MySQL) for its data. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => Number(n) > 0 ? '₹' + Number(n).toLocaleString('en-IN') : 'Free';
const empty = t => `<div class="card empty">${t}</div>`;
const tag = s => `<span class="tag ${esc(s)}">${esc(s)}</span>`;   // Pending / Approved / Success / Failed

function toast(m) {
  const t = $('#toast'); if (!t) return;
  t.textContent = m; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', 2600);
}

/* A message at the top of the page. Shows the database's own error text exactly as returned. */
function flash(msg, bad) {
  const f = $('#flash'); if (!f) return;
  f.innerHTML = msg ? `<div class="flash ${bad ? 'bad' : 'good'}">${esc(msg)}</div>` : '';
}

/* ---------- SQL panel: a bar fixed at the bottom showing the SQL of the last request ---------- */
const Panel = {
  freeze: false,   // true after a button click, so the re-fetch that follows does not hide the click's SQL
  text: '',
  init() {
    const d = document.createElement('div');
    d.id = 'sqlbar';
    d.innerHTML = '<div class="sqlhead"><button type="button" id="sqltoggle">▲ SQL executed</button>' +
      '<button type="button" id="sqlcopy" class="btn s o">Copy</button></div><pre id="sqlpre">Nothing yet.</pre>';
    document.body.appendChild(d);
    $('#sqltoggle').onclick = () => {
      d.classList.toggle('open');
      $('#sqltoggle').textContent = (d.classList.contains('open') ? '▼' : '▲') + ' SQL executed';
    };
    $('#sqlcopy').onclick = () => { navigator.clipboard?.writeText(Panel.text); toast('SQL copied'); };
  },
  show(sqlArray, failed) {
    if (!sqlArray || !sqlArray.length) return;
    if (!$('#sqlbar')) this.init();   // in case a request finishes before the page is ready
    this.text = sqlArray.join('\n');
    $('#sqlpre').textContent = this.text;
    $('#sqlbar').classList.toggle('failed', !!failed);
    $('#sqltoggle').textContent = (failed ? '✖ ' : '') + ($('#sqlbar').classList.contains('open') ? '▼' : '▲') + ' SQL executed' + (failed ? ' (request failed)' : '');
  }
};
const renderSqlPanel = (sqlArray, failed) => Panel.show(sqlArray, failed);

/* ---------- api(): one fetch helper. Always shows the SQL, throws Error(message) when ok is false ---------- */
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  let j;
  try { j = await r.json(); } catch { j = { ok: false, sql: [], error: 'Bad response from server.' }; }
  if (!Panel.freeze) renderSqlPanel(j.sql, !j.ok);
  if (r.status === 401 && !location.pathname.endsWith('index.html') && location.pathname !== '/') location.href = 'index.html';
  if (!j.ok) throw new Error(j.error);
  return j.data;
}

/* act(): for a button click that WRITES. Its SQL stays in the panel while the page reloads its data. */
async function act(method, url, body) {
  Panel.freeze = false;
  try { return await api(method, url, body); }
  finally { Panel.freeze = true; }
}

/* ---------- tables: build an HTML table from rows (generic, used by admin pages and reports) ---------- */
function tbl(rows, extraHead, extraCell) {
  if (!rows.length) return '<div class="empty">No rows.</div>';
  const cols = Object.keys(rows[0]);
  const cell = (k, v) => v == null ? '<span class="m">NULL</span>' : (k === 'status' ? tag(v) : esc(v));
  return `<div class="wrap"><table><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}${extraHead ? `<th>${esc(extraHead)}</th>` : ''}</tr>` +
    rows.map(r => `<tr>${cols.map(c => `<td>${cell(c, r[c])}</td>`).join('')}${extraCell ? `<td>${extraCell(r)}</td>` : ''}</tr>`).join('') + '</table></div>';
}

/* ---------- Auth: login / register / logout; need() checks the session with the server ---------- */
const Auth = {
  login: (role, email, password) => api('POST', '/api/login', { role, email, password }),
  register: d => api('POST', '/api/register', { role: 'student', ...d }),
  async logout() { try { await api('POST', '/api/logout'); } finally { location.href = 'index.html'; } },
  // Returns the logged-in user's row, or sends the browser back to the login page.
  async need(role) {
    const me = await api('GET', '/api/me');
    if (me.role !== role) { location.href = 'index.html'; throw new Error('Wrong role'); }
    return me.user;
  }
};

document.addEventListener('DOMContentLoaded', () => Panel.init());
