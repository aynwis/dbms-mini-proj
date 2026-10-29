-- EduPrep Online (MySQL 8.0.16+). Run the whole file in Workbench; it rebuilds the DB.
DROP DATABASE IF EXISTS elearning_db;
CREATE DATABASE elearning_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE elearning_db;

-- ===== DDL (FKs are RESTRICT, except attempt.test_id and payment.enrollment_id = CASCADE) =====
CREATE TABLE exam_category (
    category_id   INT AUTO_INCREMENT PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE instructor (
    instructor_id    INT AUTO_INCREMENT PRIMARY KEY,
    name             VARCHAR(100) NOT NULL,
    email            VARCHAR(100) NOT NULL UNIQUE,
    password_hash    VARCHAR(255) NOT NULL,
    qualification    VARCHAR(100),
    experience_years INT NOT NULL DEFAULT 0 CHECK (experience_years >= 0)
) ENGINE=InnoDB;

CREATE TABLE student (
    student_id         INT AUTO_INCREMENT PRIMARY KEY,
    name               VARCHAR(100) NOT NULL,
    email              VARCHAR(100) NOT NULL UNIQUE,
    password_hash      VARCHAR(255) NOT NULL,
    phone              VARCHAR(15),
    city               VARCHAR(50),
    registered_exam_id INT,
    registration_date  DATE NOT NULL DEFAULT (CURRENT_DATE),
    FOREIGN KEY (registered_exam_id) REFERENCES exam_category(category_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE course (
    course_id     INT AUTO_INCREMENT PRIMARY KEY,
    course_name   VARCHAR(150) NOT NULL UNIQUE,
    description   TEXT,
    fee           DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
    category_id   INT NOT NULL,
    instructor_id INT NOT NULL,
    status        VARCHAR(10) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved')),
    FOREIGN KEY (category_id)   REFERENCES exam_category(category_id) ON DELETE RESTRICT,
    FOREIGN KEY (instructor_id) REFERENCES instructor(instructor_id)  ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE lecture (
    lecture_id   INT AUTO_INCREMENT PRIMARY KEY,
    course_id    INT NOT NULL,
    title        VARCHAR(150) NOT NULL,
    video_link   VARCHAR(255) NOT NULL,
    duration_min INT CHECK (duration_min > 0),
    seq_no       INT NOT NULL CHECK (seq_no > 0),
    UNIQUE (course_id, seq_no),
    FOREIGN KEY (course_id) REFERENCES course(course_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE enrollment (
    enrollment_id   INT AUTO_INCREMENT PRIMARY KEY,
    student_id      INT NOT NULL,
    course_id       INT NOT NULL,
    enrollment_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    UNIQUE (student_id, course_id),
    FOREIGN KEY (student_id) REFERENCES student(student_id) ON DELETE RESTRICT,
    FOREIGN KEY (course_id)  REFERENCES course(course_id)   ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE payment (
    payment_id      INT AUTO_INCREMENT PRIMARY KEY,
    enrollment_id   INT NOT NULL UNIQUE,
    amount          DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    mode            VARCHAR(20) NOT NULL CHECK (mode IN ('UPI', 'Card', 'NetBanking')),
    payment_date    DATE,
    status          VARCHAR(10) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Success', 'Failed')),
    transaction_ref VARCHAR(100) UNIQUE,
    FOREIGN KEY (enrollment_id) REFERENCES enrollment(enrollment_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE test (
    test_id         INT AUTO_INCREMENT PRIMARY KEY,
    course_id       INT NOT NULL,
    title           VARCHAR(150) NOT NULL,
    total_marks     INT NOT NULL CHECK (total_marks > 0),
    duration_min    INT CHECK (duration_min > 0),
    test_paper_link VARCHAR(255) NOT NULL,
    FOREIGN KEY (course_id) REFERENCES course(course_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- rank_no is stored on purpose (denormalised): the leaderboard becomes a plain read.
CREATE TABLE attempt (
    attempt_id   INT AUTO_INCREMENT PRIMARY KEY,
    student_id   INT NOT NULL,
    test_id      INT NOT NULL,
    attempt_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    score        INT NOT NULL CHECK (score >= 0),
    rank_no      INT CHECK (rank_no > 0),
    UNIQUE (student_id, test_id),
    FOREIGN KEY (student_id) REFERENCES student(student_id) ON DELETE RESTRICT,
    FOREIGN KEY (test_id)    REFERENCES test(test_id)       ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== DML: seed data (abstract rows unchanged; "extra" = added). Triggers come after, so it loads as given =====
SET @pw = 'pbkdf2:sha256:1000000$eN1c0g3UlfIGgcsq$399cf2b0907f83012289047d3bf39fb98c2c2cda2415dffe66a82b1db1da1b3b'; -- Pass@123

INSERT INTO exam_category (category_name) VALUES ('JEE'), ('NEET'), ('UPSC');

INSERT INTO instructor (name, email, password_hash, qualification, experience_years) VALUES
('Dr. Rajesh Kumar', 'rajesh.kumar@example.com', @pw, 'PhD Physics', 12),
('Meera Nair',       'meera.nair@example.com',    @pw, 'M.Sc Biology', 8),
('Vikram Singh',     'vikram.singh@example.com',  @pw, 'MA Public Administration', 10);

INSERT INTO student (name, email, password_hash, phone, city, registered_exam_id, registration_date) VALUES
('Aarav Sharma', 'aarav.sharma@example.com', @pw, '9876543210', 'Mumbai',  1, '2026-06-10'),
('Diya Patel',   'diya.patel@example.com',   @pw, '9876543211', 'Pune',    2, '2026-06-12'),
('Rohan Verma',  'rohan.verma@example.com',  @pw, '9876543212', 'Delhi',   1, '2026-06-15'),
('Ananya Iyer',  'ananya.iyer@example.com',  @pw, '9876543213', 'Chennai', 2, '2026-06-18'),
('Kabir Khan',   'kabir.khan@example.com',   @pw, '9876543214', 'Jaipur',  1, '2026-06-20'); -- extra

INSERT INTO course (course_name, description, fee, category_id, instructor_id, status) VALUES
('JEE Advanced Physics Batch', 'Comprehensive Physics for JEE Advanced',     4999.00, 1, 1, 'Approved'),
('NEET Biology Crash Course',  'Complete Biology review for NEET exam',      3499.00, 2, 2, 'Approved'),
('UPSC Polity Foundation',     'Foundational General Studies Polity module', 2999.00, 3, 3, 'Approved'),
('JEE Mathematics Foundation', 'Algebra and calculus basics for JEE',        3999.00, 1, 1, 'Pending'); -- extra

INSERT INTO lecture (course_id, title, video_link, duration_min, seq_no) VALUES
(1, 'Kinematics Basics',        'https://videos.example.com/jee-phy-01',  55, 1),
(1, 'Newton''s Laws of Motion', 'https://videos.example.com/jee-phy-02',  60, 2),
(2, 'Cell Structure',           'https://videos.example.com/neet-bio-01', 50, 1),
(3, 'Constitution Overview',    'https://videos.example.com/upsc-pol-01', 65, 1);

INSERT INTO enrollment (student_id, course_id, enrollment_date) VALUES
(1, 1, '2026-07-01'), (1, 3, '2026-07-02'), (2, 2, '2026-07-03'),
(3, 1, '2026-07-04'), (4, 2, '2026-07-05'),
(5, 1, '2026-07-06'); -- extra

INSERT INTO payment (enrollment_id, amount, mode, payment_date, status, transaction_ref) VALUES
(1, 4999.00, 'UPI',        '2026-07-01', 'Success', 'TXN10001'),
(2, 2999.00, 'Card',       '2026-07-02', 'Success', 'TXN10002'),
(3, 3499.00, 'NetBanking', '2026-07-03', 'Success', 'TXN10003'),
(4, 4999.00, 'UPI',        '2026-07-04', 'Success', 'TXN10004'),
(5, 3499.00, 'Card',       NULL,         'Pending', 'TXN10005'),
(6, 4999.00, 'Card',       '2026-07-06', 'Failed',  'TXN10006'); -- extra: failed payment

INSERT INTO test (course_id, title, total_marks, duration_min, test_paper_link) VALUES
(1, 'Kinematics Test 1',   100, 90,  'https://tests.example.com/jee-phy-kinematics-1.pdf'),
(2, 'Cell Biology Test 1', 100, 60,  'https://tests.example.com/neet-bio-cell-1.pdf'),
(3, 'Polity Mock Test 1',  100, 120, 'https://tests.example.com/upsc-polity-mock-1.pdf');

INSERT INTO attempt (student_id, test_id, attempt_date, score, rank_no) VALUES
(1, 1, '2026-07-10', 82, 1), (3, 1, '2026-07-10', 74, 2),
(2, 2, '2026-07-12', 91, 1), (4, 2, '2026-07-12', 68, 2),
(1, 3, '2026-07-14', 77, 1),
(5, 1, '2026-07-11', 74, 2); -- extra: ties with Rohan, both share rank 2

-- ===== Triggers (2) =====
DELIMITER //

-- Course must be Approved and in the student's registered exam.
CREATE TRIGGER trg_enrollment_bi BEFORE INSERT ON enrollment FOR EACH ROW
BEGIN
    DECLARE v_status VARCHAR(10);
    DECLARE v_cat, v_exam INT;
    SELECT status, category_id INTO v_status, v_cat FROM course WHERE course_id = NEW.course_id;
    IF v_status <> 'Approved' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This course is not approved yet.';
    END IF;
    SELECT registered_exam_id INTO v_exam FROM student WHERE student_id = NEW.student_id;
    IF v_exam IS NULL OR v_exam <> v_cat THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This course is not in your registered exam.';
    END IF;
END//

-- Score must fit the test, and the student must be enrolled in its course.
CREATE TRIGGER trg_attempt_bi BEFORE INSERT ON attempt FOR EACH ROW
BEGIN
    DECLARE v_marks, v_course INT;
    SELECT total_marks, course_id INTO v_marks, v_course FROM test WHERE test_id = NEW.test_id;
    IF NEW.score > v_marks THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Score cannot exceed the test total marks.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM enrollment WHERE student_id = NEW.student_id AND course_id = v_course) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'You are not enrolled in the course of this test.';
    END IF;
END//

DELIMITER ;

-- ===== Views (2) =====
CREATE VIEW v_course_catalog AS   -- what students browse: Approved courses only
SELECT c.course_id, c.course_name, c.description, c.fee, c.category_id, k.category_name,
       i.name AS instructor_name,
       (SELECT COUNT(*) FROM lecture l WHERE l.course_id = c.course_id) AS lecture_count,
       (SELECT COUNT(*) FROM test t    WHERE t.course_id = c.course_id) AS test_count
  FROM course c
  JOIN exam_category k ON k.category_id   = c.category_id
  JOIN instructor i    ON i.instructor_id = c.instructor_id
 WHERE c.status = 'Approved';

CREATE VIEW v_test_leaderboard AS
SELECT t.test_id, t.title AS test_title, t.total_marks, a.rank_no, s.name AS student_name, a.score
  FROM attempt a JOIN test t ON t.test_id = a.test_id JOIN student s ON s.student_id = a.student_id;

-- ============================================================================
-- ===== EXTENSIONS (everything below is added on top of the verified schema) =====
-- The 9 verified tables, their columns, seed data, 2 triggers and 2 views above
-- are untouched. The only new table is audit_log (written by triggers only).
-- ============================================================================

-- ===== Audit table + extra indexes =====
-- (InnoDB already indexes every foreign key, so these cover other access paths)
CREATE TABLE audit_log (
    log_id     INT AUTO_INCREMENT PRIMARY KEY,
    table_name VARCHAR(30)  NOT NULL,
    action     VARCHAR(10)  NOT NULL,
    record_id  INT,
    details    VARCHAR(255),
    changed_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE INDEX idx_attempt_test_score ON attempt(test_id, score);   -- ranking a test
CREATE INDEX idx_payment_status     ON payment(status);           -- revenue reports
CREATE INDEX idx_course_status_cat  ON course(status, category_id); -- catalogue filter
CREATE INDEX idx_audit_table_time   ON audit_log(table_name, changed_at);


-- ===== More triggers (BEFORE = business rules, AFTER = audit trail) =====
DELIMITER //

-- Rule: a payment must equal the course fee.
CREATE TRIGGER trg_payment_bi BEFORE INSERT ON payment FOR EACH ROW
BEGIN
    DECLARE v_fee DECIMAL(10,2);
    SELECT c.fee INTO v_fee
      FROM enrollment e JOIN course c ON c.course_id = e.course_id
     WHERE e.enrollment_id = NEW.enrollment_id;
    IF v_fee IS NULL OR NEW.amount <> v_fee THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment amount must equal the course fee.';
    END IF;
END//

-- Rule: when a payment becomes Success without a date, stamp today's date.
CREATE TRIGGER trg_payment_bu BEFORE UPDATE ON payment FOR EACH ROW
BEGIN
    IF NEW.status = 'Success' AND OLD.status <> 'Success' AND NEW.payment_date IS NULL THEN
        SET NEW.payment_date = CURRENT_DATE;
    END IF;
END//

-- Rule: lectures only go into Approved courses.
CREATE TRIGGER trg_lecture_bi BEFORE INSERT ON lecture FOR EACH ROW
BEGIN
    IF (SELECT status FROM course WHERE course_id = NEW.course_id) <> 'Approved' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Lectures can only be added to an approved course.';
    END IF;
END//

-- Rule: tests only go into Approved courses.
CREATE TRIGGER trg_test_bi BEFORE INSERT ON test FOR EACH ROW
BEGIN
    IF (SELECT status FROM course WHERE course_id = NEW.course_id) <> 'Approved' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tests can only be added to an approved course.';
    END IF;
END//

-- Rule: approval cannot be withdrawn.
CREATE TRIGGER trg_course_bu BEFORE UPDATE ON course FOR EACH ROW
BEGIN
    IF OLD.status = 'Approved' AND NEW.status = 'Pending' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An approved course cannot go back to Pending.';
    END IF;
END//

-- Audit trail
CREATE TRIGGER trg_audit_enrollment_ai AFTER INSERT ON enrollment FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, action, record_id, details)
    VALUES ('enrollment', 'INSERT', NEW.enrollment_id,
            CONCAT('student ', NEW.student_id, ' enrolled in course ', NEW.course_id));
END//

CREATE TRIGGER trg_audit_enrollment_ad AFTER DELETE ON enrollment FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, action, record_id, details)
    VALUES ('enrollment', 'DELETE', OLD.enrollment_id,
            CONCAT('student ', OLD.student_id, ' left course ', OLD.course_id));
END//

CREATE TRIGGER trg_audit_payment_au AFTER UPDATE ON payment FOR EACH ROW
BEGIN
    IF OLD.status <> NEW.status THEN
        INSERT INTO audit_log (table_name, action, record_id, details)
        VALUES ('payment', 'UPDATE', NEW.payment_id, CONCAT('status ', OLD.status, ' -> ', NEW.status));
    END IF;
END//

CREATE TRIGGER trg_audit_course_au AFTER UPDATE ON course FOR EACH ROW
BEGIN
    IF OLD.status <> NEW.status THEN
        INSERT INTO audit_log (table_name, action, record_id, details)
        VALUES ('course', 'UPDATE', NEW.course_id, CONCAT('status ', OLD.status, ' -> ', NEW.status));
    END IF;
    IF OLD.fee <> NEW.fee THEN
        INSERT INTO audit_log (table_name, action, record_id, details)
        VALUES ('course', 'UPDATE', NEW.course_id, CONCAT('fee ', OLD.fee, ' -> ', NEW.fee));
    END IF;
END//

CREATE TRIGGER trg_audit_attempt_ai AFTER INSERT ON attempt FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, action, record_id, details)
    VALUES ('attempt', 'INSERT', NEW.attempt_id,
            CONCAT('student ', NEW.student_id, ' scored ', NEW.score, ' in test ', NEW.test_id));
END//

DELIMITER ;


-- ===== Stored function =====
DELIMITER //
CREATE FUNCTION fn_grade(p_score INT, p_total INT) RETURNS VARCHAR(2) DETERMINISTIC
BEGIN
    DECLARE pct DECIMAL(5,2);
    SET pct = p_score * 100.0 / p_total;
    RETURN CASE WHEN pct >= 90 THEN 'A+' WHEN pct >= 80 THEN 'A' WHEN pct >= 70 THEN 'B'
                WHEN pct >= 60 THEN 'C'  WHEN pct >= 40 THEN 'D' ELSE 'F' END;
END//
DELIMITER ;


-- ===== More views (the UI reads its dashboards from these) =====

-- one row per course with counts and revenue (admin / instructor reports)
CREATE VIEW v_course_stats AS
SELECT c.course_id, c.course_name, c.fee, c.status,
       k.category_name, i.instructor_id, i.name AS instructor_name,
       (SELECT COUNT(*) FROM lecture    l WHERE l.course_id = c.course_id) AS lecture_count,
       (SELECT COUNT(*) FROM test       t WHERE t.course_id = c.course_id) AS test_count,
       (SELECT COUNT(*) FROM enrollment e WHERE e.course_id = c.course_id) AS enrolled_count,
       (SELECT COALESCE(SUM(p.amount), 0)
          FROM payment p JOIN enrollment e ON e.enrollment_id = p.enrollment_id
         WHERE e.course_id = c.course_id AND p.status = 'Success')          AS revenue
  FROM course c
  JOIN exam_category k ON k.category_id   = c.category_id
  JOIN instructor    i ON i.instructor_id = c.instructor_id;

-- one row per student: dashboard numbers (LEFT JOIN + aggregates)
CREATE VIEW v_student_dashboard AS
SELECT s.student_id, s.name, s.registered_exam_id, k.category_name AS exam_name,
       (SELECT COUNT(*) FROM enrollment e WHERE e.student_id = s.student_id) AS courses_enrolled,
       COUNT(a.attempt_id)    AS tests_attempted,
       MIN(a.rank_no)         AS best_rank,
       ROUND(AVG(a.score), 1) AS avg_score
  FROM student s
  LEFT JOIN exam_category k ON k.category_id = s.registered_exam_id
  LEFT JOIN attempt a       ON a.student_id  = s.student_id
 GROUP BY s.student_id, s.name, s.registered_exam_id, k.category_name;

-- every result with percentage and grade (4-table join + stored function)
CREATE VIEW v_student_results AS
SELECT a.attempt_id, a.student_id, s.name AS student_name,
       t.test_id, t.title AS test_title, c.course_id, c.course_name,
       a.attempt_date, a.score, t.total_marks,
       ROUND(a.score * 100 / t.total_marks, 1) AS percentage,
       fn_grade(a.score, t.total_marks)        AS grade,
       a.rank_no
  FROM attempt a
  JOIN student s ON s.student_id = a.student_id
  JOIN test    t ON t.test_id    = a.test_id
  JOIN course  c ON c.course_id  = t.course_id;

-- instructor dashboard numbers
CREATE VIEW v_instructor_summary AS
SELECT i.instructor_id, i.name, i.qualification, i.experience_years,
       COUNT(c.course_id)                                   AS courses,
       COUNT(CASE WHEN c.status = 'Approved' THEN 1 END)    AS approved_courses,
       (SELECT COUNT(*) FROM lecture l JOIN course c2 ON c2.course_id = l.course_id
         WHERE c2.instructor_id = i.instructor_id)          AS lectures,
       (SELECT COUNT(*) FROM test t JOIN course c3 ON c3.course_id = t.course_id
         WHERE c3.instructor_id = i.instructor_id)          AS tests,
       (SELECT COUNT(*) FROM enrollment e JOIN course c4 ON c4.course_id = e.course_id
         WHERE c4.instructor_id = i.instructor_id)          AS enrollments
  FROM instructor i
  LEFT JOIN course c ON c.instructor_id = i.instructor_id
 GROUP BY i.instructor_id, i.name, i.qualification, i.experience_years;

-- payments with who paid for what
CREATE VIEW v_payment_report AS
SELECT p.payment_id, s.name AS student_name, c.course_name, p.amount, p.mode,
       p.payment_date, p.status, p.transaction_ref
  FROM payment p
  JOIN enrollment e ON e.enrollment_id = p.enrollment_id
  JOIN student    s ON s.student_id    = e.student_id
  JOIN course     c ON c.course_id     = e.course_id;

-- admin work-list: courses waiting for approval
CREATE VIEW v_pending_courses AS
SELECT c.course_id, c.course_name, c.fee, k.category_name, i.name AS instructor_name
  FROM course c
  JOIN exam_category k ON k.category_id   = c.category_id
  JOIN instructor    i ON i.instructor_id = c.instructor_id
 WHERE c.status = 'Pending';

-- security view: hides email, phone and password_hash
CREATE VIEW v_student_public AS
SELECT student_id, name, city, registered_exam_id FROM student;


-- ===== Stored procedures = transactions (every UI write that touches >1 table) =====
DELIMITER //

-- Enrol + pay as ONE unit: both rows are saved or neither is.
CREATE PROCEDURE sp_enroll_student(IN p_student_id INT, IN p_course_id INT, IN p_mode VARCHAR(20))
BEGIN
    DECLARE v_fee DECIMAL(10,2) DEFAULT NULL;
    DECLARE v_enr INT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT fee INTO v_fee FROM course WHERE course_id = p_course_id FOR UPDATE;
    IF v_fee IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Course not found.';
    END IF;
    IF EXISTS (SELECT 1 FROM enrollment WHERE student_id = p_student_id AND course_id = p_course_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Already enrolled in this course.';
    END IF;

    INSERT INTO enrollment (student_id, course_id) VALUES (p_student_id, p_course_id); -- trg_enrollment_bi checks approval + exam
    SET v_enr = LAST_INSERT_ID();

    IF v_fee > 0 THEN
        INSERT INTO payment (enrollment_id, amount, mode, payment_date, status, transaction_ref)
        VALUES (v_enr, v_fee, p_mode, CURRENT_DATE, 'Success',
                CONCAT('TXN', DATE_FORMAT(NOW(), '%y%m%d%H%i%s'), LPAD(v_enr, 4, '0')));
    END IF;
    COMMIT;
    SELECT v_enr AS enrollment_id, 'Enrolled successfully' AS message;
END//

-- Save an attempt and re-rank the whole test atomically. Equal scores share a rank.
CREATE PROCEDURE sp_submit_attempt(IN p_student_id INT, IN p_test_id INT, IN p_score INT)
BEGIN
    DECLARE v_total INT DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT total_marks INTO v_total FROM test WHERE test_id = p_test_id FOR UPDATE;  -- serialises concurrent submissions
    IF v_total IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Test not found.';
    END IF;
    IF EXISTS (SELECT 1 FROM attempt WHERE student_id = p_student_id AND test_id = p_test_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'You have already attempted this test.';
    END IF;

    INSERT INTO attempt (student_id, test_id, attempt_date, score)      -- trg_attempt_bi checks score + enrollment
    VALUES (p_student_id, p_test_id, CURRENT_DATE, p_score);

    UPDATE attempt a
      JOIN (SELECT attempt_id, RANK() OVER (ORDER BY score DESC) AS rk
              FROM attempt WHERE test_id = p_test_id) r ON r.attempt_id = a.attempt_id
       SET a.rank_no = r.rk;
    COMMIT;
    SELECT rank_no, 'Attempt recorded' AS message
      FROM attempt WHERE student_id = p_student_id AND test_id = p_test_id;
END//

-- Cancel an enrolment (its payment row goes too: ON DELETE CASCADE).
CREATE PROCEDURE sp_cancel_enrollment(IN p_student_id INT, IN p_course_id INT)
BEGIN
    DECLARE v_enr INT DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT enrollment_id INTO v_enr FROM enrollment
     WHERE student_id = p_student_id AND course_id = p_course_id FOR UPDATE;
    IF v_enr IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Enrollment not found.';
    END IF;
    IF EXISTS (SELECT 1 FROM attempt a JOIN test t ON t.test_id = a.test_id
                WHERE a.student_id = p_student_id AND t.course_id = p_course_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot cancel: you have already attempted tests in this course.';
    END IF;
    DELETE FROM enrollment WHERE enrollment_id = v_enr;
    COMMIT;
    SELECT 'Enrollment cancelled' AS message;
END//

-- Admin approves a course.
CREATE PROCEDURE sp_approve_course(IN p_course_id INT)
BEGIN
    DECLARE v_status VARCHAR(10) DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT status INTO v_status FROM course WHERE course_id = p_course_id FOR UPDATE;
    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Course not found.';
    END IF;
    IF v_status = 'Approved' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Course is already approved.';
    END IF;
    UPDATE course SET status = 'Approved' WHERE course_id = p_course_id;
    COMMIT;
    SELECT 'Course approved' AS message;
END//

-- Instructor deletes own course with its tests (attempts cascade) and lectures, all or nothing.
CREATE PROCEDURE sp_delete_course(IN p_course_id INT, IN p_instructor_id INT)
BEGIN
    DECLARE v_owner INT DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT instructor_id INTO v_owner FROM course WHERE course_id = p_course_id FOR UPDATE;
    IF v_owner IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Course not found.';
    END IF;
    IF v_owner <> p_instructor_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'You can only delete your own course.';
    END IF;
    IF EXISTS (SELECT 1 FROM enrollment WHERE course_id = p_course_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot delete: students are enrolled.';
    END IF;
    DELETE FROM test    WHERE course_id = p_course_id;
    DELETE FROM lecture WHERE course_id = p_course_id;
    DELETE FROM course  WHERE course_id = p_course_id;
    COMMIT;
    SELECT 'Course deleted' AS message;
END//

DELIMITER ;


-- ===== Data Control Language: roles, users, least-privilege grants =====
-- (last on purpose: needs CREATE USER / ROLE rights, everything above works without them)
-- DROP DATABASE does not remove users/roles, so clear them first: this keeps the script re-runnable
DROP USER IF EXISTS 'demo_student'@'localhost', 'demo_instructor'@'localhost', 'demo_admin'@'localhost';
DROP ROLE IF EXISTS 'role_student', 'role_instructor', 'role_admin';
CREATE ROLE 'role_student', 'role_instructor', 'role_admin';

-- students: read catalogue and their own views; write ONLY through the procedures
GRANT SELECT  ON elearning_db.exam_category       TO 'role_student';
GRANT SELECT  ON elearning_db.lecture             TO 'role_student';
GRANT SELECT  ON elearning_db.test                TO 'role_student';
GRANT SELECT  ON elearning_db.v_course_catalog    TO 'role_student';
GRANT SELECT  ON elearning_db.v_student_dashboard TO 'role_student';
GRANT SELECT  ON elearning_db.v_student_results   TO 'role_student';
GRANT SELECT  ON elearning_db.v_test_leaderboard  TO 'role_student';
GRANT EXECUTE ON PROCEDURE elearning_db.sp_enroll_student    TO 'role_student';
GRANT EXECUTE ON PROCEDURE elearning_db.sp_submit_attempt    TO 'role_student';
GRANT EXECUTE ON PROCEDURE elearning_db.sp_cancel_enrollment TO 'role_student';

-- instructors: column-level grants on course, so they cannot self-approve (status) or reassign it
GRANT SELECT, INSERT (course_name, description, fee, category_id, instructor_id),
              UPDATE (course_name, description, fee)  ON elearning_db.course  TO 'role_instructor';
GRANT SELECT, INSERT, UPDATE, DELETE                  ON elearning_db.lecture TO 'role_instructor';
GRANT SELECT, INSERT, UPDATE, DELETE                  ON elearning_db.test    TO 'role_instructor';
GRANT SELECT ON elearning_db.exam_category        TO 'role_instructor';
GRANT SELECT ON elearning_db.v_course_stats       TO 'role_instructor';
GRANT SELECT ON elearning_db.v_instructor_summary TO 'role_instructor';
GRANT SELECT ON elearning_db.v_test_leaderboard   TO 'role_instructor';
GRANT SELECT ON elearning_db.v_student_public     TO 'role_instructor';
GRANT EXECUTE ON PROCEDURE elearning_db.sp_delete_course TO 'role_instructor';

-- admin: everything in this database (approves courses, sees payments and audit log)
GRANT ALL PRIVILEGES ON elearning_db.* TO 'role_admin';

CREATE USER 'demo_student'@'localhost'    IDENTIFIED BY 'Student@123';
CREATE USER 'demo_instructor'@'localhost' IDENTIFIED BY 'Teacher@123';
CREATE USER 'demo_admin'@'localhost'      IDENTIFIED BY 'Admin@123';
GRANT 'role_student'    TO 'demo_student'@'localhost';
GRANT 'role_instructor' TO 'demo_instructor'@'localhost';
GRANT 'role_admin'      TO 'demo_admin'@'localhost';
SET DEFAULT ROLE 'role_student'    TO 'demo_student'@'localhost';
SET DEFAULT ROLE 'role_instructor' TO 'demo_instructor'@'localhost';
SET DEFAULT ROLE 'role_admin'      TO 'demo_admin'@'localhost';
