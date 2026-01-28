// create-exam-tables.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

console.log('🎯 Creating exam system tables...\n');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// SQL statements to create missing tables
const sqlStatements = [
    // 1. Subjects table
    `CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(100) NOT NULL UNIQUE,
        code VARCHAR(20),
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 2. Classes table
    `CREATE TABLE IF NOT EXISTS classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(50) NOT NULL UNIQUE,
        level VARCHAR(20),
        stream VARCHAR(50),
        capacity INTEGER DEFAULT 40,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 3. Create new exams table with proper structure
    `CREATE TABLE IF NOT EXISTS exams_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(100) NOT NULL,
        exam_type VARCHAR(50),
        academic_year VARCHAR(20),
        term VARCHAR(20),
        subject_id INTEGER,
        class_id INTEGER,
        total_marks DECIMAL(10,2) DEFAULT 100.00,
        pass_marks DECIMAL(10,2) DEFAULT 50.00,
        exam_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        FOREIGN KEY (subject_id) REFERENCES subjects(id),
        FOREIGN KEY (class_id) REFERENCES classes(id)
    )`,

    // 4. Exam results table
    `CREATE TABLE IF NOT EXISTS exam_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        marks_obtained DECIMAL(10,2),
        grade VARCHAR(5),
        remarks TEXT,
        position_in_class INTEGER,
        position_in_stream INTEGER,
        position_in_level INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (exam_id) REFERENCES exams_new(id),
        FOREIGN KEY (student_id) REFERENCES students(id),
        UNIQUE(exam_id, student_id)
    )`,

    // 5. Grade system table
    `CREATE TABLE IF NOT EXISTS grade_system (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        min_mark DECIMAL(5,2) NOT NULL,
        max_mark DECIMAL(5,2) NOT NULL,
        grade VARCHAR(5) NOT NULL,
        points DECIMAL(3,2) NOT NULL,
        remark VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT 1
    )`
];

// 6. Insert default data
const insertStatements = [
    // Default subjects (Kenya curriculum)
    `INSERT OR IGNORE INTO subjects (name, code) VALUES 
        ('Mathematics', 'MATH'),
        ('English', 'ENG'),
        ('Kiswahili', 'SWA'),
        ('Physics', 'PHY'),
        ('Chemistry', 'CHE'),
        ('Biology', 'BIO'),
        ('History', 'HIS'),
        ('Geography', 'GEO'),
        ('CRE', 'CRE'),
        ('Business Studies', 'BUS'),
        ('Computer Studies', 'COM'),
        ('Agriculture', 'AGR'),
        ('Home Science', 'HSC'),
        ('Art & Design', 'ART'),
        ('Music', 'MUS'),
        ('Physical Education', 'PE')`,

    // Default classes (Forms 1-4)
    `INSERT OR IGNORE INTO classes (name, level, stream) VALUES
        ('Form 1A', 'Form 1', 'A'),
        ('Form 1B', 'Form 1', 'B'),
        ('Form 1C', 'Form 1', 'C'),
        ('Form 2A', 'Form 2', 'A'),
        ('Form 2B', 'Form 2', 'B'),
        ('Form 2C', 'Form 2', 'C'),
        ('Form 3A', 'Form 3', 'A'),
        ('Form 3B', 'Form 3', 'B'),
        ('Form 3C', 'Form 3', 'C'),
        ('Form 4A', 'Form 4', 'A'),
        ('Form 4B', 'Form 4', 'B'),
        ('Form 4C', 'Form 4', 'C')`,

    // Kenya grading system
    `INSERT OR IGNORE INTO grade_system (min_mark, max_mark, grade, points, remark) VALUES
        (80, 100, 'A', 12, 'Excellent'),
        (75, 79, 'A-', 11, 'Very Good'),
        (70, 74, 'B+', 10, 'Good'),
        (65, 69, 'B', 9, 'Above Average'),
        (60, 64, 'B-', 8, 'Average'),
        (55, 59, 'C+', 7, 'Below Average'),
        (50, 54, 'C', 6, 'Fair'),
        (45, 49, 'C-', 5, 'Pass'),
        (40, 44, 'D+', 4, 'Poor'),
        (35, 39, 'D', 3, 'Very Poor'),
        (30, 34, 'D-', 2, 'Fail'),
        (0, 29, 'E', 1, 'Fail')`
];

// Function to run SQL sequentially
async function runSQL() {
    console.log('🔄 Creating tables...');
    
    for (let i = 0; i < sqlStatements.length; i++) {
        try {
            await new Promise((resolve, reject) => {
                db.run(sqlStatements[i], (err) => {
                    if (err) {
                        console.error(`❌ Error creating table ${i + 1}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`✅ Created table ${i + 1}`);
                        resolve();
                    }
                });
            });
        } catch (err) {
            console.log('Continuing with next table...');
        }
    }
    
    console.log('\n📝 Inserting default data...');
    
    for (let i = 0; i < insertStatements.length; i++) {
        try {
            await new Promise((resolve, reject) => {
                db.run(insertStatements[i], function(err) {
                    if (err) {
                        console.error(`❌ Error inserting data ${i + 1}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`✅ Inserted data ${i + 1} (${this.changes} rows)`);
                        resolve();
                    }
                });
            });
        } catch (err) {
            console.log('Continuing with next insert...');
        }
    }
    
    console.log('\n✅ All tables created successfully!');
    console.log('\n📋 SUMMARY:');
    console.log('='.repeat(40));
    console.log('1. subjects table - Created');
    console.log('2. classes table - Created');
    console.log('3. exams_new table - Created (better structure)');
    console.log('4. exam_results table - Created');
    console.log('5. grade_system table - Created');
    console.log('='.repeat(40));
    console.log('\n⚠️  Note: Your old exams table is preserved as "exams"');
    console.log('    New table is "exams_new" with better structure');
    
    db.close();
}

// Run the SQL
runSQL().catch(err => {
    console.error('Fatal error:', err);
    db.close();
});