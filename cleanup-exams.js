// cleanup-exams.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

async function cleanupExams() {
    try {
        console.log('🧹 Cleaning up invalid exams...\n');
        
        // Delete exams with invalid data
        const result = await dbRun(`
            DELETE FROM exams_new 
            WHERE 
                total_marks <= 1 OR 
                pass_marks >= total_marks OR
                name LIKE '%TECHNOLOGIES%' OR
                academic_year = '2024' AND exam_date > '2024-12-31'
        `);
        
        console.log(`✅ Deleted ${result.changes} invalid exam(s)`);
        
        // Show remaining exams
        const remaining = await dbAll(`
            SELECT name, exam_type, academic_year, term, total_marks, pass_marks 
            FROM exams_new 
            ORDER BY exam_date DESC
        `);
        
        console.log('\n📋 Remaining Exams:');
        console.log('='.repeat(50));
        remaining.forEach(exam => {
            console.log(`${exam.name}`);
            console.log(`  Type: ${exam.exam_type}, Year: ${exam.academic_year}, Term: ${exam.term}`);
            console.log(`  Marks: ${exam.total_marks} total, ${exam.pass_marks} to pass`);
            console.log('-'.repeat(30));
        });
        
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        db.close();
    }
}

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

cleanupExams();