// create-test-exam-data.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

console.log('📝 Creating test exam data...\n');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

async function createTestData() {
    try {
        // Get some students
        const students = await dbAll('SELECT id, name, class FROM students LIMIT 20');
        const classes = await dbAll('SELECT id, name FROM classes LIMIT 3');
        const subjects = await dbAll('SELECT id, name FROM subjects LIMIT 5');
        
        if (students.length === 0) {
            console.log('❌ No students found. Please add students first.');
            return;
        }
        
        console.log(`Found ${students.length} students, ${classes.length} classes, ${subjects.length} subjects`);
        
        // Create sample exams
        const exams = [
            { name: 'Term 1 Mathematics Exam', exam_type: 'Endterm', term: 'Term 1', academic_year: '2024' },
            { name: 'Term 1 English Exam', exam_type: 'Endterm', term: 'Term 1', academic_year: '2024' },
            { name: 'Term 2 Mathematics Exam', exam_type: 'Endterm', term: 'Term 2', academic_year: '2024' },
            { name: 'Midterm Physics Test', exam_type: 'Midterm', term: 'Term 2', academic_year: '2024' },
            { name: 'Chemistry Quiz', exam_type: 'Quiz', term: 'Term 2', academic_year: '2024' }
        ];
        
        let examIds = [];
        
        for (const exam of exams) {
            const subject = subjects[Math.floor(Math.random() * subjects.length)];
            const cls = classes[Math.floor(Math.random() * classes.length)];
            
            const result = await dbRun(`
                INSERT INTO exams_new (name, exam_type, academic_year, term, subject_id, class_id, total_marks, pass_marks, exam_date)
                VALUES (?, ?, ?, ?, ?, ?, 100, 50, DATE('now', '-' || ABS(RANDOM() % 30) || ' days'))
            `, [exam.name, exam.exam_type, exam.academic_year, exam.term, subject.id, cls.id]);
            
            examIds.push(result.lastID);
            console.log(`✅ Created exam: ${exam.name}`);
        }
        
        // Create exam results
        let resultsCreated = 0;
        
        for (const student of students) {
            for (const examId of examIds) {
                const marks = Math.floor(Math.random() * 40) + 40; // 40-80 marks
                const grade = calculateGrade(marks);
                
                await dbRun(`
                    INSERT OR IGNORE INTO exam_results (exam_id, student_id, marks_obtained, grade)
                    VALUES (?, ?, ?, ?)
                `, [examId, student.id, marks, grade]);
                
                resultsCreated++;
            }
        }
        
        console.log(`\n✅ Created ${resultsCreated} exam results`);
        console.log('\n🎉 Test data created successfully!');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        db.close();
    }
}

// Helper functions
function dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function dbRun(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function calculateGrade(score) {
    if (score >= 80) return 'A';
    if (score >= 75) return 'A-';
    if (score >= 70) return 'B+';
    if (score >= 65) return 'B';
    if (score >= 60) return 'B-';
    if (score >= 55) return 'C+';
    if (score >= 50) return 'C';
    if (score >= 45) return 'C-';
    if (score >= 40) return 'D+';
    if (score >= 35) return 'D';
    if (score >= 30) return 'D-';
    return 'E';
}

createTestData();