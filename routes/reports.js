// routes/reports.js - PROFESSIONAL VERSION
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
// GET /reports/students - UPDATED WITH BETTER ERROR HANDLING
router.get('/students', requireAuth, async (req, res) => {
    try {
        const { class: className } = req.query;
        
        console.log('📊 DEBUG: Fetching students report...');
        console.log('Class filter:', className || 'all');
        
        // SIMPLER QUERY - Just get basic student info first
        let query = 'SELECT id, name, class, gender, date_of_birth, parent_name, parent_phone FROM students WHERE 1=1';
        
        const params = [];
        if (className && className !== 'all') {
            query += ' AND class = ?';
            params.push(className);
        }
        
        query += ' ORDER BY name';
        
        console.log('Executing query:', query);
        console.log('With params:', params);
        
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
        // GET /reports/performance - Main performance dashboard
router.get('/performance', requireAuth, async (req, res) => {
    try {
        const { class: className, term, exam } = req.query;
        
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
        
        // Get available exams/terms
        const exams = await dbAll('SELECT DISTINCT term FROM exams ORDER BY term');
        
        // Get performance summary
        const performanceSummary = [];
        
        for (const student of students) {
            // Get average performance for the student
            const avgQuery = `
                SELECT 
                    AVG(sp.marks_obtained) as avg_marks,
                    COUNT(sp.id) as exams_taken
                FROM student_performance sp
                JOIN exams e ON sp.exam_id = e.id
                WHERE sp.student_id = ?
                ${term && term !== 'all' ? 'AND e.term = ?' : ''}
            `;
            
            const avgParams = [student.id];
            if (term && term !== 'all') avgParams.push(term);
            
            const avgResult = await dbGet(avgQuery, avgParams);
            
            if (avgResult && avgResult.exams_taken > 0) {
                performanceSummary.push({
                    id: student.id,
                    name: student.name,
                    class: student.class,
                    avg_marks: Math.round(avgResult.avg_marks * 10) / 10,
                    exams_taken: avgResult.exams_taken,
                    grade: calculateGrade(avgResult.avg_marks)
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
        }
        // Add these routes to your existing routes/reports.js file

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
        
        // Get available exams/terms
        const exams = await dbAll('SELECT DISTINCT term FROM exams ORDER BY term');
        
        // Create performance summary with dummy data for now
        const performanceSummary = [];
        
        for (const student of students) {
            // For now, use dummy data - replace with real queries later
            performanceSummary.push({
                id: student.id,
                name: student.name,
                class: student.class,
                avg_marks: Math.floor(Math.random() * 50) + 50, // 50-100
                exams_taken: Math.floor(Math.random() * 5) + 1, // 1-5
                grade: 'B+' // Will calculate based on marks later
            });
        }
        
        // Get subject-wise averages (dummy data for now)
        const subjectPerformance = [
            { subject: 'Mathematics', code: 'MAT', avg_marks: 75, total_records: 10 },
            { subject: 'English', code: 'ENG', avg_marks: 82, total_records: 10 },
            { subject: 'Science', code: 'SCI', avg_marks: 68, total_records: 8 },
            { subject: 'Kiswahili', code: 'KIS', avg_marks: 79, total_records: 9 }
        ];
        
        res.render('reports/performance', {
            user: req.session.user,
            students: performanceSummary,
            subjectPerformance: subjectPerformance,
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

// Helper function to calculate grade based on marks
function calculateGrade(marks) {
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
    return 'E';
}
        
        // Get subject-wise averages
        const subjectPerformance = await dbAll(`
            SELECT 
                s.name as subject,
                s.code,
                AVG(sp.marks_obtained) as avg_marks,
                COUNT(sp.id) as total_records
            FROM subjects s
            LEFT JOIN student_performance sp ON s.id = sp.subject_id
            LEFT JOIN exams e ON sp.exam_id = e.id
            WHERE 1=1
            ${term && term !== 'all' ? 'AND e.term = ?' : ''}
            GROUP BY s.id, s.name, s.code
            ORDER BY s.name
        `, term && term !== 'all' ? [term] : []);
        
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
        const student = await dbGet('SELECT id, name, class FROM students WHERE id = ?', [studentId]);
        
        if (!student) {
            return res.status(404).render('error', {
                user: req.session.user,
                error: 'Student not found'
            });
        }
        
        // Get student's performance data
        const performanceQuery = `
            SELECT 
                e.name as exam_name,
                e.term,
                e.exam_date,
                s.name as subject,
                sp.marks_obtained,
                sp.grade,
                sp.remarks,
                gs.points,
                gs.description as grade_description
            FROM student_performance sp
            JOIN exams e ON sp.exam_id = e.id
            JOIN subjects s ON sp.subject_id = s.id
            LEFT JOIN grade_scale gs ON sp.marks_obtained BETWEEN gs.min_mark AND gs.max_mark
            WHERE sp.student_id = ?
            ${term && term !== 'all' ? 'AND e.term = ?' : ''}
            ORDER BY e.exam_date DESC, s.name
        `;
        
        const params = [studentId];
        if (term && term !== 'all') params.push(term);
        
        const performanceData = await dbAll(performanceQuery, params);
        
        // Calculate overall statistics
        const statsQuery = `
            SELECT 
                COUNT(DISTINCT e.id) as exams_taken,
                COUNT(DISTINCT s.id) as subjects_taken,
                AVG(sp.marks_obtained) as overall_average,
                MIN(sp.marks_obtained) as lowest_mark,
                MAX(sp.marks_obtained) as highest_mark,
                SUM(CASE WHEN gs.grade IN ('A', 'A-', 'B+') THEN 1 ELSE 0 END) as good_grades,
                SUM(CASE WHEN gs.grade IN ('D', 'E') THEN 1 ELSE 0 END) as poor_grades
            FROM student_performance sp
            JOIN exams e ON sp.exam_id = e.id
            JOIN subjects s ON sp.subject_id = s.id
            LEFT JOIN grade_scale gs ON sp.marks_obtained BETWEEN gs.min_mark AND gs.max_mark
            WHERE sp.student_id = ?
            ${term && term !== 'all' ? 'AND e.term = ?' : ''}
        `;
        
        const statistics = await dbGet(statsQuery, params) || {};
        
        // Get term-wise performance
        const termPerformance = await dbAll(`
            SELECT 
                e.term,
                AVG(sp.marks_obtained) as term_average,
                COUNT(sp.id) as records_count
            FROM student_performance sp
            JOIN exams e ON sp.exam_id = e.id
            WHERE sp.student_id = ?
            GROUP BY e.term
            ORDER BY 
                CASE e.term 
                    WHEN 'Term 1' THEN 1
                    WHEN 'Term 2' THEN 2
                    WHEN 'Term 3' THEN 3
                    WHEN 'Final' THEN 4
                    ELSE 5
                END
        `, [studentId]);
        
        // Get subject-wise averages
        const subjectAverages = await dbAll(`
            SELECT 
                s.name as subject,
                AVG(sp.marks_obtained) as avg_marks,
                COUNT(sp.id) as exams_count
            FROM student_performance sp
            JOIN subjects s ON sp.subject_id = s.id
            WHERE sp.student_id = ?
            GROUP BY s.id, s.name
            ORDER BY avg_marks DESC
        `, [studentId]);
        
        res.render('reports/student-performance', {
            user: req.session.user,
            student: student,
            performance: performanceData || [],
            statistics: statistics,
            termPerformance: termPerformance || [],
            subjectAverages: subjectAverages || [],
            filters: {
                term: term || 'all'
            }
        });
        
    } catch (error) {
        console.error('Individual performance error:', error);
        res.status(500).render('error', {
            user: req.session.user,
            error: 'Failed to load student performance'
        });
    }
});

// GET /reports/performance/subject/:subject - Subject performance analysis
router.get('/performance/subject/:subject', requireAuth, async (req, res) => {
    try {
        const subjectId = req.params.subject;
        const { class: className, term } = req.query;
        
        // Get subject details
        const subject = await dbGet('SELECT id, name, code FROM subjects WHERE id = ? OR name = ?', [subjectId, subjectId]);
        
        if (!subject) {
            return res.status(404).render('error', {
                user: req.session.user,
                error: 'Subject not found'
            });
        }
        
        // Get subject performance across students
        const performanceQuery = `
            SELECT 
                st.id as student_id,
                st.name as student_name,
                st.class,
                e.term,
                e.name as exam_name,
                sp.marks_obtained,
                sp.grade,
                gs.points,
                gs.description
            FROM student_performance sp
            JOIN students st ON sp.student_id = st.id
            JOIN exams e ON sp.exam_id = e.id
            LEFT JOIN grade_scale gs ON sp.marks_obtained BETWEEN gs.min_mark AND gs.max_mark
            WHERE sp.subject_id = ?
            ${className && className !== 'all' ? 'AND st.class = ?' : ''}
            ${term && term !== 'all' ? 'AND e.term = ?' : ''}
            ORDER BY st.class, st.name, e.exam_date
        `;
        
        const params = [subject.id];
        if (className && className !== 'all') params.push(className);
        if (term && term !== 'all') params.push(term);
        
        const performanceData = await dbAll(performanceQuery, params);
        
        // Calculate subject statistics
        const statsQuery = `
            SELECT 
                COUNT(DISTINCT sp.student_id) as total_students,
                AVG(sp.marks_obtained) as class_average,
                MIN(sp.marks_obtained) as lowest_mark,
                MAX(sp.marks_obtained) as highest_mark,
                COUNT(CASE WHEN gs.grade IN ('A', 'A-', 'B+') THEN 1 END) as top_performers,
                COUNT(CASE WHEN gs.grade IN ('D', 'E') THEN 1 END) as struggling_students
            FROM student_performance sp
            JOIN students st ON sp.student_id = st.id
            LEFT JOIN grade_scale gs ON sp.marks_obtained BETWEEN gs.min_mark AND gs.max_mark
            WHERE sp.subject_id = ?
            ${className && className !== 'all' ? 'AND st.class = ?' : ''}
            ${term && term !== 'all' ? 'AND EXISTS (SELECT 1 FROM exams e WHERE e.id = sp.exam_id AND e.term = ?)' : ''}
        `;
        
        const statistics = await dbGet(statsQuery, params) || {};
        
        // Get class-wise averages
        const classAverages = await dbAll(`
            SELECT 
                st.class,
                AVG(sp.marks_obtained) as class_avg,
                COUNT(DISTINCT sp.student_id) as students_count
            FROM student_performance sp
            JOIN students st ON sp.student_id = st.id
            WHERE sp.subject_id = ?
            GROUP BY st.class
            ORDER BY class_avg DESC
        `, [subject.id]);
        
        res.render('reports/subject-performance', {
            user: req.session.user,
            subject: subject,
            performance: performanceData || [],
            statistics: statistics,
            classAverages: classAverages || [],
            filters: {
                class: className || 'all',
                term: term || 'all'
            }
        });
        
    } catch (error) {
        console.error('Subject performance error:', error);
        res.status(500).render('error', {
            user: req.session.user,
            error: 'Failed to load subject performance'
        });
    }
});

// Helper function to calculate grade based on marks
function calculateGrade(marks) {
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
    return 'E';
}
        // Get unique classes for filter
        const classes = await dbAll("SELECT DISTINCT class FROM students WHERE class IS NOT NULL AND class != '' ORDER BY class") || [];
        console.log('Available classes:', classes);
        
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
        console.error('Error stack:', error.stack);
        
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

module.exports = router;