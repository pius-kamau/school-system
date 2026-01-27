// create-performance-tables.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

console.log('📊 Creating performance tables...');

db.serialize(() => {
    // Subjects table
    db.run(`CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        code TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Exams table (Term 1, Term 2, Term 3, Final Exams)
    db.run(`CREATE TABLE IF NOT EXISTS exams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        term TEXT NOT NULL,
        academic_year TEXT,
        exam_date DATE,
        total_marks INTEGER DEFAULT 100,
        weightage INTEGER DEFAULT 100, -- Percentage weight for final grade
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Student performance (marks) table
    db.run(`CREATE TABLE IF NOT EXISTS student_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        exam_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        marks_obtained DECIMAL(5,2),
        grade TEXT,
        remarks TEXT,
        teacher_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id),
        FOREIGN KEY (exam_id) REFERENCES exams(id),
        FOREIGN KEY (subject_id) REFERENCES subjects(id),
        UNIQUE(student_id, exam_id, subject_id)
    )`);

    // Grades lookup table
    db.run(`CREATE TABLE IF NOT EXISTS grade_scale (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        min_mark INTEGER NOT NULL,
        max_mark INTEGER NOT NULL,
        grade TEXT NOT NULL,
        points DECIMAL(3,2),
        description TEXT
    )`);

    // Insert default subjects (Kenyan curriculum)
    const subjects = [
        ['English', 'ENG', 'English Language'],
        ['Kiswahili', 'KIS', 'Kiswahili Language'],
        ['Mathematics', 'MAT', 'Mathematics'],
        ['Science', 'SCI', 'Science'],
        ['Social Studies', 'SOC', 'Social Studies and CRE'],
        ['Creative Arts', 'ART', 'Art, Craft and Music'],
        ['Physical Education', 'PE', 'Physical Education']
    ];

    const insertSubject = db.prepare('INSERT OR IGNORE INTO subjects (name, code, description) VALUES (?, ?, ?)');
    subjects.forEach(subject => insertSubject.run(subject));
    insertSubject.finalize();

    // Insert default grade scale (Kenyan system)
    const grades = [
        [80, 100, 'A', 12.0, 'Excellent'],
        [75, 79, 'A-', 11.0, 'Very Good'],
        [70, 74, 'B+', 10.0, 'Good'],
        [65, 69, 'B', 9.0, 'Above Average'],
        [60, 64, 'B-', 8.0, 'Average'],
        [55, 59, 'C+', 7.0, 'Below Average'],
        [50, 54, 'C', 6.0, 'Fair'],
        [45, 49, 'C-', 5.0, 'Poor'],
        [40, 44, 'D+', 4.0, 'Very Poor'],
        [35, 39, 'D', 3.0, 'Fail'],
        [0, 34, 'E', 2.0, 'Very Poor']
    ];

    const insertGrade = db.prepare('INSERT OR IGNORE INTO grade_scale (min_mark, max_mark, grade, points, description) VALUES (?, ?, ?, ?, ?)');
    grades.forEach(grade => insertGrade.run(grade));
    insertGrade.finalize();

    // Insert sample exams
    const exams = [
        ['Term 1 Exams', 'Term 1', '2024', '2024-03-20', 100, 30],
        ['Term 2 Exams', 'Term 2', '2024', '2024-06-25', 100, 30],
        ['Term 3 Exams', 'Term 3', '2024', '2024-09-20', 100, 40],
        ['End of Year Exams', 'Final', '2024', '2024-11-15', 100, 100]
    ];

    const insertExam = db.prepare('INSERT OR IGNORE INTO exams (name, term, academic_year, exam_date, total_marks, weightage) VALUES (?, ?, ?, ?, ?, ?)');
    exams.forEach(exam => insertExam.run(exam));
    insertExam.finalize();

    console.log('✅ Performance tables created successfully!');

    // Show what was created
    db.all('SELECT name, code FROM subjects', (err, subjects) => {
        console.log('\n📚 Subjects created:', subjects.length);
        
        db.all('SELECT name, term FROM exams', (err, exams) => {
            console.log('📝 Exams created:', exams.length);
            
            db.all('SELECT grade, points FROM grade_scale ORDER BY points DESC', (err, grades) => {
                console.log('📈 Grade scale created:', grades.length);
                
                db.close();
                console.log('\n🎯 Performance module ready!');
            });
        });
    });
});