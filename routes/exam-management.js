// routes/exam-management.js - REAL DATA VERSION
const express = require('express');
const router = express.Router();

console.log('Exam Management routes loaded!');

// Database connection
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

// Helper functions
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

const dbRun = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
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

// Helper function to calculate grade
function calculateGrade(marks, totalMarks = 100) {
    if (marks === null || marks === undefined) return 'N/A';
    
    const percentage = (marks / totalMarks) * 100;
    
    if (percentage >= 80) return 'A';
    if (percentage >= 75) return 'A-';
    if (percentage >= 70) return 'B+';
    if (percentage >= 65) return 'B';
    if (percentage >= 60) return 'B-';
    if (percentage >= 55) return 'C+';
    if (percentage >= 50) return 'C';
    if (percentage >= 45) return 'C-';
    if (percentage >= 40) return 'D+';
    if (percentage >= 35) return 'D';
    if (percentage >= 30) return 'D-';
    return 'E';
}

// ==================== EXAM MANAGEMENT ROUTES ====================

// GET /exams/manage - Exam Management Dashboard
router.get('/manage', requireAuth, async (req, res) => {
    try {
        // Get all exams from database
        const exams = await dbAll(`
            SELECT 
                e.id,
                e.name,
                e.exam_type,
                e.term,
                e.academic_year,
                e.exam_date,
                e.total_marks,
                e.pass_marks,
                s.name as subject_name,
                c.name as class_name,
                (SELECT COUNT(*) FROM exam_results WHERE exam_id = e.id) as results_count
            FROM exams_new e
            LEFT JOIN subjects s ON e.subject_id = s.id
            LEFT JOIN classes c ON e.class_id = c.id
            ORDER BY e.exam_date DESC
        `);
        
        res.render('exams/manage', {
            title: 'Exam Management',
            user: req.session.user,
            exams: exams || []
        });
        
    } catch (error) {
        console.error('Exam management error:', error);
        res.status(500).send('Error loading exam management');
    }
});

// GET /exams/create - Create new exam form
router.get('/create', requireAuth, async (req, res) => {
    try {
        // Get real subjects and classes from database
        const subjects = await dbAll('SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name');
        const classes = await dbAll('SELECT id, name FROM classes WHERE is_active = 1 ORDER BY name');
        
        // Get current year and next year for academic years
        const currentYear = new Date().getFullYear();
        const academicYears = [currentYear - 1, currentYear, currentYear + 1];
        
        res.render('exams/create', {
            title: 'Create New Exam',
            user: req.session.user,
            subjects: subjects || [],
            classes: classes || [],
            examTypes: ['Endterm', 'Midterm', 'Quiz', 'Test', 'Assignment'],
            terms: ['Term 1', 'Term 2', 'Term 3'],
            academicYears: academicYears
        });
        
    } catch (error) {
        console.error('Create exam form error:', error);
        res.status(500).send('Error loading create exam form');
    }
});

// POST /exams/create - Save new exam
router.post('/create', requireAuth, async (req, res) => {
    try {
        const { 
            name, 
            exam_type, 
            academic_year, 
            term, 
            subject_id, 
            class_id, 
            total_marks, 
            pass_marks, 
            exam_date 
        } = req.body;
        
        // Validate input
        if (!name || !subject_id || !class_id) {
            return res.status(400).send('Missing required fields');
        }
        
        // Insert new exam into database
        const result = await dbRun(`
            INSERT INTO exams_new 
            (name, exam_type, academic_year, term, subject_id, class_id, total_marks, pass_marks, exam_date, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            name.trim(), 
            exam_type || 'Endterm', 
            academic_year || new Date().getFullYear(), 
            term || 'Term 1', 
            subject_id, 
            class_id, 
            parseFloat(total_marks) || 100, 
            parseFloat(pass_marks) || 50, 
            exam_date || new Date().toISOString().split('T')[0],
            req.session.user.id || 1
        ]);
        
        const examId = result.lastID;
        
        // Redirect to marks entry page for this exam
        res.redirect(`/exams/${examId}/marks`);
        
    } catch (error) {
        console.error('Create exam error:', error);
        res.status(500).send('Error creating exam: ' + error.message);
    }
});

// GET /exams/:id/marks - Enter marks for an exam
router.get('/:id/marks', requireAuth, async (req, res) => {
    try {
        const examId = req.params.id;
        
        // Get exam details from database
        const exam = await dbGet(`
            SELECT 
                e.*,
                s.name as subject_name,
                c.name as class_name
            FROM exams_new e
            LEFT JOIN subjects s ON e.subject_id = s.id
            LEFT JOIN classes c ON e.class_id = c.id
            WHERE e.id = ?
        `, [examId]);
        
        if (!exam) {
            return res.status(404).send('Exam not found');
        }
        
        // Get real students in this class from database
        const students = await dbAll(`
            SELECT 
                s.id,
                s.name,
                s.admission_number,
                s.class,
                er.marks_obtained,
                er.grade,
                er.remarks,
                er.id as result_id
            FROM students s
            LEFT JOIN exam_results er ON s.id = er.student_id AND er.exam_id = ?
            WHERE s.class LIKE ? OR s.class = ?
            ORDER BY s.name
        `, [examId, `%${exam.class_name}%`, exam.class_name]);
        
        res.render('exams/enter-marks', {
            title: `Enter Marks - ${exam.name}`,
            user: req.session.user,
            exam: exam,
            students: students || [],
            success: req.query.success
        });
        
    } catch (error) {
        console.error('Marks entry form error:', error);
        res.status(500).send('Error loading marks entry form: ' + error.message);
    }
});

// POST /exams/:id/marks - Save marks for an exam
router.post('/:id/marks', requireAuth, async (req, res) => {
    try {
        const examId = req.params.id;
        const { marks, remarks } = req.body; // marks is an object: { student_id: marks_value }
        
        // Get exam details to know total marks
        const exam = await dbGet('SELECT total_marks FROM exams_new WHERE id = ?', [examId]);
        if (!exam) {
            return res.status(404).send('Exam not found');
        }
        
        // Save marks for each student
        let savedCount = 0;
        
        if (marks && typeof marks === 'object') {
            for (const studentId in marks) {
                const marksValue = marks[studentId] ? parseFloat(marks[studentId]) : null;
                const studentRemark = remarks && remarks[studentId] ? remarks[studentId].trim() : null;
                
                if (marksValue !== null && !isNaN(marksValue)) {
                    const grade = calculateGrade(marksValue, exam.total_marks);
                    
                    // Check if result already exists
                    const existing = await dbGet(
                        'SELECT id FROM exam_results WHERE exam_id = ? AND student_id = ?',
                        [examId, studentId]
                    );
                    
                    if (existing) {
                        // Update existing result
                        await dbRun(`
                            UPDATE exam_results 
                            SET marks_obtained = ?, grade = ?, remarks = ?, updated_at = CURRENT_TIMESTAMP
                            WHERE exam_id = ? AND student_id = ?
                        `, [marksValue, grade, studentRemark, examId, studentId]);
                    } else {
                        // Insert new result
                        await dbRun(`
                            INSERT INTO exam_results (exam_id, student_id, marks_obtained, grade, remarks, created_by)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `, [examId, studentId, marksValue, grade, studentRemark, req.session.user.id || 1]);
                    }
                    savedCount++;
                }
            }
        }
        
        res.redirect(`/exams/${examId}/marks?success=1&saved=${savedCount}`);
        
    } catch (error) {
        console.error('Save marks error:', error);
        res.status(500).send('Error saving marks: ' + error.message);
    }
});

// GET /exams/:id/edit - Edit exam details
router.get('/:id/edit', requireAuth, async (req, res) => {
    try {
        const examId = req.params.id;
        
        // Get exam details from database
        const exam = await dbGet(`
            SELECT * FROM exams_new WHERE id = ?
        `, [examId]);
        
        if (!exam) {
            return res.status(404).send('Exam not found');
        }
        
        // Get real subjects and classes from database
        const subjects = await dbAll('SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name');
        const classes = await dbAll('SELECT id, name FROM classes WHERE is_active = 1 ORDER BY name');
        
        res.render('exams/edit', {
            title: 'Edit Exam',
            user: req.session.user,
            exam: exam,
            subjects: subjects || [],
            classes: classes || [],
            examTypes: ['Endterm', 'Midterm', 'Quiz', 'Test', 'Assignment'],
            terms: ['Term 1', 'Term 2', 'Term 3'],
            academicYears: ['2023', '2024', '2025']
        });
        
    } catch (error) {
        console.error('Edit exam form error:', error);
        res.status(500).send('Error loading edit exam form');
    }
});

// POST /exams/:id/edit - Update exam details
router.post('/:id/edit', requireAuth, async (req, res) => {
    try {
        const examId = req.params.id;
        const { 
            name, 
            exam_type, 
            academic_year, 
            term, 
            subject_id, 
            class_id, 
            total_marks, 
            pass_marks, 
            exam_date 
        } = req.body;
        
        // Update exam in database
        await dbRun(`
            UPDATE exams_new SET
                name = ?,
                exam_type = ?,
                academic_year = ?,
                term = ?,
                subject_id = ?,
                class_id = ?,
                total_marks = ?,
                pass_marks = ?,
                exam_date = ?
            WHERE id = ?
        `, [
            name.trim(), 
            exam_type, 
            academic_year, 
            term, 
            subject_id, 
            class_id, 
            parseFloat(total_marks) || 100, 
            parseFloat(pass_marks) || 50, 
            exam_date,
            examId
        ]);
        
        res.redirect(`/exams/manage?success=1`);
        
    } catch (error) {
        console.error('Update exam error:', error);
        res.status(500).send('Error updating exam');
    }
});

// GET /exams/:id/delete - Delete exam
router.get('/:id/delete', requireAuth, async (req, res) => {
    try {
        const examId = req.params.id;
        
        // First delete all results for this exam
        await dbRun('DELETE FROM exam_results WHERE exam_id = ?', [examId]);
        
        // Then delete the exam
        await dbRun('DELETE FROM exams_new WHERE id = ?', [examId]);
        
        res.redirect('/exams/manage?deleted=1');
        
    } catch (error) {
        console.error('Delete exam error:', error);
        res.status(500).send('Error deleting exam');
    }
});

// GET /exams/view/:id - View exam results
router.get('/view/:id', requireAuth, async (req, res) => {
    try {
        const examId = req.params.id;
        
        // Get exam details from database
        const exam = await dbGet(`
            SELECT 
                e.*,
                s.name as subject_name,
                c.name as class_name
            FROM exams_new e
            LEFT JOIN subjects s ON e.subject_id = s.id
            LEFT JOIN classes c ON e.class_id = c.id
            WHERE e.id = ?
        `, [examId]);
        
        if (!exam) {
            return res.status(404).send('Exam not found');
        }
        
        // Get real exam results from database
        const results = await dbAll(`
            SELECT 
                er.*,
                s.name as student_name,
                s.admission_number,
                s.class,
                ROUND((er.marks_obtained * 100.0 / e.total_marks), 1) as percentage
            FROM exam_results er
            JOIN students s ON er.student_id = s.id
            JOIN exams_new e ON er.exam_id = e.id
            WHERE er.exam_id = ?
            ORDER BY er.marks_obtained DESC
        `, [examId]);
        
        // Calculate real statistics from database
        const statsQuery = await dbGet(`
            SELECT 
                COUNT(*) as total_students,
                AVG(marks_obtained) as average_marks,
                MIN(marks_obtained) as lowest_marks,
                MAX(marks_obtained) as highest_marks,
                COUNT(CASE WHEN marks_obtained >= ? THEN 1 END) as pass_count,
                COUNT(CASE WHEN marks_obtained < ? THEN 1 END) as fail_count
            FROM exam_results 
            WHERE exam_id = ?
        `, [exam.pass_marks, exam.pass_marks, examId]);
        
        const stats = statsQuery || {
            total_students: 0,
            average_marks: 0,
            highest_marks: 0,
            lowest_marks: 0,
            pass_count: 0,
            fail_count: 0
        };
        
        // Round the average
        if (stats.average_marks) {
            stats.average_marks = Math.round(stats.average_marks * 10) / 10;
        }
        
        res.render('exams/view-results', {
            title: `Results - ${exam.name}`,
            user: req.session.user,
            exam: exam,
            results: results || [],
            stats: stats
        });
        
    } catch (error) {
        console.error('View exam results error:', error);
        res.status(500).send('Error loading exam results');
    }
});

// GET /exams/quick-entry - Quick marks entry for all classes
router.get('/quick-entry', requireAuth, async (req, res) => {
    try {
        // Get all active exams
        const exams = await dbAll(`
            SELECT e.id, e.name, e.exam_date, s.name as subject, c.name as class_name
            FROM exams_new e
            LEFT JOIN subjects s ON e.subject_id = s.id
            LEFT JOIN classes c ON e.class_id = c.id
            ORDER BY e.exam_date DESC
            LIMIT 10
        `);
        
        // Get all classes
        const classes = await dbAll('SELECT DISTINCT name FROM students WHERE class IS NOT NULL ORDER BY class');
        
        res.render('exams/quick-entry', {
            title: 'Quick Marks Entry',
            user: req.session.user,
            exams: exams || [],
            classes: classes || []
        });
        
    } catch (error) {
        console.error('Quick entry error:', error);
        res.status(500).send('Error loading quick entry');
    }
});

module.exports = router;