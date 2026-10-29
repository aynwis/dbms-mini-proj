# EduPrep Online – e-Learning Course Management System

MySQL 8 + Express 5 + plain HTML/CSS/JS. **The database is the backend**: tables, constraints, triggers,
views, a function and stored procedures live in `miniproj.sql`. The Node server only runs SQL and passes the
database's own error messages to the browser. Nothing is stored in the browser.

## Setup
1. Open `miniproj.sql` in **MySQL Workbench** and run the whole file (it rebuilds `elearning_db`; re-run it any time to reset the data). Needs MySQL 8.0.16+.
2. `npm install`
3. Copy `.env.example` to `.env` and put your MySQL password in `DB_PASSWORD`.
4. `npm start`
5. Open http://localhost:3000

At the bottom of every page a dark **"SQL executed"** bar shows the SQL of the last request (click to open, red when it failed).

## Logins
| Role | Email | Password |
|---|---|---|
| Student | aarav.sharma@example.com, diya.patel@example.com, rohan.verma@example.com, ananya.iyer@example.com, kabir.khan@example.com | `Pass@123` |
| Faculty | rajesh.kumar@example.com, meera.nair@example.com, vikram.singh@example.com | `Pass@123` |
| Admin | admin@eduprep.com | `Admin@123` (from `.env`) |

Students can register themselves. Faculty accounts are created by the admin.

## Files
- `miniproj.sql` – whole database (tables, seed data, triggers, views, function, procedures, roles)
- `demo_queries.sql` – queries, rule violations and transactions to run in Workbench
- `server.js` – Express API (`{ ok, data, sql, error }` for every response), sessions, password hashing
- `public/` – `index.html` (login), `student.html`, `faculty.html`, `admin.html`, `app.js`, `style.css`
- `DEMO.md` – demo run-sheet and viva questions with answers
- `.env.example` – settings template
