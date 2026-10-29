# EduPrep demo run-sheet and viva sheet

Before you start: run `miniproj.sql` in Workbench (fresh data), `npm start`, open http://localhost:3000.
Keep a Workbench tab open with `USE elearning_db;`. Open the **SQL executed** bar at the bottom of the website.
Each step: **click -> what the SQL bar shows -> query to run in Workbench**.

## Part 1 – Demo run-sheet

1. **Faculty creates a course.** Log in as `rajesh.kumar@example.com` / `Pass@123` -> Courses -> name "JEE Chemistry Starter", JEE, fee 1999 -> Create.
   SQL bar: `INSERT INTO course (...) VALUES (...)`. Workbench: `SELECT course_id, course_name, status FROM course;` -> new row, status `Pending`.
2. **Trigger blocks a lecture on a Pending course.** Lectures -> choose "JEE Chemistry Starter (Pending)" -> any title, link `https://v.example/x`, seq 1 -> Add.
   Red message: *Lectures can only be added to an approved course.* (trigger `trg_lecture_bi`). Workbench: `SELECT * FROM lecture WHERE course_id = 5;` -> no rows.
3. **Admin approves.** Log out, tab Admin, `admin@eduprep.com` / `Admin@123` -> Approvals shows the new course and "JEE Mathematics Foundation" -> Approve the Mathematics one.
   SQL bar: `CALL sp_approve_course(4)`. Workbench: `SELECT status FROM course WHERE course_id=4;` and `SELECT * FROM audit_log ORDER BY log_id DESC LIMIT 3;` -> `status Pending -> Approved`.
4. **Student enrolls (transaction).** Log in as `rohan.verma@example.com` -> Browse -> JEE Mathematics Foundation -> Enroll, UPI.
   SQL bar: `CALL sp_enroll_student(3, 4, 'UPI')`. Workbench: `SELECT * FROM enrollment WHERE course_id=4;` and `SELECT * FROM v_payment_report WHERE course_name LIKE 'JEE Math%';` -> one enrollment, one payment 3999 Success. Audit log has an enrollment row.
5. **Rollback demo.** Log in as `kabir.khan@example.com` -> Browse -> same course -> tick **Simulate failed payment** -> Pay & enroll.
   Message: *Payment failed (simulated). Nothing was saved.* SQL bar (red) shows `CALL sp_enroll_student(5, 4, 'FAILED')`. The database rejects mode `FAILED` (CHECK) after the enrollment row was inserted, and the procedure rolls back. Workbench: `SELECT COUNT(*) FROM enrollment WHERE student_id=5 AND course_id=4;` -> 0.
6. **Duplicate enrollment.** The website hides Enroll for courses you already own, so run in Workbench: `CALL sp_enroll_student(3, 4, 'UPI');` -> *Already enrolled in this course.* and nothing is half-saved.
7. **Add a paper, then a bad score.** As Rajesh -> Papers & notes -> course "JEE Mathematics Foundation (Approved)", title "Algebra Test 1", marks 50, link `https://tests.example.com/algebra-1.pdf` -> Publish (SQL bar: plain `INSERT INTO test`). Log in as Rohan -> My learning -> JEE Mathematics Foundation -> type **500** -> *Score cannot exceed the test total marks.* (trigger `trg_attempt_bi`). Then type 40 -> *Attempt recorded. Your rank is #1.* SQL bar: `CALL sp_submit_attempt(3, 4, 40)`. Workbench: `SELECT * FROM v_test_leaderboard WHERE test_id=4;`
8. **Ties share a rank.** Rajesh -> Student results -> "Kinematics Test 1": Rohan and Kabir both scored 74 and both show rank 2. Workbench: `SELECT * FROM v_test_leaderboard WHERE test_id=1 ORDER BY rank_no;`
9. **Cancel enrollment.** As Rohan, open JEE Mathematics Foundation -> Cancel enrollment -> *Cannot cancel: you have already attempted tests in this course.* Now as Kabir enroll in the same course with UPI (no failed-payment tick), then Cancel enrollment -> *Enrollment cancelled*. SQL bar: `CALL sp_cancel_enrollment(5, 4)`. Workbench: `SELECT * FROM v_payment_report WHERE student_name='Kabir Khan';` -> only his old Failed payment is left; the new one vanished with the enrollment (ON DELETE CASCADE). The audit log has an enrollment `DELETE` row.
10. **Results page.** Student -> My results shows percentage and grade. Workbench: `SELECT * FROM v_student_results WHERE student_id=3;` (grade comes from `fn_grade`).
11. **Mark a payment as paid.** Admin -> Payments -> Ananya's Pending row -> Mark as paid. SQL bar: `UPDATE payment SET status='Success' WHERE payment_id=5 AND status='Pending'`. Workbench: `SELECT payment_date FROM payment WHERE payment_id=5;` -> today (trigger `trg_payment_bu`). Activity log shows `status Pending -> Success`.
12. **Reports.** Admin -> Reports -> pick Q1..Q13; the SQL text and the result table appear.
13. **Delete course.** As Rajesh: delete "JEE Chemistry Starter" (works, `CALL sp_delete_course`); try to delete "JEE Advanced Physics Batch" -> *Cannot delete: students are enrolled.*
14. **Dashboards equal views.** Student Dashboard = `SELECT * FROM v_student_dashboard;`, Faculty Dashboard = `SELECT * FROM v_instructor_summary;`.
15. **Roles (Workbench only).** `SHOW GRANTS FOR 'demo_student'@'localhost' USING 'role_student';` then connect as `demo_student` / `Student@123` and try `SELECT * FROM student;` (denied) and `SELECT * FROM v_course_catalog;` (works).

## Part 2 – Viva Q&A (short, honest answers)

**What did you build?** An e-learning system. Students enroll in courses of their exam (JEE/NEET/UPSC), pay, watch lectures, attempt tests and get a rank. Faculty create courses, lectures and tests. The admin approves courses and payments. The website is a thin screen over MySQL.

**Why these tables and keys?** 9 tables, one per real thing: exam_category, student, instructor, course, lecture, enrollment, payment, test, attempt. Every table has a surrogate `AUTO_INCREMENT` primary key. Natural uniqueness is kept with UNIQUE keys: (student, course) in enrollment, (student, test) in attempt, (course, seq_no) in lecture, one payment per enrollment. enrollment is the many-to-many link between student and course.

**Is it in 3NF?** I designed it for 3NF: non-key columns depend on the key only (e.g. instructor details sit in `instructor`, not in `course`). I did not formally prove BCNF, so I do not claim it. There are two deliberate duplications: `attempt.rank_no` (derived from score, stored so the leaderboard is a plain read; the procedure recomputes it with `RANK()`) and `payment.amount` (the price paid at that time; a trigger checks it equals the fee when inserted).

**Why RESTRICT on most foreign keys, CASCADE on two?** RESTRICT stops accidental loss: you cannot delete a student, course or instructor that other rows still use. CASCADE is used where the child has no meaning alone: a payment without its enrollment (`payment.enrollment_id`), and attempts of a deleted test (`attempt.test_id`).

**Why transactions?** ACID. Example: enrolling inserts into `enrollment` and `payment`. If the payment insert fails, the enrollment must not stay (atomicity). The procedure `sp_enroll_student` has `START TRANSACTION ... COMMIT`, with a handler that does `ROLLBACK`. The "Simulate failed payment" box proves it: zero rows remain.

**Why triggers and not app code?** The rules then hold for every client: the website, Workbench or any other program. Examples: score <= total marks, course must be approved, payment = fee. The website shows the database's own message.

**What are views for?** One query, a name, reuse. The screens read views (`v_course_catalog`, `v_student_dashboard`, ...). `v_student_public` hides email, phone and password hash, so a view is also a security tool.

**Why indexes?** InnoDB already indexes foreign keys. I added four for other access paths (ranking by test and score, payment status, course status/category, audit log time). `EXPLAIN` in `demo_queries.sql` shows one in use.

**Why an audit log?** To see who/what changed: enrollments, payment status, course status and fee, attempts. Only triggers write to it, so nobody can forget to log.

**Why are passwords hashed?** So a stolen database does not reveal passwords. They are PBKDF2-SHA256 with a random salt. Honest limits: the admin password is read from `.env`, sessions live in server memory (restart = log in again), and there is no CSRF protection.

**What do roles and GRANT do?** `role_student`, `role_instructor`, `role_admin` give least privilege: students can only read views and `EXECUTE` procedures, instructors cannot set `course.status` (column-level grant). The demo users `demo_student`, `demo_instructor`, `demo_admin` show it in Workbench. The Node app itself connects with one MySQL user from `.env`, so these roles are demonstrated in Workbench, not enforced per website user.
