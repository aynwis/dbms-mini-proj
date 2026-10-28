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