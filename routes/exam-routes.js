// routes/exam-routes.js
const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

console.log('📚 Exam routes loaded!');

// Database connection
const dbPath = path.join(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath);

// Helper functions
function dbGet(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
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

// ==================== EXAM ROUTES ====================

// GET /exams - Exam dashboard
router.get('/', async (req, res) => {
    try {
        // Get exam statistics
        const totalExams = await dbGet('SELECT COUNT(*) as count FROM exams_new');
        const totalResults = await dbGet('SELECT COUNT(*) as count FROM exam_results');
        const totalStudents = await dbGet('SELECT COUNT(*) as count FROM students');
        
        // Get recent exams
        const recentExams = await dbAll(`
            SELECT e.*, s.name as subject_name, c.name as class_name
            FROM exams_new e
            LEFT JOIN subjects s ON e.subject_id = s.id
            LEFT JOIN classes c ON e.class_id = c.id
            ORDER BY e.exam_date DESC
            LIMIT 5
        `);
        
        // Get top performing students
        const topStudents = await dbAll(`
            SELECT s.name, s.class, 
                   AVG(er.marks_obtained) as average_score,
                   COUNT(er.id) as exams_taken
            FROM exam_results er
            JOIN students s ON er.student_id = s.id
            GROUP BY s.id, s.name, s.class
            HAVING exams_taken >= 1
            ORDER BY average_score DESC
            LIMIT 5
        `);
        
        res.render('exams/dashboard', {
            title: 'Exam Management',
            user: req.session.user,
            stats: {
                total_exams: totalExams.count || 0,
                total_results: totalResults.count || 0,
                total_students: totalStudents.count || 0
            },
            recentExams: recentExams || [],
            topStudents: topStudents || []
        });
        
    } catch (error) {
        console.error('Exam dashboard error:', error);
        res.status(500).send('Error loading exam dashboard');
    }
});

// GET /exams/performance - Student performance analysis
router.get('/performance', async (req, res) => {
    try {
        const { class_id, subject_id, term, academic_year } = req.query;
        
        // Build WHERE clause
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (class_id && class_id !== 'all') {
            whereClause += ' AND s.class = ?';
            params.push(class_id);
        }
        
        if (subject_id && subject_id !== 'all') {
            whereClause += ' AND e.subject_id = ?';
            params.push(subject_id);
        }
        
        if (term && term !== 'all') {
            whereClause += ' AND e.term = ?';
            params.push(term);
        }
        
        if (academic_year && academic_year !== 'all') {
            whereClause += ' AND e.academic_year = ?';
            params.push(academic_year);
        }
        
        // Get student performance data
        const performanceData = await dbAll(`
            SELECT 
                s.id,
                s.name,
                s.class,
                s.admission_number,
                COUNT(DISTINCT e.id) as exams_count,
                AVG(er.marks_obtained) as average_score,
                MAX(er.marks_obtained) as highest_score,
                MIN(er.marks_obtained) as lowest_score,
                GROUP_CONCAT(DISTINCT er.grade) as grades,
                COUNT(DISTINCT CASE WHEN er.grade IN ('A', 'A-', 'B+', 'B') THEN er.id END) as good_grades_count
            FROM students s
            LEFT JOIN exam_results er ON s.id = er.student_id
            LEFT JOIN exams_new e ON er.exam_id = e.id
            ${whereClause}
            GROUP BY s.id, s.name, s.class, s.admission_number
            ORDER BY average_score DESC
        `, params);
        
        // Calculate grades
        performanceData.forEach(student => {
            if (student.average_score) {
                // Get grade based on average score
                student.final_grade = calculateGrade(student.average_score);
                student.performance = getPerformanceLevel(student.average_score);
            }
        });
        
        // Get filter options
        const classes = await dbAll('SELECT DISTINCT name FROM classes ORDER BY name');
        const subjects = await dbAll('SELECT id, name FROM subjects WHERE is_active = 1 ORDER BY name');
        const terms = await dbAll('SELECT DISTINCT term FROM exams_new WHERE term IS NOT NULL ORDER BY term');
        const academicYears = await dbAll('SELECT DISTINCT academic_year FROM exams_new WHERE academic_year IS NOT NULL ORDER BY academic_year DESC');
        
        // Get performance summary
        const summary = {
            total_students: performanceData.length,
            students_with_results: performanceData.filter(s => s.exams_count > 0).length,
            average_class_score: performanceData.filter(s => s.average_score).length > 0 ? 
                performanceData.reduce((sum, s) => sum + (s.average_score || 0), 0) / 
                performanceData.filter(s => s.average_score).length : 0,
            top_performer: performanceData.length > 0 ? performanceData[0] : null
        };
        
        res.render('exams/performance', {
            title: 'Student Exam Performance',
            user: req.session.user,
            performanceData: performanceData,
            summary: summary,
            filters: {
                classes: classes,
                subjects: subjects,
                terms: terms,
                academicYears: academicYears,
                selected: {
                    class_id: class_id || 'all',
                    subject_id: subject_id || 'all',
                    term: term || 'all',
                    academic_year: academic_year || 'all'
                }
            }
        });
        
    } catch (error) {
        console.error('Performance analysis error:', error);
        res.status(500).send('Error loading performance data');
    }
});

// GET /exams/class-performance - Class-wise analysis
router.get('/class-performance', async (req, res) => {
    try {
        const classPerformance = await dbAll(`
            SELECT 
                s.class,
                COUNT(DISTINCT s.id) as student_count,
                COUNT(DISTINCT er.id) as total_results,
                AVG(er.marks_obtained) as average_score,
                COUNT(DISTINCT CASE WHEN er.grade IN ('A', 'A-', 'B+', 'B') THEN er.student_id END) as good_students,
                COUNT(DISTINCT CASE WHEN er.grade IN ('D+', 'D', 'D-', 'E') THEN er.student_id END) as weak_students
            FROM students s
            LEFT JOIN exam_results er ON s.id = er.student_id
            WHERE s.class IS NOT NULL AND s.class != ''
            GROUP BY s.class
            ORDER BY average_score DESC
        `);
        
        // Calculate percentages
        classPerformance.forEach(cls => {
            cls.good_percentage = cls.student_count > 0 ? 
                Math.round((cls.good_students / cls.student_count) * 100) : 0;
            cls.weak_percentage = cls.student_count > 0 ? 
                Math.round((cls.weak_students / cls.student_count) * 100) : 0;
            cls.pass_percentage = 100 - cls.weak_percentage;
        });
        
        res.render('exams/class-performance', {
            title: 'Class Performance Analysis',
            user: req.session.user,
            classPerformance: classPerformance
        });
        
    } catch (error) {
        console.error('Class performance error:', error);
        res.status(500).send('Error loading class performance data');
    }
});

// GET /exams/subject-analysis - Subject-wise analysis
router.get('/subject-analysis', async (req, res) => {
    try {
        const subjectAnalysis = await dbAll(`
            SELECT 
                sub.name as subject,
                sub.code,
                COUNT(DISTINCT e.id) as exams_count,
                COUNT(DISTINCT er.id) as results_count,
                AVG(er.marks_obtained) as average_score,
                MIN(er.marks_obtained) as lowest_score,
                MAX(er.marks_obtained) as highest_score,
                COUNT(DISTINCT CASE WHEN er.grade IN ('A', 'A-') THEN er.student_id END) as excellent_students,
                COUNT(DISTINCT CASE WHEN er.grade IN ('D+', 'D', 'D-', 'E') THEN er.student_id END) as failing_students
            FROM subjects sub
            LEFT JOIN exams_new e ON sub.id = e.subject_id
            LEFT JOIN exam_results er ON e.id = er.exam_id
            WHERE sub.is_active = 1
            GROUP BY sub.id, sub.name, sub.code
            ORDER BY average_score DESC
        `);
        
        res.render('exams/subject-analysis', {
            title: 'Subject Performance Analysis',
            user: req.session.user,
            subjectAnalysis: subjectAnalysis
        });
        
    } catch (error) {
        console.error('Subject analysis error:', error);
        res.status(500).send('Error loading subject analysis');
    }
});

// GET /exams/student/:id - Individual student performance
router.get('/student/:id', async (req, res) => {
    try {
        const studentId = req.params.id;
        
        // Get student details
        const student = await dbGet(`
            SELECT * FROM students WHERE id = ?
        `, [studentId]);
        
        if (!student) {
            return res.status(404).send('Student not found');
        }
        
        // Get student's exam results
        const examResults = await dbAll(`
            SELECT 
                er.*,
                e.name as exam_name,
                e.exam_type,
                e.term,
                e.academic_year,
                e.exam_date,
                e.total_marks,
                sub.name as subject_name,
                c.name as class_name
            FROM exam_results er
            JOIN exams_new e ON er.exam_id = e.id
            LEFT JOIN subjects sub ON e.subject_id = sub.id
            LEFT JOIN classes c ON e.class_id = c.id
            WHERE er.student_id = ?
            ORDER BY e.exam_date DESC
        `, [studentId]);
        
        // Calculate student statistics
        const stats = {
            total_exams: examResults.length,
            average_score: examResults.length > 0 ? 
                examResults.reduce((sum, r) => sum + (r.marks_obtained || 0), 0) / examResults.length : 0,
            highest_score: examResults.length > 0 ? 
                Math.max(...examResults.map(r => r.marks_obtained || 0)) : 0,
            lowest_score: examResults.length > 0 ? 
                Math.min(...examResults.map(r => r.marks_obtained || 0)) : 0,
            grade_distribution: {}
        };
        
        // Count grades
        examResults.forEach(result => {
            if (result.grade) {
                stats.grade_distribution[result.grade] = (stats.grade_distribution[result.grade] || 0) + 1;
            }
        });
        
        // Get subject-wise performance
        const subjectPerformance = await dbAll(`
            SELECT 
                sub.name as subject,
                AVG(er.marks_obtained) as average_score,
                COUNT(er.id) as exams_count,
                MAX(er.marks_obtained) as highest_score,
                MIN(er.marks_obtained) as lowest_score
            FROM exam_results er
            JOIN exams_new e ON er.exam_id = e.id
            JOIN subjects sub ON e.subject_id = sub.id
            WHERE er.student_id = ?
            GROUP BY sub.id, sub.name
            ORDER BY average_score DESC
        `, [studentId]);
        
        // Get performance trend (by term)
        const performanceTrend = await dbAll(`
            SELECT 
                e.term,
                e.academic_year,
                AVG(er.marks_obtained) as term_average,
                COUNT(er.id) as exams_count
            FROM exam_results er
            JOIN exams_new e ON er.exam_id = e.id
            WHERE er.student_id = ?
            GROUP BY e.term, e.academic_year
            ORDER BY e.academic_year, 
                     CASE e.term 
                         WHEN 'Term 1' THEN 1
                         WHEN 'Term 2' THEN 2
                         WHEN 'Term 3' THEN 3
                         ELSE 4
                     END
        `, [studentId]);
        
        res.render('exams/student-performance', {
            title: `Student Performance - ${student.name}`,
            user: req.session.user,
            student: student,
            examResults: examResults,
            stats: stats,
            subjectPerformance: subjectPerformance,
            performanceTrend: performanceTrend
        });
        
    } catch (error) {
        console.error('Student performance error:', error);
        res.status(500).send('Error loading student performance data');
    }
});

// GET /exams/export-performance - Export performance data
router.get('/export-performance', async (req, res) => {
    try {
        const { format = 'csv', type = 'all' } = req.query;
        
        let query = '';
        let filename = '';
        
        switch (type) {
            case 'students':
                query = `
                    SELECT 
                        s.admission_number,
                        s.name,
                        s.class,
                        COUNT(DISTINCT er.id) as exams_taken,
                        AVG(er.marks_obtained) as average_score,
                        MAX(er.marks_obtained) as highest_score,
                        MIN(er.marks_obtained) as lowest_score
                    FROM students s
                    LEFT JOIN exam_results er ON s.id = er.student_id
                    GROUP BY s.id, s.admission_number, s.name, s.class
                    ORDER BY average_score DESC
                `;
                filename = 'student-performance';
                break;
                
            case 'class':
                query = `
                    SELECT 
                        s.class,
                        COUNT(DISTINCT s.id) as student_count,
                        AVG(er.marks_obtained) as class_average,
                        COUNT(DISTINCT er.id) as total_results
                    FROM students s
                    LEFT JOIN exam_results er ON s.id = er.student_id
                    WHERE s.class IS NOT NULL
                    GROUP BY s.class
                    ORDER BY class_average DESC
                `;
                filename = 'class-performance';
                break;
                
            case 'subject':
                query = `
                    SELECT 
                        sub.name as subject,
                        sub.code,
                        AVG(er.marks_obtained) as subject_average,
                        COUNT(DISTINCT er.id) as total_results,
                        COUNT(DISTINCT er.student_id) as students_tested
                    FROM subjects sub
                    LEFT JOIN exams_new e ON sub.id = e.subject_id
                    LEFT JOIN exam_results er ON e.id = er.exam_id
                    WHERE sub.is_active = 1
                    GROUP BY sub.id, sub.name, sub.code
                    ORDER BY subject_average DESC
                `;
                filename = 'subject-performance';
                break;
                
            default: // all
                query = `
                    SELECT 
                        s.admission_number,
                        s.name,
                        s.class,
                        sub.name as subject,
                        e.name as exam,
                        e.term,
                        e.academic_year,
                        er.marks_obtained,
                        er.grade,
                        e.total_marks,
                        er.position_in_class,
                        e.exam_date
                    FROM exam_results er
                    JOIN students s ON er.student_id = s.id
                    JOIN exams_new e ON er.exam_id = e.id
                    LEFT JOIN subjects sub ON e.subject_id = sub.id
                    ORDER BY e.exam_date DESC, s.class, s.name
                `;
                filename = 'all-exam-results';
        }
        
        const data = await dbAll(query);
        
        if (format === 'csv') {
            // Convert to CSV
            if (data.length === 0) {
                return res.status(404).send('No data to export');
            }
            
            const headers = Object.keys(data[0]).join(',');
            const rows = data.map(row => 
                Object.values(row).map(value => 
                    `"${String(value || '').replace(/"/g, '""')}"`
                ).join(',')
            );
            
            const csvContent = [headers, ...rows].join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}-${Date.now()}.csv"`);
            return res.send(csvContent);
            
        } else {
            // Return JSON
            res.json({
                success: true,
                data: data,
                count: data.length,
                filename: filename
            });
        }
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({
            success: false,
            message: 'Export failed: ' + error.message
        });
    }
});

// ==================== HELPER FUNCTIONS ====================

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

function getPerformanceLevel(score) {
    if (score >= 70) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 50) return 'Average';
    if (score >= 40) return 'Below Average';
    return 'Poor';
}

module.exports = router;