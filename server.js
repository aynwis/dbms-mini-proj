'use strict';
/* EduPrep Online - Express + MySQL.
   Routes only run SQL. The rules live in the database (miniproj.sql): constraints, 2 triggers, 2 views.
   Every /api response is JSON: { ok, data, sql, error } where sql = the statements that were executed. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { AsyncLocalStorage } = require('async_hooks');

// Tiny .env loader (no extra dependency). Real environment variables win.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file - use defaults */ }

const express = require('express');
const mysql = require('mysql2/promise');
const { format } = require('mysql2');
const pbkdf2 = promisify(crypto.pbkdf2);

/* ---------- config (admin is a fixed login, not a database row) ---------- */
const CONFIG = {
  port: process.env.PORT || 3000,
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@eduprep.com').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin@123'
};
const PAY_MODES = ['UPI', 'Card', 'NetBanking'];

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: +process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'elearning_db',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,     // DATE comes back as a plain string
  decimalNumbers: true   // DECIMAL (fee, amount) comes back as a number
});

/* ---------- SQL log: every statement a request runs is recorded and sent back in response.sql ---------- */
const als = new AsyncLocalStorage();
function logSql(sql, params) {
  const store = als.getStore();
  if (!store) return;
  const text = format(sql, params || []).replace(/\s+/g, ' ').trim();
  store.sql.push(text.replace(/'pbkdf2:[^']*'/g, "'<password hash>'") + ';');
}
async function q(sql, params) {
  logSql(sql, params);
  const [rows] = await pool.query(sql, params);
  return rows;
}
// One transaction: COMMIT if fn finishes, ROLLBACK if it throws.
async function tx(fn) {
  const cn = await pool.getConnection();
  const run = async (sql, params) => { logSql(sql, params); const [r] = await cn.query(sql, params); return r; };
  try {
    logSql('START TRANSACTION'); await cn.beginTransaction();
    const out = await fn(run);
    logSql('COMMIT'); await cn.commit();
    return out;
  } catch (e) {
    logSql('ROLLBACK'); await cn.rollback().catch(() => {});
    throw e;
  } finally { cn.release(); }
}

/* ---------- small helpers ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = m => new HttpError(400, m);
const str = (v, max, name, { req = true } = {}) => {
  v = String(v ?? '').trim();
  if (req && !v) throw bad(`${name} is required.`);
  if (v.length > max) throw bad(`${name} must be at most ${max} characters.`);
  return v || null;
};
const int = (v, name, { min = 0, req = true } = {}) => {
  if (v === '' || v == null) { if (req) throw bad(`${name} is required.`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw bad(`${name} must be a whole number of at least ${min}.`);
  return n;
};
const cleanLink = v => {
  v = String(v ?? '').trim();
  if (v.length > 255) throw bad('Link is too long (max 255 characters).');
  if (!/^https?:\/\/\S+$/i.test(v)) throw bad('Enter a valid http(s) link.');
  return v;
};
const dup = (e, msg) => { if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, msg); throw e; };
const sameText = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

/* ---------- passwords: pbkdf2-sha256 in the same format as the hashes in miniproj.sql ---------- */
async function hashPw(pw) {
  const salt = crypto.randomBytes(8).toString('hex'), iter = 260000;
  return `pbkdf2:sha256:${iter}$${salt}$${(await pbkdf2(pw, salt, iter, 32, 'sha256')).toString('hex')}`;
}
async function checkPw(pw, stored) {
  const [head, salt, hash] = String(stored || '').split('$');
  const [kind, algo, iter] = String(head).split(':');
  if (kind !== 'pbkdf2' || algo !== 'sha256' || !salt || !hash) return false;
  const got = await pbkdf2(pw, salt, parseInt(iter, 10), 32, 'sha256'), want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* ---------- sessions (in memory; the cookie holds only a random token) ---------- */
const sessions = new Map(), SESSION_MS = 7 * 864e5;
const cookie = (req, n) => {
  const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith(n + '='));
  return c ? decodeURIComponent(c.slice(n.length + 1)) : null;
};
function startSession(res, role, id) {
  const t = crypto.randomBytes(24).toString('hex');
  sessions.set(t, { role, id, exp: Date.now() + SESSION_MS });
  res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`);
}
function getSession(req) {
  const t = cookie(req, 'sid'), s = t && sessions.get(t);
  if (s && s.exp < Date.now()) { sessions.delete(t); return null; }
  return s || null;
}
const need = role => (req, res, next) => {
  const s = getSession(req);
  if (!s || (role && s.role !== role)) return res.status(401).json({ error: 'Please log in.' });
  req.user = s; next();
};

/* ---------- app ---------- */
const app = express();

// Wrap every /api answer as { ok, data, sql, error } and start a fresh SQL log for the request.
app.use('/api', (req, res, next) => {
  const store = { sql: [] }, send = res.json.bind(res);
  res.json = body => send(res.statusCode >= 400
    ? { ok: false, data: null, sql: store.sql, error: body?.error || 'Request failed.' }
    : { ok: true, data: body, sql: store.sql, error: null });
  als.run(store, next);
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // only public/ is served, never .env or server.js

const api = express.Router();

/* ===== 1. login / register / logout ===== */
api.get('/categories', async (req, res) =>
  res.json(await q('SELECT category_id, category_name FROM exam_category ORDER BY category_id')));

async function newUser(role, b) {
  const name = str(b.name, 100, 'Name'), email = str(String(b.email || '').toLowerCase(), 100, 'Email');
  if (String(b.password || '').length < 6) throw bad('Password must be at least 6 characters.');
  const ph = await hashPw(String(b.password));
  try {
    const r = role === 'student'
      ? await q('INSERT INTO student (name, email, password_hash, phone, city, registered_exam_id) VALUES (?,?,?,?,?,?)',
          [name, email, ph, str(b.phone, 15, 'Phone', { req: false }), str(b.city, 50, 'City', { req: false }),
           int(b.exam, 'Exam', { min: 1, req: false })])
      : await q('INSERT INTO instructor (name, email, password_hash, qualification, experience_years) VALUES (?,?,?,?,?)',
          [name, email, ph, str(b.qual, 100, 'Qualification', { req: false }), int(b.exp || 0, 'Experience', { min: 0 })]);
    return r.insertId;
  } catch (e) { dup(e, 'This email is already registered.'); }
}

api.post('/register', async (req, res) => {
  const b = req.body || {}, role = b.role;
  if (role === 'faculty') throw new HttpError(403, 'Faculty accounts are created by the admin.');
  if (role !== 'student') throw bad('Invalid role.');
  startSession(res, role, await newUser(role, b));
  res.status(201).json({ role });
});

const ROLE_TABLE = { student: ['student', 'student_id'], faculty: ['instructor', 'instructor_id'] };
api.post('/login', async (req, res) => {
  const { role, email, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase(), pw = String(password || '');
  if (role === 'admin') {
    if (!sameText(mail, CONFIG.adminEmail) || !sameText(pw, CONFIG.adminPassword))
      throw new HttpError(401, 'Incorrect email or password.');
    startSession(res, 'admin', 0);
    return res.json({ role });
  }
  const t = ROLE_TABLE[role];
  if (!t) throw bad('Invalid role.');
  const [u] = await q(`SELECT ${t[1]} AS id, password_hash FROM ${t[0]} WHERE email = ?`, [mail]);
  if (!u || !(await checkPw(pw, u.password_hash))) throw new HttpError(401, 'Incorrect email or password.');
  startSession(res, role, u.id);
  res.json({ role });
});

api.post('/logout', (req, res) => {
  sessions.delete(cookie(req, 'sid'));
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

api.get('/me', need(), async (req, res) => {
  const { role, id } = req.user;
  if (role === 'admin') return res.json({ role, user: { name: 'Admin', email: CONFIG.adminEmail } });
  const [user] = role === 'student'
    ? await q('SELECT student_id, name, email, phone, city, registered_exam_id, registration_date FROM student WHERE student_id = ?', [id])
    : await q('SELECT instructor_id, name, email, qualification, experience_years FROM instructor WHERE instructor_id = ?', [id]);
  if (!user) { sessions.delete(cookie(req, 'sid')); return res.status(401).json({ error: 'Please log in.' }); }
  res.json({ role, user });
});

/* ===== 2. courses and lectures (student side: read-only, through the v_course_catalog view) ===== */
const st = express.Router();
st.use(need('student'));

const courseCards = (sid, where = '', p = []) => q(
  `SELECT c.*, EXISTS(SELECT 1 FROM enrollment e WHERE e.course_id = c.course_id AND e.student_id = ?) AS enrolled
     FROM v_course_catalog c ${where} ORDER BY c.course_id`, [sid, ...p]);

st.get('/overview', async (req, res) => {
  const id = req.user.id;
  const [me] = await q(
    `SELECT s.student_id, s.name, s.email, s.phone, s.city, s.registered_exam_id, s.registration_date,
            k.category_name AS exam_name
       FROM student s LEFT JOIN exam_category k ON k.category_id = s.registered_exam_id
      WHERE s.student_id = ?`, [id]);
  const [a] = await q('SELECT COUNT(*) AS attempts, MIN(rank_no) AS best_rank FROM attempt WHERE student_id = ?', [id]);
  const courses = await courseCards(id,
    'WHERE EXISTS(SELECT 1 FROM enrollment e2 WHERE e2.course_id = c.course_id AND e2.student_id = ?)', [id]);
  res.json({ me, courses, attempts: a.attempts, best_rank: a.best_rank });
});

// Browse: Approved courses (the view) in the student's registered exam only.
st.get('/courses', async (req, res) => {
  const [s] = await q(
    `SELECT s.registered_exam_id, k.category_name FROM student s
       LEFT JOIN exam_category k ON k.category_id = s.registered_exam_id WHERE s.student_id = ?`, [req.user.id]);
  if (!s || !s.registered_exam_id) return res.json({ exam: null, courses: [] });
  res.json({ exam: s.category_name, courses: await courseCards(req.user.id, 'WHERE c.category_id = ?', [s.registered_exam_id]) });
});

st.get('/courses/:id', async (req, res) => {
  const cid = +req.params.id, sid = req.user.id;
  const [en] = await q('SELECT 1 AS x FROM enrollment WHERE student_id = ? AND course_id = ?', [sid, cid]);
  if (!en) throw new HttpError(403, 'Enroll in this course to open it.');
  const [course] = await q(
    `SELECT c.course_id, c.course_name, c.description, c.fee, i.name AS instructor_name
       FROM course c JOIN instructor i ON i.instructor_id = c.instructor_id WHERE c.course_id = ?`, [cid]);
  const lectures = await q(
    'SELECT lecture_id, seq_no, title, duration_min, video_link FROM lecture WHERE course_id = ? ORDER BY seq_no', [cid]);
  const tests = await q(
    `SELECT t.test_id, t.title, t.total_marks, t.duration_min, t.test_paper_link, a.score, a.rank_no
       FROM test t LEFT JOIN attempt a ON a.test_id = t.test_id AND a.student_id = ?
      WHERE t.course_id = ? ORDER BY t.test_id`, [sid, cid]);
  res.json({ course, lectures, tests });
});

st.get('/results', async (req, res) => res.json(await q(
  `SELECT a.attempt_id, a.attempt_date, a.score, a.rank_no, t.title AS test_title, t.total_marks, c.course_name
     FROM attempt a JOIN test t ON t.test_id = a.test_id JOIN course c ON c.course_id = t.course_id
    WHERE a.student_id = ? ORDER BY a.attempt_date DESC, a.attempt_id DESC`, [req.user.id])));

st.put('/profile', async (req, res) => {
  const b = req.body || {};
  await q('UPDATE student SET name = ?, phone = ?, city = ?, registered_exam_id = ? WHERE student_id = ?',
    [str(b.name, 100, 'Name'), str(b.phone, 15, 'Phone', { req: false }), str(b.city, 50, 'City', { req: false }),
     int(b.registered_exam_id, 'Exam', { min: 1, req: false }), req.user.id]);
  res.json({ ok: true });
});
api.use('/student', st);

/* ===== 3. enroll and attempt ===== */
// Enrollment + payment in ONE transaction. trg_enrollment_bi rejects unapproved / wrong-exam courses.
// "simulate_fail" makes the payment fail after both inserts, so everything is rolled back.
api.post('/enroll', need('student'), async (req, res) => {
  const b = req.body || {}, cid = int(b.course_id, 'Course', { min: 1 }), mode = String(b.mode || '');
  const simulateFail = b.simulate_fail === true || b.simulate_fail === 'on' || b.simulate_fail === 'true';
  const [c] = await q('SELECT course_id, fee FROM course WHERE course_id = ?', [cid]);
  if (!c) throw new HttpError(404, 'Course not found.');
  if (c.fee > 0 && !PAY_MODES.includes(mode)) throw bad('Choose a payment mode.');
  try {
    await tx(async run => {
      const r = await run('INSERT INTO enrollment (student_id, course_id) VALUES (?, ?)', [req.user.id, cid]);
      if (c.fee > 0)
        await run(`INSERT INTO payment (enrollment_id, amount, mode, payment_date, status, transaction_ref)
                   VALUES (?, ?, ?, CURDATE(), 'Success', ?)`,
          [r.insertId, c.fee, mode, 'TXN' + Date.now() + crypto.randomInt(1000, 10000)]);
      if (simulateFail) throw new HttpError(402, 'Payment failed (simulated). Nothing was saved.');
    });
  } catch (e) { dup(e, 'You are already enrolled in this course.'); }
  res.status(201).json({ course_id: cid });
});

// Attempt + re-rank in ONE transaction. trg_attempt_bi rejects score > total_marks and non-enrolled students.
// RANK() gives tied scores the same rank. (Ranks are not done inside a trigger: MySQL error 1442.)
api.post('/attempt', need('student'), async (req, res) => {
  const b = req.body || {}, tid = int(b.test_id, 'Test', { min: 1 }), score = int(b.score, 'Score', { min: 0 });
  try {
    await tx(async run => {
      await run('INSERT INTO attempt (student_id, test_id, score) VALUES (?, ?, ?)', [req.user.id, tid, score]);
      await run(
        `UPDATE attempt a
           JOIN (SELECT attempt_id, RANK() OVER (ORDER BY score DESC) AS rk FROM attempt WHERE test_id = ?) r
             ON r.attempt_id = a.attempt_id
            SET a.rank_no = r.rk
          WHERE a.test_id = ?`, [tid, tid]);
    });
  } catch (e) { dup(e, 'You have already attempted this test.'); }
  res.status(201).json({ ok: true });
});

/* ===== faculty: only their own courses; lectures and tests only on Approved ones ===== */
const fa = express.Router();
fa.use(need('faculty'));

fa.get('/overview', async (req, res) => {
  const i = req.user.id;
  const [me] = await q('SELECT instructor_id, name, email, qualification, experience_years FROM instructor WHERE instructor_id = ?', [i]);
  const [stats] = await q(
    `SELECT (SELECT COUNT(*) FROM course WHERE instructor_id = ?) AS courses,
            (SELECT COUNT(*) FROM course WHERE instructor_id = ? AND status = 'Pending') AS pending,
            (SELECT COUNT(*) FROM lecture l JOIN course c ON c.course_id = l.course_id WHERE c.instructor_id = ?) AS lectures,
            (SELECT COUNT(*) FROM test t JOIN course c ON c.course_id = t.course_id WHERE c.instructor_id = ?) AS papers,
            (SELECT COUNT(*) FROM enrollment e JOIN course c ON c.course_id = e.course_id WHERE c.instructor_id = ?) AS enrollments`,
    [i, i, i, i, i]);
  res.json({ me, stats });
});

fa.get('/courses', async (req, res) => res.json(await q(
  `SELECT c.course_id, c.course_name, c.description, c.fee, c.status, k.category_name,
          (SELECT COUNT(*) FROM enrollment e WHERE e.course_id = c.course_id) AS enrolled
     FROM course c JOIN exam_category k ON k.category_id = c.category_id
    WHERE c.instructor_id = ? ORDER BY c.course_id`, [req.user.id])));

// New courses get status 'Pending' from the column default; the admin approves them.
fa.post('/courses', async (req, res) => {
  const b = req.body || {}, fee = Number(b.fee);
  if (!(fee >= 0) || fee > 99999999) throw bad('Fee must be 0 or more.');
  try {
    await q('INSERT INTO course (course_name, description, fee, category_id, instructor_id) VALUES (?,?,?,?,?)',
      [str(b.course_name, 150, 'Course name'), str(b.description, 60000, 'Description', { req: false }),
       Math.round(fee * 100) / 100, int(b.category_id, 'Exam category', { min: 1 }), req.user.id]);
  } catch (e) { dup(e, 'A course with this name already exists.'); }
  res.status(201).json({ ok: true });
});

fa.delete('/courses/:id', async (req, res) => {
  const id = +req.params.id;
  const [c] = await q('SELECT course_id FROM course WHERE course_id = ? AND instructor_id = ?', [id, req.user.id]);
  if (!c) throw new HttpError(404, 'Course not found.');
  const [{ n }] = await q('SELECT COUNT(*) AS n FROM enrollment WHERE course_id = ?', [id]);
  if (n) throw new HttpError(409, 'Cannot delete: students are enrolled.');
  // lecture.course_id and test.course_id are RESTRICT, so the children go first (attempts cascade with their test)
  await tx(async run => {
    await run('DELETE FROM lecture WHERE course_id = ?', [id]);
    await run('DELETE FROM test WHERE course_id = ?', [id]);
    await run('DELETE FROM course WHERE course_id = ?', [id]);
  });
  res.json({ ok: true });
});

fa.get('/lectures', async (req, res) => {
  const i = req.user.id;
  res.json({
    courses: await q("SELECT course_id, course_name FROM course WHERE instructor_id = ? AND status = 'Approved' ORDER BY course_id", [i]),
    lectures: await q(
      `SELECT l.lecture_id, l.seq_no, l.title, l.duration_min, c.course_name
         FROM lecture l JOIN course c ON c.course_id = l.course_id
        WHERE c.instructor_id = ? ORDER BY l.course_id, l.seq_no`, [i])
  });
});

// One statement checks "my course AND Approved": no row inserted means one of the two failed.
fa.post('/lectures', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await q(
      `INSERT INTO lecture (course_id, title, video_link, duration_min, seq_no)
       SELECT course_id, ?, ?, ?, ? FROM course WHERE course_id = ? AND instructor_id = ? AND status = 'Approved'`,
      [str(b.title, 150, 'Title'), cleanLink(b.video_link), int(b.duration_min, 'Duration', { min: 1, req: false }),
       int(b.seq_no, 'Sequence no.', { min: 1 }), int(b.course_id, 'Course', { min: 1 }), req.user.id]);
    if (!r.affectedRows) throw new HttpError(403, 'Lectures can only be added to your own approved courses.');
  } catch (e) { dup(e, 'Sequence no. already used in this course.'); }
  res.status(201).json({ ok: true });
});

fa.delete('/lectures/:id', async (req, res) => {
  await q(`DELETE l FROM lecture l JOIN course c ON c.course_id = l.course_id
            WHERE l.lecture_id = ? AND c.instructor_id = ?`, [+req.params.id, req.user.id]);
  res.json({ ok: true });
});

fa.get('/papers', async (req, res) => {
  const i = req.user.id;
  res.json({
    courses: await q("SELECT course_id, course_name FROM course WHERE instructor_id = ? AND status = 'Approved' ORDER BY course_name", [i]),
    tests: await q(
      `SELECT t.test_id, t.title, t.total_marks, t.duration_min, t.test_paper_link, c.course_name
         FROM test t JOIN course c ON c.course_id = t.course_id
        WHERE c.instructor_id = ? ORDER BY t.test_id`, [i])
  });
});

// Papers are link-only (no file upload).
fa.post('/tests', async (req, res) => {
  const b = req.body || {};
  const r = await q(
    `INSERT INTO test (course_id, title, total_marks, duration_min, test_paper_link)
     SELECT course_id, ?, ?, ?, ? FROM course WHERE course_id = ? AND instructor_id = ? AND status = 'Approved'`,
    [str(b.title, 150, 'Title'), int(b.total_marks, 'Total marks', { min: 1 }),
     int(b.duration_min, 'Duration', { min: 1, req: false }), cleanLink(b.link),
     int(b.course_id, 'Course', { min: 1 }), req.user.id]);
  if (!r.affectedRows) throw new HttpError(403, 'Papers can only be added to your own approved courses.');
  res.status(201).json({ ok: true });
});

fa.delete('/tests/:id', async (req, res) => {
  const r = await q(`DELETE t FROM test t JOIN course c ON c.course_id = t.course_id
                      WHERE t.test_id = ? AND c.instructor_id = ?`, [+req.params.id, req.user.id]); // attempts cascade
  if (!r.affectedRows) throw new HttpError(404, 'Paper not found.');
  res.json({ ok: true });
});

// Results come straight from the v_test_leaderboard view.
fa.get('/results', async (req, res) => {
  const rows = await q(
    `SELECT t.test_id, t.title, t.total_marks, c.course_name, lb.rank_no, lb.student_name, lb.score
       FROM test t JOIN course c ON c.course_id = t.course_id
       LEFT JOIN v_test_leaderboard lb ON lb.test_id = t.test_id
      WHERE c.instructor_id = ? ORDER BY t.test_id, lb.rank_no, lb.student_name`, [req.user.id]);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.test_id))
      out.set(r.test_id, { test_id: r.test_id, title: r.title, course_name: r.course_name, total_marks: r.total_marks, attempts: [] });
    if (r.rank_no != null)
      out.get(r.test_id).attempts.push({ rank_no: r.rank_no, student_name: r.student_name, score: r.score });
  }
  res.json([...out.values()]);
});

fa.put('/profile', async (req, res) => {
  const b = req.body || {};
  await q('UPDATE instructor SET name = ?, qualification = ?, experience_years = ? WHERE instructor_id = ?',
    [str(b.name, 100, 'Name'), str(b.qualification, 100, 'Qualification', { req: false }),
     int(b.experience_years, 'Experience', { min: 0 }), req.user.id]);
  res.json({ ok: true });
});
api.use('/faculty', fa);

/* ===== 4. admin: approve courses, add instructors ===== */
const ad = express.Router();
ad.use(need('admin'));

ad.get('/pending', async (req, res) => res.json(await q(
  `SELECT c.course_id, c.course_name, c.fee, k.category_name, i.name AS instructor_name
     FROM course c
     JOIN exam_category k ON k.category_id = c.category_id
     JOIN instructor i ON i.instructor_id = c.instructor_id
    WHERE c.status = 'Pending' ORDER BY c.course_id`)));

ad.post('/courses/:id/approve', async (req, res) => {
  const r = await q("UPDATE course SET status = 'Approved' WHERE course_id = ? AND status = 'Pending'", [+req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, 'Course not found or already approved.');
  res.json({ ok: true });
});

ad.post('/instructors', async (req, res) => {
  await newUser('faculty', req.body || {});
  res.status(201).json({ ok: true });
});
api.use('/admin', ad);

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* ---------- errors: trigger messages (SQLSTATE 45000) are passed through as they are ---------- */
const SQL_ERRORS = {
  ER_DUP_ENTRY: [409, 'That value already exists.'],
  ER_NO_REFERENCED_ROW_2: [400, 'A selected item does not exist.'],
  ER_ROW_IS_REFERENCED_2: [409, 'Cannot delete: other records depend on this one.'],
  ER_DATA_TOO_LONG: [400, 'A value is too long.'],
  ER_CHECK_CONSTRAINT_VIOLATED: [400, 'A value is out of the allowed range.']
};
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.sqlState === '45000') return res.status(400).json({ error: err.sqlMessage });
  const m = SQL_ERRORS[err.code];
  if (m) return res.status(m[0]).json({ error: m[1] });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

/* ---------- start ---------- */
(async () => {
  try { await pool.query('SELECT 1'); }
  catch (e) {
    console.error(`Cannot connect to MySQL (${e.message}).\nCheck DB_HOST / DB_USER / DB_PASSWORD / DB_NAME in .env and that miniproj.sql has been run.`);
    process.exit(1);
  }
  app.listen(CONFIG.port, () => console.log(
    `EduPrep running at http://localhost:${CONFIG.port}\nSample accounts use password Pass@123. Admin: ${CONFIG.adminEmail}`));
})();