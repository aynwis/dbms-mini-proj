-- ============================================================================
-- EduPrep demo / viva script.  Run AFTER miniproj.sql.  In Workbench select ONE
-- block at a time and press Ctrl+Shift+Enter ("run selection").
-- Lines marked  >> EXPECTED ERROR <<  are meant to fail: that is the rule working.
-- To reset everything, just re-run miniproj.sql.
-- ============================================================================
USE elearning_db;

-- ########## PART A : QUERIES (syllabus: joins, aggregates, subqueries, set ops, NULLs) ##########

-- Q1 JOIN (relational algebra: pi(course_name, name)(Course |X| Instructor))
SELECT c.course_name, i.name AS instructor, k.category_name
FROM course c
JOIN instructor i    ON i.instructor_id = c.instructor_id
JOIN exam_category k ON k.category_id   = c.category_id;

-- Q2 GROUP BY + HAVING: exams with at least 2 enrolments
SELECT k.category_name, COUNT(e.enrollment_id) AS enrolments
FROM exam_category k
LEFT JOIN course c     ON c.category_id = k.category_id
LEFT JOIN enrollment e ON e.course_id   = c.course_id
GROUP BY k.category_id, k.category_name
HAVING COUNT(e.enrollment_id) >= 2;

-- Q3 Aggregates per test: attempts, average, highest, lowest
SELECT t.title, COUNT(*) AS attempts, ROUND(AVG(a.score),1) AS avg_score,
       MAX(a.score) AS highest, MIN(a.score) AS lowest
FROM attempt a JOIN test t ON t.test_id = a.test_id
GROUP BY t.test_id, t.title;

-- Q4 Scalar subquery: students who scored above the overall average
SELECT s.name, a.score
FROM attempt a JOIN student s ON s.student_id = a.student_id
WHERE a.score > (SELECT AVG(score) FROM attempt);

-- Q5 IN subquery: courses taught by instructors with more than 9 years' experience
SELECT course_name FROM course
WHERE instructor_id IN (SELECT instructor_id FROM instructor WHERE experience_years > 9);

-- Q6 EXISTS: courses whose tests have been attempted at least once
SELECT c.course_name FROM course c
WHERE EXISTS (SELECT 1 FROM test t JOIN attempt a ON a.test_id = t.test_id WHERE t.course_id = c.course_id);

-- Q7 NOT EXISTS (division-style): students who never completed a successful payment
SELECT s.name FROM student s
WHERE NOT EXISTS (SELECT 1 FROM enrollment e JOIN payment p ON p.enrollment_id = e.enrollment_id
                  WHERE e.student_id = s.student_id AND p.status = 'Success');

-- Q8 Correlated subquery: topper of every test
SELECT t.title, s.name, a.score
FROM attempt a
JOIN test t    ON t.test_id    = a.test_id
JOIN student s ON s.student_id = a.student_id
WHERE a.score = (SELECT MAX(score) FROM attempt WHERE test_id = a.test_id);

-- Q9 Set operation UNION: every registered person with their role
SELECT name, email, 'Student'    AS role FROM student
UNION
SELECT name, email, 'Instructor' AS role FROM instructor;

-- Q10 NULL handling: pending payments have no date yet
SELECT payment_id, status, COALESCE(payment_date, 'not paid yet') AS paid_on FROM payment;
SELECT payment_id FROM payment WHERE payment_date IS NULL;

-- Q11 Window function: recompute the ranks and compare with the stored rank_no
SELECT test_id, student_id, score, rank_no,
       RANK() OVER (PARTITION BY test_id ORDER BY score DESC) AS recomputed_rank
FROM attempt ORDER BY test_id, rank_no;

-- Q12 Derived table: courses earning more than the average course
SELECT course_name, revenue
FROM v_course_stats
WHERE revenue > (SELECT AVG(r) FROM (SELECT revenue AS r FROM v_course_stats) x);

-- Q13 Stored function used inside a query
SELECT student_name, test_title, score, fn_grade(score, total_marks) AS grade FROM v_student_results;

-- Q14 Views (each one is what a UI screen reads)
SELECT * FROM v_course_catalog;
SELECT * FROM v_course_stats;
SELECT * FROM v_student_dashboard;
SELECT * FROM v_student_results;
SELECT * FROM v_test_leaderboard WHERE test_id = 1 ORDER BY rank_no;
SELECT * FROM v_instructor_summary;
SELECT * FROM v_payment_report;
SELECT * FROM v_pending_courses;
SELECT * FROM v_student_public;

-- Q15 Why the indexes matter: EXPLAIN shows the index being used
EXPLAIN SELECT * FROM attempt WHERE test_id = 1 ORDER BY score DESC;


-- ########## PART B : BUSINESS RULES (triggers). Each should FAIL. ##########

-- B1  student in the wrong exam   >> EXPECTED ERROR <<  (trg_enrollment_bi)
INSERT INTO enrollment (student_id, course_id) VALUES (2, 1);
-- B2  course not approved yet     >> EXPECTED ERROR <<  (trg_enrollment_bi)
INSERT INTO enrollment (student_id, course_id) VALUES (3, 4);
-- B3  score above total marks     >> EXPECTED ERROR <<  (trg_attempt_bi)
INSERT INTO attempt (student_id, test_id, score) VALUES (3, 1, 500);
-- B4  attempt without enrolment   >> EXPECTED ERROR <<  (trg_attempt_bi)
INSERT INTO attempt (student_id, test_id, score) VALUES (2, 1, 50);
-- B5  wrong payment amount        >> EXPECTED ERROR <<  (trg_payment_bi)
INSERT INTO payment (enrollment_id, amount, mode) VALUES (1, 100, 'UPI');
-- B6  lecture in a pending course >> EXPECTED ERROR <<  (trg_lecture_bi)
INSERT INTO lecture (course_id, title, video_link, duration_min, seq_no) VALUES (4, 'Intro', 'https://v.example/x', 20, 1);
-- B7  un-approve a course         >> EXPECTED ERROR <<  (trg_course_bu)
UPDATE course SET status = 'Pending' WHERE course_id = 1;
-- B8  plain CHECK constraint      >> EXPECTED ERROR <<
UPDATE course SET fee = -5 WHERE course_id = 1;


-- ########## PART C : TRANSACTIONS (ACID) ##########

-- C1  ATOMICITY: a rolled-back transaction leaves nothing behind
START TRANSACTION;
  UPDATE course SET fee = 9999 WHERE course_id = 1;
  SELECT course_id, fee FROM course WHERE course_id = 1;            -- shows 9999 inside the transaction
ROLLBACK;
SELECT course_id, fee FROM course WHERE course_id = 1;              -- back to 4999

-- C2  SAVEPOINT: undo only the second half
START TRANSACTION;
  UPDATE course SET fee = 5099 WHERE course_id = 1;
  SAVEPOINT after_fee;
  UPDATE course SET description = 'temporary text' WHERE course_id = 1;
  ROLLBACK TO SAVEPOINT after_fee;
  SELECT fee, description FROM course WHERE course_id = 1;          -- fee kept, description undone
ROLLBACK;

-- C3  Procedures = whole transactions. Run these in order (the DB changes; re-run miniproj.sql to reset).
CALL sp_approve_course(4);                       -- admin approves the pending course
CALL sp_enroll_student(3, 4, 'UPI');             -- enrolment + payment, one transaction
CALL sp_enroll_student(3, 4, 'UPI');             -- >> EXPECTED ERROR << already enrolled (and nothing was half-saved)
INSERT INTO test (course_id, title, total_marks, duration_min, test_paper_link)
       VALUES (4, 'Algebra Test 1', 50, 45, 'https://tests.example.com/algebra-1.pdf');
CALL sp_submit_attempt(3, 4, 40);                -- attempt saved and test re-ranked
CALL sp_submit_attempt(3, 4, 45);                -- >> EXPECTED ERROR << already attempted
CALL sp_cancel_enrollment(3, 4);                 -- >> EXPECTED ERROR << has an attempt, so it cannot be cancelled
SELECT * FROM v_payment_report WHERE course_name LIKE 'JEE Math%';
SELECT * FROM v_test_leaderboard WHERE test_id = 4;

-- C4  The audit_log was filled by triggers, nobody inserted these rows by hand
SELECT * FROM audit_log ORDER BY log_id;


-- ########## PART D : ACCESS CONTROL (DCL) ##########
SHOW GRANTS FOR 'demo_student'@'localhost' USING 'role_student';
SHOW GRANTS FOR 'demo_instructor'@'localhost' USING 'role_instructor';
-- Then open a NEW connection as demo_student / Student@123 and try:
--   SELECT * FROM v_course_catalog;                  works
--   SELECT * FROM student;                           >> EXPECTED ERROR << (password_hash is protected)
--   INSERT INTO enrollment (student_id, course_id) VALUES (3, 2);   >> EXPECTED ERROR <<
-- As demo_instructor / Teacher@123:
--   UPDATE course SET status = 'Approved' WHERE course_id = 4;      >> EXPECTED ERROR << (column-level grant)
--   SELECT * FROM payment;                           >> EXPECTED ERROR <<
