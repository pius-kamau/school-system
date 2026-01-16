// Update your attendance table in init_db.js or create update_attendance.js
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Database error:', err);
        return;
    }
    
    console.log('🎯 Enhancing Attendance System...\n');
    
    // Create comprehensive attendance table
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        date DATE NOT NULL,
        status TEXT NOT NULL, -- Present, Absent, Late, Excused, Holiday
        check_in_time TIME,
        check_out_time TIME,
        remarks TEXT,
        recorded_by INTEGER, -- teacher/admin id
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY(recorded_by) REFERENCES users(id),
        UNIQUE(student_id, date) -- One attendance per student per day
    )`, (err) => {
        if (err) {
            console.log('Attendance table already exists or error:', err.message);
        } else {
            console.log('✅ Created attendance table');
        }
        
        // Create attendance summary view
        db.run(`CREATE VIEW IF NOT EXISTS attendance_summary AS
            SELECT 
                s.id as student_id,
                s.name as student_name,
                s.class,
                COUNT(CASE WHEN a.status = 'Present' THEN 1 END) as present_days,
                COUNT(CASE WHEN a.status = 'Absent' THEN 1 END) as absent_days,
                COUNT(CASE WHEN a.status = 'Late' THEN 1 END) as late_days,
                COUNT(CASE WHEN a.status = 'Excused' THEN 1 END) as excused_days,
                COUNT(*) as total_days
            FROM students s
            LEFT JOIN attendance a ON s.id = a.student_id
            GROUP BY s.id, s.name, s.class`, (err) => {
            if (err) {
                console.log('Attendance summary view:', err.message);
            } else {
                console.log('✅ Created attendance summary view');
            }
            
            db.close();
            console.log('\n🎉 Attendance database ready!');
        });
    });
});