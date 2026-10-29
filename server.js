'use strict';
/* EduPrep Online - Express + MySQL.
   The database is the backend: constraints, triggers, views, a function and stored procedures
   (all in miniproj.sql) hold the business rules. Routes only run SQL and pass the database's own
   error messages through. Every /api response is JSON: { ok, data, sql, error }
   where sql = the statements that were executed for that request. */
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
// Run one statement and return its rows.
async function q(sql, params) {
  logSql(sql, params);
  const [rows] = await pool.query(sql, params);
  return rows;
}
// Call a stored procedure and return the rows of its SELECT.
// mysql2 returns [ [ {row...} ], ResultSetHeader ] for a CALL, so the rows are result[0].
// Do NOT wrap this in a JavaScript transaction: the procedure has its own START TRANSACTION ... COMMIT/ROLLBACK.
async function call(name, args) {
  const sql = `CALL ${name}(${args.map(() => '?').join(', ')})`;
  logSql(sql, args);
  const [result] = await pool.query(sql, args);
  return result[0];
}

/* ---------- small helpers: Node only checks the FORMAT of input, never business rules ---------- */
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

// Creates a student (self-registration) or an instructor (admin only).
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

/* ===== 2. student: reads come from views ===== */
const st = express.Router();
st.use(need('student'));

// Courses (from the v_course_catalog view) the student is enrolled in, or that match an extra WHERE.
const courseCards = (sid, where = '', p = []) => q(
  `SELECT c.*, EXISTS(SELECT 1 FROM enrollment e WHERE e.course_id = c.course_id AND e.student_id = ?) AS enrolled
     FROM v_course_catalog c ${where} ORDER BY c.course_id`, [sid, ...p]);

st.get('/overview', async (req, res) => {
  const id = req.user.id;
  const [dash] = await q('SELECT * FROM v_student_dashboard WHERE student_id = ?', [id]);
  const courses = await courseCards(id,
    'WHERE EXISTS(SELECT 1 FROM enrollment e2 WHERE e2.course_id = c.course_id AND e2.student_id = ?)', [id]);
  res.json({ dash, courses });
});

// Browse: Approved courses (the view) in the student's registered exam only.
st.get('/courses', async (req, res) => {
  const [d] = await q('SELECT registered_exam_id, exam_name FROM v_student_dashboard WHERE student_id = ?', [req.user.id]);
  if (!d || !d.registered_exam_id) return res.json({ exam: null, courses: [] });
  res.json({ exam: d.exam_name, courses: await courseCards(req.user.id, 'WHERE c.category_id = ?', [d.registered_exam_id]) });
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
  'SELECT * FROM v_student_results WHERE student_id = ? ORDER BY attempt_date DESC, attempt_id DESC', [req.user.id])));

st.put('/profile', async (req, res) => {
  const b = req.body || {};
  await q('UPDATE student SET name = ?, phone = ?, city = ?, registered_exam_id = ? WHERE student_id = ?',
    [str(b.name, 100, 'Name'), str(b.phone, 15, 'Phone', { req: false }), str(b.city, 50, 'City', { req: false }),
     int(b.registered_exam_id, 'Exam', { min: 1, req: false }), req.user.id]);
  res.json({ ok: true });
});
api.use('/student', st);

/* ===== 3. enroll, cancel and attempt: each is ONE stored procedure (= one transaction in the database) ===== */
// "simulate_fail" sends the invalid payment mode 'FAILED'. The payment CHECK constraint then fails
// AFTER the enrollment row was inserted, and the procedure rolls both back.
api.post('/enroll', need('student'), async (req, res) => {
  const b = req.body || {}, cid = int(b.course_id, 'Course', { min: 1 });
  const simulateFail = b.simulate_fail === true || b.simulate_fail === 'on' || b.simulate_fail === 'true';
  const mode = simulateFail ? 'FAILED' : String(b.mode || '').trim();
  try {
    const rows = await call('sp_enroll_student', [req.user.id, cid, mode]);
    res.status(201).json({ course_id: cid, ...rows[0] });
  } catch (e) {
    if (e.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
      if (simulateFail) throw new HttpError(402, 'Payment failed (simulated). Nothing was saved.');
      throw bad('Choose a valid payment mode (UPI, Card or NetBanking).');
    }
    throw e;
  }
});

api.delete('/enroll/:courseId', need('student'), async (req, res) => {
  const rows = await call('sp_cancel_enrollment', [req.user.id, int(req.params.courseId, 'Course', { min: 1 })]);
  res.json(rows[0]);
});

// Trigger trg_attempt_bi rejects score > total marks and students who are not enrolled.
api.post('/attempt', need('student'), async (req, res) => {
  const b = req.body || {};
  const rows = await call('sp_submit_attempt',
    [req.user.id, int(b.test_id, 'Test', { min: 1 }), int(b.score, 'Score', { min: 0 })]);
  res.status(201).json(rows[0]);
});

/* ===== 4. faculty: ownership is checked here, every other rule is enforced by the database ===== */
const fa = express.Router();
fa.use(need('faculty'));

async function ownCourse(courseId, instructorId) {
  const [c] = await q('SELECT course_id FROM course WHERE course_id = ? AND instructor_id = ?', [courseId, instructorId]);
  if (!c) throw new HttpError(403, 'You can only add content to your own courses.');
}

fa.get('/overview', async (req, res) => {
  const [stats] = await q('SELECT * FROM v_instructor_summary WHERE instructor_id = ?', [req.user.id]);
  res.json({ stats });
});

fa.get('/courses', async (req, res) => res.json(await q(
  'SELECT * FROM v_course_stats WHERE instructor_id = ? ORDER BY course_id', [req.user.id])));

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
  const rows = await call('sp_delete_course', [int(req.params.id, 'Course', { min: 1 }), req.user.id]);
  res.json(rows[0]);
});

// The dropdown lists ALL of the instructor's courses, Pending ones too, so the trigger can be demonstrated.
fa.get('/lectures', async (req, res) => {
  const i = req.user.id;
  res.json({
    courses: await q('SELECT course_id, course_name, status FROM course WHERE instructor_id = ? ORDER BY course_id', [i]),
    lectures: await q(
      `SELECT l.lecture_id, l.seq_no, l.title, l.duration_min, c.course_name
         FROM lecture l JOIN course c ON c.course_id = l.course_id
        WHERE c.instructor_id = ? ORDER BY l.course_id, l.seq_no`, [i])
  });
});

// Plain INSERT: trigger trg_lecture_bi refuses a course that is not Approved.
fa.post('/lectures', async (req, res) => {
  const b = req.body || {}, cid = int(b.course_id, 'Course', { min: 1 });
  await ownCourse(cid, req.user.id);
  try {
    await q('INSERT INTO lecture (course_id, title, video_link, duration_min, seq_no) VALUES (?,?,?,?,?)',
      [cid, str(b.title, 150, 'Title'), cleanLink(b.video_link),
       int(b.duration_min, 'Duration', { min: 1, req: false }), int(b.seq_no, 'Sequence no.', { min: 1 })]);
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
    courses: await q('SELECT course_id, course_name, status FROM course WHERE instructor_id = ? ORDER BY course_id', [i]),
    tests: await q(
      `SELECT t.test_id, t.title, t.total_marks, t.duration_min, t.test_paper_link, c.course_name
         FROM test t JOIN course c ON c.course_id = t.course_id
        WHERE c.instructor_id = ? ORDER BY t.test_id`, [i])
  });
});

// Papers are link-only. Plain INSERT: trigger trg_test_bi refuses a course that is not Approved.
fa.post('/tests', async (req, res) => {
  const b = req.body || {}, cid = int(b.course_id, 'Course', { min: 1 });
  await ownCourse(cid, req.user.id);
  await q('INSERT INTO test (course_id, title, total_marks, duration_min, test_paper_link) VALUES (?,?,?,?,?)',
    [cid, str(b.title, 150, 'Title'), int(b.total_marks, 'Total marks', { min: 1 }),
     int(b.duration_min, 'Duration', { min: 1, req: false }), cleanLink(b.link)]);
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

/* ===== 5. admin ===== */
const ad = express.Router();
ad.use(need('admin'));

ad.get('/pending', async (req, res) => res.json(await q('SELECT * FROM v_pending_courses ORDER BY course_id')));
ad.post('/courses/:id/approve', async (req, res) => {
  const rows = await call('sp_approve_course', [int(req.params.id, 'Course', { min: 1 })]);
  res.json(rows[0]);
});
ad.get('/courses', async (req, res) => res.json(await q('SELECT * FROM v_course_stats ORDER BY course_id')));

ad.get('/instructors', async (req, res) => res.json(await q('SELECT * FROM v_instructor_summary ORDER BY instructor_id')));
ad.post('/instructors', async (req, res) => {
  await newUser('faculty', req.body || {});
  res.status(201).json({ ok: true });
});

ad.get('/payments', async (req, res) => res.json(await q('SELECT * FROM v_payment_report ORDER BY payment_id')));
// trg_payment_bu fills payment_date; trg_audit_payment_au writes the audit row.
ad.post('/payments/:id/paid', async (req, res) => {
  const r = await q("UPDATE payment SET status='Success' WHERE payment_id=? AND status='Pending'", [+req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, 'Payment not found or not pending.');
  res.json({ ok: true });
});

ad.get('/students', async (req, res) => res.json(await q('SELECT * FROM v_student_public ORDER BY student_id')));
ad.get('/audit', async (req, res) => res.json(await q('SELECT * FROM audit_log ORDER BY log_id DESC LIMIT 100')));

// Reports: a fixed server-side whitelist (Q1-Q13 of demo_queries.sql). The browser only sends a key, never SQL.
const REPORTS = {
  q1: { title: "Q1 JOIN (relational algebra: pi(course_name, name)(Course |X| Instructor))", sql: `SELECT c.course_name, i.name AS instructor, k.category_name
FROM course c
JOIN instructor i    ON i.instructor_id = c.instructor_id
JOIN exam_category k ON k.category_id   = c.category_id;` },
  q2: { title: "Q2 GROUP BY + HAVING: exams with at least 2 enrolments", sql: `SELECT k.category_name, COUNT(e.enrollment_id) AS enrolments
FROM exam_category k
LEFT JOIN course c     ON c.category_id = k.category_id
LEFT JOIN enrollment e ON e.course_id   = c.course_id
GROUP BY k.category_id, k.category_name
HAVING COUNT(e.enrollment_id) >= 2;` },
  q3: { title: "Q3 Aggregates per test: attempts, average, highest, lowest", sql: `SELECT t.title, COUNT(*) AS attempts, ROUND(AVG(a.score),1) AS avg_score,
       MAX(a.score) AS highest, MIN(a.score) AS lowest
FROM attempt a JOIN test t ON t.test_id = a.test_id
GROUP BY t.test_id, t.title;` },
  q4: { title: "Q4 Scalar subquery: students who scored above the overall average", sql: `SELECT s.name, a.score
FROM attempt a JOIN student s ON s.student_id = a.student_id
WHERE a.score > (SELECT AVG(score) FROM attempt);` },
  q5: { title: "Q5 IN subquery: courses taught by instructors with more than 9 years' experience", sql: `SELECT course_name FROM course
WHERE instructor_id IN (SELECT instructor_id FROM instructor WHERE experience_years > 9);` },
  q6: { title: "Q6 EXISTS: courses whose tests have been attempted at least once", sql: `SELECT c.course_name FROM course c
WHERE EXISTS (SELECT 1 FROM test t JOIN attempt a ON a.test_id = t.test_id WHERE t.course_id = c.course_id);` },
  q7: { title: "Q7 NOT EXISTS (division-style): students who never completed a successful payment", sql: `SELECT s.name FROM student s
WHERE NOT EXISTS (SELECT 1 FROM enrollment e JOIN payment p ON p.enrollment_id = e.enrollment_id
                  WHERE e.student_id = s.student_id AND p.status = 'Success');` },
  q8: { title: "Q8 Correlated subquery: topper of every test", sql: `SELECT t.title, s.name, a.score
FROM attempt a
JOIN test t    ON t.test_id    = a.test_id
JOIN student s ON s.student_id = a.student_id
WHERE a.score = (SELECT MAX(score) FROM attempt WHERE test_id = a.test_id);` },
  q9: { title: "Q9 Set operation UNION: every registered person with their role", sql: `SELECT name, email, 'Student'    AS role FROM student
UNION
SELECT name, email, 'Instructor' AS role FROM instructor;` },
  q10: { title: "Q10 NULL handling: pending payments have no date yet", sql: `SELECT payment_id, status, COALESCE(payment_date, 'not paid yet') AS paid_on FROM payment;` },
  q11: { title: "Q11 Window function: recompute the ranks and compare with the stored rank_no", sql: `SELECT test_id, student_id, score, rank_no,
       RANK() OVER (PARTITION BY test_id ORDER BY score DESC) AS recomputed_rank
FROM attempt ORDER BY test_id, rank_no;` },
  q12: { title: "Q12 Derived table: courses earning more than the average course", sql: `SELECT course_name, revenue
FROM v_course_stats
WHERE revenue > (SELECT AVG(r) FROM (SELECT revenue AS r FROM v_course_stats) x);` },
  q13: { title: "Q13 Stored function used inside a query", sql: `SELECT student_name, test_title, score, fn_grade(score, total_marks) AS grade FROM v_student_results;` },
};
ad.get('/reports', (req, res) => res.json(Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title }))));
ad.get('/reports/:key', async (req, res) => {
  const r = Object.hasOwn(REPORTS, req.params.key) ? REPORTS[req.params.key] : null;
  if (!r) throw new HttpError(404, 'Unknown report.');
  res.json({ title: r.title, sql: r.sql, rows: await q(r.sql) });
});
api.use('/admin', ad);

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* ---------- errors: trigger / procedure messages (SQLSTATE 45000) are passed through as they are ---------- */
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
    `EduPrep running at http://localhost:${CONFIG.port}  (database: ${process.env.DB_NAME || 'elearning_db'})\n` +
    `Sample students/instructors use password Pass@123. Admin login: ${CONFIG.adminEmail}`));
})();
