-- ============================================================================
-- DATABASE CREATION & SETUP
-- ============================================================================
DROP DATABASE IF EXISTS elearning_db;
CREATE DATABASE elearning_db 
    CHARACTER SET utf8mb4 
    COLLATE utf8mb4_unicode_ci;

USE elearning_db;

-- ============================================================================
-- TABLE CREATION
-- ============================================================================

-- 1. Exam Categories[cite: 11, 12]
CREATE TABLE exam_category (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Instructors[cite: 11, 12]
CREATE TABLE instructor (
    instructor_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    qualification VARCHAR(100),
    experience_years INT DEFAULT 0 CHECK (experience_years >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 3. Students[cite: 11, 12]
CREATE TABLE student (
    student_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(15),
    city VARCHAR(50),
    registered_exam_id INT,
    registration_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (registered_exam_id) REFERENCES exam_category(category_id) 
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 4. Courses (Normalized Entity)[cite: 11]
CREATE TABLE course (
    course_id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(150) NOT NULL UNIQUE,
    description TEXT,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
    category_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES exam_category(category_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 5. Lectures[cite: 11, 12]
CREATE TABLE lecture (
    lecture_id INT AUTO_INCREMENT PRIMARY KEY,
    course_id INT NOT NULL,
    instructor_id INT NOT NULL,
    title VARCHAR(150) NOT NULL,
    video_link VARCHAR(255) NOT NULL,
    duration_min INT CHECK (duration_min > 0),
    seq_no INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (course_id, seq_no),
    FOREIGN KEY (course_id) REFERENCES course(course_id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (instructor_id) REFERENCES instructor(instructor_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 6. Enrollments[cite: 11, 12, 13]
CREATE TABLE enrollment (
    enrollment_id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    course_id INT NOT NULL,
    enrollment_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, course_id),
    FOREIGN KEY (student_id) REFERENCES student(student_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (course_id) REFERENCES course(course_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 7. Payments[cite: 11, 13]
CREATE TABLE payment (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    enrollment_id INT NOT NULL UNIQUE,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    mode VARCHAR(20) NOT NULL,
    payment_date DATE,
    status VARCHAR(10) NOT NULL DEFAULT 'Pending' 
        CHECK (status IN ('Pending', 'Success', 'Failed')),
    transaction_ref VARCHAR(100) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (enrollment_id) REFERENCES enrollment(enrollment_id) 
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 8. Tests[cite: 11, 13]
CREATE TABLE test (
    test_id INT AUTO_INCREMENT PRIMARY KEY,
    course_id INT NOT NULL,
    title VARCHAR(150) NOT NULL,
    total_marks INT NOT NULL CHECK (total_marks > 0),
    duration_min INT CHECK (duration_min > 0),
    test_paper_link VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES course(course_id) 
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 9. Test Attempts[cite: 11, 13]
CREATE TABLE attempt (
    attempt_id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    test_id INT NOT NULL,
    attempt_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    score INT NOT NULL CHECK (score >= 0),
    rank_no INT CHECK (rank_no > 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, test_id),
    FOREIGN KEY (student_id) REFERENCES student(student_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (test_id) REFERENCES test(test_id) 
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================
CREATE INDEX idx_student_email ON student(email);
CREATE INDEX idx_instructor_email ON instructor(email);
CREATE INDEX idx_course_category ON course(category_id);
CREATE INDEX idx_lecture_course ON lecture(course_id);
CREATE INDEX idx_enrollment_student ON enrollment(student_id);
CREATE INDEX idx_payment_enrollment ON payment(enrollment_id);
CREATE INDEX idx_test_course ON test(course_id);
CREATE INDEX idx_attempt_test_student ON attempt(test_id, student_id);

-- ============================================================================
-- TRIGGERS & BUSINESS RULES
-- ============================================================================
DELIMITER //

CREATE TRIGGER trg_check_attempt_score 
BEFORE INSERT ON attempt
FOR EACH ROW
BEGIN
    DECLARE max_marks INT;
    
    SELECT total_marks INTO max_marks 
    FROM test 
    WHERE test_id = NEW.test_id;
    
    IF NEW.score > max_marks THEN
        SIGNAL SQLSTATE '45000' 
        SET MESSAGE_TEXT = 'Validation Error: Score cannot exceed test total marks.';
    END IF;
END//

DELIMITER ;

-- ============================================================================
-- SAMPLE DATA INSERTION (PRODUCTION READY SEED DATA)[cite: 14]
-- ============================================================================

INSERT INTO exam_category (category_name) VALUES
('JEE'), 
('NEET'), 
('UPSC');

INSERT INTO instructor (name, email, password_hash, qualification, experience_years) VALUES
('Dr. Rajesh Kumar', 'rajesh.kumar@example.com', '$2b$12$eW9.vL1P3j2/8.Kz9...', 'PhD Physics', 12),
('Meera Nair', 'meera.nair@example.com', '$2b$12$eW9.vL1P3j2/8.Kz9...', 'M.Sc Biology', 8),
('Vikram Singh', 'vikram.singh@example.com', '$2b$12$eW9.vL1P3j2/8.Kz9...', 'MA Public Administration', 10);

INSERT INTO student (name, email, password_hash, phone, city, registered_exam_id, registration_date) VALUES
('Aarav Sharma', 'aarav.sharma@example.com', '$2b$12$eW9.vL1P3j2/8.Kz9...', '9876543210', 'Mumbai', 1, '2026-06-10'),
('Diya Patel', 'diya.patel@example.com', '$2b$12$eW9.vL1P3j2/8.Kz9...', '9876543211', 'Pune', 2, '2026-06-12'),
('Rohan Verma', 'rohan.verma@example.com', '$2b$12$eW9.vL1P3j2/8.Kz9...', '9876543212', 'Delhi', 1, '2026-06-15'),
('Ananya Iyer', 'ananya.iyer@example.com', '$2b$12$eW9.vL1P3j2/8.Kz9...', '9876543213', 'Chennai', 2, '2026-06-18');

INSERT INTO course (title, description, price, category_id) VALUES
('JEE Advanced Physics Batch', 'Comprehensive Physics for JEE Advanced', 4999.00, 1),
('NEET Biology Crash Course', 'Complete Biology review for NEET exam', 3499.00, 2),
('UPSC Polity Foundation', 'Foundational General Studies Polity module', 2999.00, 3);

INSERT INTO lecture (course_id, instructor_id, title, video_link, duration_min, seq_no) VALUES
(1, 1, 'Kinematics Basics', 'https://videos.example.com/jee-phy-01', 55, 1),
(1, 1, 'Newton''s Laws of Motion', 'https://videos.example.com/jee-phy-02', 60, 2),
(2, 2, 'Cell Structure', 'https://videos.example.com/neet-bio-01', 50, 1),
(3, 3, 'Constitution Overview', 'https://videos.example.com/upsc-pol-01', 65, 1);

INSERT INTO enrollment (student_id, course_id, enrollment_date) VALUES
(1, 1, '2026-07-01'),
(1, 3, '2026-07-02'),
(2, 2, '2026-07-03'),
(3, 1, '2026-07-04'),
(4, 2, '2026-07-05');

INSERT INTO payment (enrollment_id, amount, mode, payment_date, status, transaction_ref) VALUES
(1, 4999.00, 'UPI', '2026-07-01', 'Success', 'TXN10001'),
(2, 2999.00, 'Card', '2026-07-02', 'Success', 'TXN10002'),
(3, 3499.00, 'NetBanking', '2026-07-03', 'Success', 'TXN10003'),
(4, 4999.00, 'UPI', '2026-07-04', 'Success', 'TXN10004'),
(5, 3499.00, 'Card', NULL, 'Pending', 'TXN10005');

INSERT INTO test (course_id, title, total_marks, duration_min, test_paper_link) VALUES
(1, 'Kinematics Test 1', 100, 90, 'https://tests.example.com/jee-phy-kinematics-1.pdf'),
(2, 'Cell Biology Test 1', 100, 60, 'https://tests.example.com/neet-bio-cell-1.pdf'),
(3, 'Polity Mock Test 1', 100, 120, 'https://tests.example.com/upsc-polity-mock-1.pdf');

INSERT INTO attempt (student_id, test_id, attempt_date, score, rank_no) VALUES
(1, 1, '2026-07-10', 82, 1),
(3, 1, '2026-07-10', 74, 2),
(2, 2, '2026-07-12', 91, 1),
(4, 2, '2026-07-12', 68, 2),
(1, 3, '2026-07-14', 77, 1);