// verify-exam-tables.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

console.log('✅ Verifying exam tables creation...\n');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const tablesToCheck = ['subjects', 'classes', 'exams_new', 'exam_results', 'grade_system'];

tablesToCheck.forEach((table, index) => {
    db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table], (err, row) => {
        if (err) {
            console.error(`Error checking ${table}:`, err.message);
        } else {
            if (row) {
                console.log(`✅ ${table} table exists`);
                
                // Show column count
                db.all(`PRAGMA table_info(${table})`, (err, columns) => {
                    if (!err) {
                        console.log(`   Columns: ${columns.length}`);
                    }
                });
                
                // Show row count for data tables
                if (table === 'subjects' || table === 'classes' || table === 'grade_system') {
                    db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
                        if (!err) {
                            console.log(`   Records: ${row.count}`);
                        }
                    });
                }
            } else {
                console.log(`❌ ${table} table missing`);
            }
        }
        
        // Check if this is the last table
        if (index === tablesToCheck.length - 1) {
            setTimeout(() => {
                console.log('\n' + '='.repeat(40));
                console.log('✅ Verification complete!');
                console.log('\nNext step: We will create the exam performance routes.');
                db.close();
            }, 1000);
        }
    });
});