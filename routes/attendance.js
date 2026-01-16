// routes/attendance.js - COMPLETE WORKING VERSION
const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();

console.log('✅ Attendance routes loaded!');

// Add JSON middleware for this router
router.use(express.json());

// Simple database helper
function queryDb(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database('./database.sqlite');
        db.all(sql, params, (err, rows) => {
            db.close();
            if (err) {
                console.error('Database error:', err.message);
                console.error('SQL:', sql);
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
}

// GET /attendance - Redirect
router.get('/', (req, res) => {
    res.redirect('/attendance/dashboard');
});

// GET /attendance/dashboard
router.get('/dashboard', async (req, res) => {
    try {
        console.log('User accessing attendance:', req.session.user);
        
        if (!req.session.user) {
            return res.redirect('/auth/login');
        }
        
        const today = new Date().toISOString().split('T')[0];
        const date = req.query.date || today;
        
        // Get students from database
        const students = await queryDb(`
            SELECT s.id, s.name, s.class, s.photo, s.guardian_name
            FROM students s
            WHERE s.status = 'Active' OR s.status IS NULL
            ORDER BY s.class, s.name
        `);
        
        // Try to get attendance
        let attendance = [];
        try {
            attendance = await queryDb(
                'SELECT student_id, status, notes FROM attendance WHERE date = ?',
                [date]
            );
        } catch (err) {
            console.log('No attendance records yet:', err.message);
        }
        
        // Combine data
        const studentsWithAttendance = students.map(student => {
            const attRecord = attendance.find(a => a.student_id === student.id);
            return {
                ...student,
                status: attRecord ? attRecord.status : 'absent',
                notes: attRecord ? attRecord.notes : ''
            };
        });
        
        // Stats
        const stats = {
            total: studentsWithAttendance.length,
            present: studentsWithAttendance.filter(s => s.status === 'present').length,
            absent: studentsWithAttendance.filter(s => s.status === 'absent').length,
            late: studentsWithAttendance.filter(s => s.status === 'late').length,
            excused: studentsWithAttendance.filter(s => s.status === 'excused').length
        };
        stats.presentPercentage = stats.total > 0 ? ((stats.present / stats.total) * 100).toFixed(1) : 0;
        
        res.render('attendance/dashboard', {
            user: req.session.user,
            students: studentsWithAttendance,
            date: date,
            stats: stats
        });
        
    } catch (error) {
        console.error('Attendance dashboard error:', error);
        res.status(500).send(`
            <h1>Error Loading Attendance</h1>
            <p>${error.message}</p>
            <a href="/dashboard">Back to Dashboard</a>
        `);
    }
});

// POST /attendance/mark - FIXED WITH PROPER JSON HANDLING
router.post('/mark', async (req, res) => {
    try {
        console.log('Received mark request:', req.body);
        
        // Check if body exists
        if (!req.body) {
            return res.json({ success: false, error: 'No data received' });
        }
        
        // Extract data with defaults
        const student_id = req.body.student_id;
        const date = req.body.date || new Date().toISOString().split('T')[0];
        const status = req.body.status || 'absent';
        const notes = req.body.notes || '';
        
        // Validate
        if (!student_id) {
            return res.json({ success: false, error: 'Student ID is required' });
        }
        
        const recorded_by = req.session.user?.id || 1;
        
        console.log('Processing:', { student_id, date, status, notes });
        
        // Check if record exists
        const existing = await queryDb(
            'SELECT id FROM attendance WHERE student_id = ? AND date = ?',
            [student_id, date]
        );
        
        if (existing && existing.length > 0) {
            // Update existing
            await queryDb(
                'UPDATE attendance SET status = ?, notes = ? WHERE id = ?',
                [status, notes, existing[0].id]
            );
            console.log('Updated existing record');
        } else {
            // Insert new
            await queryDb(
                'INSERT INTO attendance (student_id, date, status, notes, recorded_by) VALUES (?, ?, ?, ?, ?)',
                [student_id, date, status, notes, recorded_by]
            );
            console.log('Inserted new record');
        }
        
        res.json({ success: true, message: 'Attendance saved' });
        
    } catch (error) {
        console.error('Mark attendance error:', error);
        res.json({ success: false, error: error.message });
    }
});

// GET /attendance/student/:id - Student history
router.get('/student/:id', async (req, res) => {
    try {
        const studentId = req.params.id;
        
        const student = await queryDb('SELECT * FROM students WHERE id = ?', [studentId]);
        if (!student || student.length === 0) {
            return res.status(404).send('Student not found');
        }
        
        const attendance = await queryDb(
            'SELECT * FROM attendance WHERE student_id = ? ORDER BY date DESC LIMIT 30',
            [studentId]
        );
        
        res.render('attendance/student-history', {
            user: req.session.user,
            student: student[0],
            attendance: attendance
        });
    } catch (error) {
        console.error('Student history error:', error);
        res.status(500).send('Server error');
    }
});

// GET /attendance/reports - Reports page
router.get('/reports', async (req, res) => {
    try {
        const today = new Date();
        const month = req.query.month || (today.getMonth() + 1);
        const year = req.query.year || today.getFullYear();
        
        const report = await queryDb(`
            SELECT 
                s.name,
                s.class,
                COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present_days,
                COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent_days,
                COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_days
            FROM students s
            LEFT JOIN attendance a ON s.id = a.student_id 
                AND strftime('%m', a.date) = ? 
                AND strftime('%Y', a.date) = ?
            GROUP BY s.id
            ORDER BY s.class, s.name
        `, [
            month.toString().padStart(2, '0'),
            year.toString()
        ]);
        
        res.render('attendance/reports', {
            user: req.session.user,
            report: report,
            month: month,
            year: year
        });
    } catch (error) {
        console.error('Reports error:', error);
        res.status(500).send('Server error');
    }
});

module.exports = router;