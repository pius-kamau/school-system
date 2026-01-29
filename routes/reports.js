// routes/reports.js - FIXED VERSION
const express = require('express');
const router = express.Router();

console.log('Reports routes loaded!');

// Use your existing database connection
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

// Helper functions for database
const dbGet = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const dbAll = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    next();
};

// Helper function to calculate grade based on marks
function calculateGrade(marks) {
    if (!marks) return 'N/A';
    if (marks >= 80) return 'A';
    if (marks >= 75) return 'A-';
    if (marks >= 70) return 'B+';
    if (marks >= 65) return 'B';
    if (marks >= 60) return 'B-';
    if (marks >= 55) return 'C+';
    if (marks >= 50) return 'C';
    if (marks >= 45) return 'C-';
    if (marks >= 40) return 'D+';
    if (marks >= 35) return 'D';
    if (marks >= 30) return 'D-';
    return 'E';
}

// Main Reports Dashboard
router.get('/', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        
        // Get system statistics
        const [totalStudents, totalTeachers, totalFees] = await Promise.all([
            dbGet('SELECT COUNT(*) as count FROM students'),
            dbGet('SELECT COUNT(*) as count FROM teachers'),
            dbGet('SELECT COALESCE(SUM(amount_paid), 0) as total FROM fees')
        ]);
        
        res.render('reports/dashboard', {
            user: user,
            stats: {
                totalStudents: totalStudents?.count || 0,
                totalTeachers: totalTeachers?.count || 0,
                totalFees: totalFees?.total || 0
            },
            activeTab: 'overview'
        });
        
    } catch (error) {
        console.error('Reports dashboard error:', error);
        res.render('reports/dashboard', {
            user: req.session.user,
            stats: { totalStudents: 0, totalTeachers: 0, totalFees: 0 },
            activeTab: 'overview'
        });
    }
});

// Attendance Reports
router.get('/attendance', requireAuth, async (req, res) => {
    try {
        const { start_date, end_date, class: className } = req.query;
        const today = new Date().toISOString().split('T')[0];
        
        // Default to current month if no dates provided
        const defaultStart = new Date();
        defaultStart.setDate(1);
        const defaultStartDate = defaultStart.toISOString().split('T')[0];
        
        const queryStart = start_date || defaultStartDate;
        const queryEnd = end_date || today;
        
        let query = `
            SELECT a.date, s.name, s.class, a.status, a.notes
            FROM attendance a
            JOIN students s ON a.student_id = s.id
            WHERE a.date BETWEEN ? AND ?
        `;
        
        const params = [queryStart, queryEnd];
        
        if (className && className !== 'all') {
            query += ' AND s.class = ?';
            params.push(className);
        }
        
        query += ' ORDER BY a.date DESC, s.name LIMIT 100';
        
        const attendanceData = await dbAll(query, params);
        
        // Get summary statistics
        let summaryQuery = `
            SELECT 
                a.status,
                COUNT(*) as count
            FROM attendance a
            JOIN students s ON a.student_id = s.id
            WHERE a.date BETWEEN ? AND ?
        `;
        
        const summaryParams = [queryStart, queryEnd];
        if (className && className !== 'all') {
            summaryQuery += ' AND s.class = ?';
            summaryParams.push(className);
        }
        
        summaryQuery += ' GROUP BY a.status';
        
        const summaryRows = await dbAll(summaryQuery, summaryParams);
        
        // Calculate percentages
        const total = summaryRows.reduce((sum, row) => sum + row.count, 0);
        const summary = summaryRows.map(row => ({
            ...row,
            percentage: total > 0 ? Math.round((row.count / total) * 100) : 0
        }));
        
        // Get unique classes
        const classes = await dbAll('SELECT DISTINCT class FROM students WHERE class IS NOT NULL ORDER BY class');
        
        res.render('reports/attendance', {
            user: req.session.user,
            data: attendanceData,
            summary: summary,
            filters: {
                start_date: start_date || queryStart,
                end_date: end_date || queryEnd,
                class: className || 'all'
            },
            classes: classes,
            activeTab: 'attendance'
        });
        
    } catch (error) {
        console.error('Attendance report error:', error);
        res.render('reports/attendance', {
            user: req.session.user,
            data: [],
            summary: [],
            filters: {},
            classes: [],
            activeTab: 'attendance'
        });
    }
});

// Fee Collection Reports
router.get('/fees', requireAuth, async (req, res) => {
    try {
        const { start_date, end_date, status } = req.query;
        const today = new Date().toISOString().split('T')[0];
        
        // Default to current month
        const defaultStart = new Date();
        defaultStart.setDate(1);
        const defaultStartDate = defaultStart.toISOString().split('T')[0];
        
        const queryStart = start_date || defaultStartDate;
        const queryEnd = end_date || today;
        
        let query = `
            SELECT 
                f.receipt_number,
                f.payment_date,
                s.name as student_name,
                s.class,
                f.amount_paid,
                f.balance,
                f.payment_method,
                f.notes,
                CASE 
                    WHEN f.balance <= 0 THEN 'PAID'
                    ELSE 'PENDING'
                END as payment_status
            FROM fees f
            JOIN students s ON f.student_id = s.id
            WHERE f.payment_date BETWEEN ? AND ?
        `;
        
        const params = [queryStart, queryEnd];
        
        if (status && status !== 'all') {
            if (status === 'paid') {
                query += ' AND f.balance <= 0';
            } else if (status === 'pending') {
                query += ' AND f.balance > 0';
            }
        }
        
        query += ' ORDER BY f.payment_date DESC LIMIT 100';
        
        const feesData = await dbAll(query, params);
        
        // Get summary
        const summary = await dbGet(`
            SELECT 
                COALESCE(SUM(amount_paid), 0) as total_paid,
                COALESCE(SUM(balance), 0) as total_balance,
                COUNT(*) as total_transactions,
                COUNT(DISTINCT student_id) as total_students
            FROM fees
            WHERE payment_date BETWEEN ? AND ?
        `, [queryStart, queryEnd]);
        
        // Get monthly trends
        const monthlyTrends = await dbAll(`
            SELECT 
                strftime('%Y-%m', payment_date) as month,
                COUNT(*) as transactions,
                SUM(amount_paid) as collected
            FROM fees
            WHERE payment_date IS NOT NULL
            GROUP BY strftime('%Y-%m', payment_date)
            ORDER BY month DESC
            LIMIT 6
        `);
        
        res.render('reports/fees', {
            user: req.session.user,
            data: feesData,
            summary: summary || {},
            monthlyTrends: monthlyTrends || [],
            filters: {
                start_date: start_date || queryStart,
                end_date: end_date || queryEnd,
                status: status || 'all'
            },
            activeTab: 'fees'
        });
        
    } catch (error) {
        console.error('Fees report error:', error);
        res.render('reports/fees', {
            user: req.session.user,
            data: [],
            summary: {},
            monthlyTrends: [],
            filters: {},
            activeTab: 'fees'
        });
    }
});

// Student Reports
router.get('/students', requireAuth, async (req, res) => {
    try {
        const { class: className } = req.query;
        
        console.log('📊 Fetching students report...');
        
        // SIMPLER QUERY - Just get basic student info first
        let query = 'SELECT id, name, class, gender, date_of_birth, parent_name, parent_phone FROM students WHERE 1=1';
        
        const params = [];
        if (className && className !== 'all') {
            query += ' AND class = ?';
            params.push(className);
        }
        
        query += ' ORDER BY name';
        
        const studentsData = await dbAll(query, params);
        console.log('Found students:', studentsData?.length || 0);
        
        if (studentsData && studentsData.length > 0) {
            console.log('Sample student:', studentsData[0]);
            
            // Try to get attendance data for each student
            for (let student of studentsData) {
                try {
                    // Get attendance counts
                    const attendance = await dbGet(`
                        SELECT 
                            COUNT(CASE WHEN status = 'present' THEN 1 END) as present,
                            COUNT(CASE WHEN status = 'absent' THEN 1 END) as absent
                        FROM attendance 
                        WHERE student_id = ?
                    `, [student.id]);
                    
                    student.days_present = attendance?.present || 0;
                    student.days_absent = attendance?.absent || 0;
                    
                    // Get fee totals
                    const fees = await dbGet(`
                        SELECT 
                            COALESCE(SUM(amount_paid), 0) as paid,
                            COALESCE(SUM(balance), 0) as balance
                        FROM fees 
                        WHERE student_id = ?
                    `, [student.id]);
                    
                    student.total_paid = fees?.paid || 0;
                    student.total_balance = fees?.balance || 0;
                    
                    // Calculate attendance rate
                    const totalDays = student.days_present + student.days_absent;
                    student.attendance_rate = totalDays > 0 ? Math.round((student.days_present / totalDays) * 100) : 0;
                    
                } catch (err) {
                    console.log(`Error getting data for student ${student.id}:`, err.message);
                    // Set defaults if there's an error
                    student.days_present = 0;
                    student.days_absent = 0;
                    student.total_paid = 0;
                    student.total_balance = 0;
                    student.attendance_rate = 0;
                }
            }
        }
        
        // Get unique classes for filter
        const classes = await dbAll("SELECT DISTINCT class FROM students WHERE class IS NOT NULL AND class != '' ORDER BY class") || [];
        
        // Get class summary
        const classSummary = [];
        if (classes.length > 0) {
            for (const cls of classes) {
                const classStudents = studentsData.filter(s => s.class === cls.class);
                if (classStudents.length > 0) {
                    const totalAttendance = classStudents.reduce((sum, s) => sum + (s.attendance_rate || 0), 0);
                    const avgAttendance = Math.round(totalAttendance / classStudents.length);
                    
                    classSummary.push({
                        class: cls.class,
                        student_count: classStudents.length,
                        avg_attendance: avgAttendance || 0
                    });
                }
            }
        }
        
        console.log('Rendering template with', studentsData?.length || 0, 'students');
        
        res.render('reports/students', {
            user: req.session.user,
            data: studentsData || [],
            classSummary: classSummary || [],
            classes: classes || [],
            filters: {
                class: className || 'all'
            },
            activeTab: 'students'
        });
        
    } catch (error) {
        console.error('❌ Student report error:', error);
        
        // Send empty data but render the page
        res.render('reports/students', {
            user: req.session.user,
            data: [],
            classSummary: [],
            classes: [],
            filters: {},
            activeTab: 'students'
        });
    }
});

// ==================== PERFORMANCE REPORTS ====================

// GET /reports/performance - Main performance dashboard
router.get('/performance', requireAuth, async (req, res) => {
    try {
        const { class: className, term } = req.query;
        
        // Get all students with optional class filter
        let studentQuery = 'SELECT id, name, class FROM students WHERE 1=1';
        const studentParams = [];
        
        if (className && className !== 'all') {
            studentQuery += ' AND class = ?';
            studentParams.push(className);
        }
        
        studentQuery += ' ORDER BY name';
        
        const students = await dbAll(studentQuery, studentParams);
        
        // Get available classes
        const classes = await dbAll('SELECT DISTINCT class FROM students WHERE class IS NOT NULL AND class != "" ORDER BY class');
        
        // Get available exams/terms from exams_new table
        const exams = await dbAll('SELECT DISTINCT term FROM exams_new WHERE term IS NOT NULL ORDER BY term');
        
        // Create performance summary
        const performanceSummary = [];
        
        for (const student of students) {
            try {
                // Get exam results for the student from exam_results table
                const avgQuery = `
                    SELECT 
                        AVG(er.marks_obtained) as avg_marks,
                        COUNT(er.id) as exams_taken
                    FROM exam_results er
                    JOIN exams_new e ON er.exam_id = e.id
                    WHERE er.student_id = ?
                    ${term && term !== 'all' ? 'AND e.term = ?' : ''}
                `;
                
                const avgParams = [student.id];
                if (term && term !== 'all') avgParams.push(term);
                
                const avgResult = await dbGet(avgQuery, avgParams);
                
                if (avgResult && avgResult.exams_taken > 0) {
                    const avgMarks = avgResult.avg_marks || 0;
                    performanceSummary.push({
                        id: student.id,
                        name: student.name,
                        class: student.class,
                        avg_marks: Math.round(avgMarks * 10) / 10,
                        exams_taken: avgResult.exams_taken,
                        grade: calculateGrade(avgMarks)
                    });
                } else {
                    performanceSummary.push({
                        id: student.id,
                        name: student.name,
                        class: student.class,
                        avg_marks: 0,
                        exams_taken: 0,
                        grade: 'N/A'
                    });
                }
            } catch (err) {
                console.log(`Error processing student ${student.id}:`, err.message);
                performanceSummary.push({
                    id: student.id,
                    name: student.name,
                    class: student.class,
                    avg_marks: 0,
                    exams_taken: 0,
                    grade: 'N/A'
                });
            }
        }
        
        // Get subject-wise averages
        let subjectQuery = `
            SELECT 
                s.name as subject,
                s.code,
                AVG(er.marks_obtained) as avg_marks,
                COUNT(er.id) as total_records
            FROM subjects s
            LEFT JOIN exams_new e ON s.id = e.subject_id
            LEFT JOIN exam_results er ON e.id = er.exam_id
            WHERE 1=1
        `;
        
        const subjectParams = [];
        if (term && term !== 'all') {
            subjectQuery += ' AND e.term = ?';
            subjectParams.push(term);
        }
        
        subjectQuery += ' GROUP BY s.id, s.name, s.code HAVING total_records > 0 ORDER BY avg_marks DESC';
        
        const subjectPerformance = await dbAll(subjectQuery, subjectParams);
        
        res.render('reports/performance', {
            user: req.session.user,
            students: performanceSummary,
            subjectPerformance: subjectPerformance || [],
            classes: classes || [],
            exams: exams || [],
            filters: {
                class: className || 'all',
                term: term || 'all'
            },
            activeTab: 'performance'
        });
        
    } catch (error) {
        console.error('Performance report error:', error);
        res.render('reports/performance', {
            user: req.session.user,
            students: [],
            subjectPerformance: [],
            classes: [],
            exams: [],
            filters: {},
            activeTab: 'performance'
        });
    }
});

// GET /reports/performance/student/:id - Individual student performance
router.get('/performance/student/:id', requireAuth, async (req, res) => {
    try {
        const studentId = req.params.id;
        const { term } = req.query;
        
        // Get student details
        const student = await dbGet('SELECT id, name, class, admission_number FROM students WHERE id = ?', [studentId]);
        
        if (!student) {
            return res.status(404).send('Student not found');
        }
        
        // Get student's performance data from exam_results table
        const performanceQuery = `
            SELECT 
                e.name as exam_name,
                e.term,
                e.exam_date,
                s.name as subject_name,
                er.marks_obtained,
                er.grade,
                er.remarks,
                e.total_marks,
                e.pass_marks
            FROM exam_results er
            JOIN exams_new e ON er.exam_id = e.id
            LEFT JOIN subjects s ON e.subject_id = s.id
            WHERE er.student_id = ?
            ${term && term !== 'all' ? 'AND e.term = ?' : ''}
            ORDER BY e.exam_date DESC
        `;
        
        const params = [studentId];
        if (term && term !== 'all') params.push(term);
        
        const performanceData = await dbAll(performanceQuery, params);
        
        // Calculate overall statistics
        const stats = {
            total_exams: performanceData.length,
            average_score: 0,
            highest_score: 0,
            lowest_score: 0
        };
        
        if (performanceData.length > 0) {
            const marks = performanceData.map(r => r.marks_obtained || 0);
            stats.average_score = Math.round((marks.reduce((sum, mark) => sum + mark, 0) / marks.length) * 10) / 10;
            stats.highest_score = Math.max(...marks);
            stats.lowest_score = Math.min(...marks);
        }
        
        // Get subject-wise averages
        const subjectAveragesQuery = `
            SELECT 
                s.name as subject,
                AVG(er.marks_obtained) as avg_marks,
                COUNT(er.id) as exams_count,
                MAX(er.marks_obtained) as highest_mark,
                MIN(er.marks_obtained) as lowest_mark
            FROM exam_results er
            JOIN exams_new e ON er.exam_id = e.id
            JOIN subjects s ON e.subject_id = s.id
            WHERE er.student_id = ?
            GROUP BY s.id, s.name
            ORDER BY avg_marks DESC
        `;
        
        const subjectAverages = await dbAll(subjectAveragesQuery, [studentId]);
        
        res.render('reports/student-performance', {
            user: req.session.user,
            student: student,
            performance: performanceData || [],
            stats: stats,
            subjectAverages: subjectAverages || [],
            filters: {
                term: term || 'all'
            }
        });
        
    } catch (error) {
        console.error('Individual performance error:', error);
        res.status(500).send('Failed to load student performance');
    }
});

module.exports = router;