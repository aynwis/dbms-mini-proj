# EduPrep Online – e-Learning Course Management System

Express + MySQL. All data (users, courses, lectures, enrollments, payments, tests, attempts) is stored in the
`elearning_db` MySQL database defined in `miniproj.sql`. Nothing is kept in the browser.

## Setup
1. Run `miniproj.sql` in MySQL Workbench (MySQL 8.0.13+).
2. `npm install`
3. Copy `.env.example` to `.env` and put your MySQL password in it.
4. `npm start`, then open http://localhost:3000

Sample accounts (from the SQL file) get the password `password123` on first start,
e.g. `aarav.sharma@example.com` (student) and `rajesh.kumar@example.com` (faculty).

## Layout
- `server.js` – REST API, sessions, file uploads
- `public/` – index.html, student.html, faculty.html, app.js, style.css
- `uploads/` – uploaded papers/notes (created automatically; the DB stores the link)
