const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'public/uploads/student-photos/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'student-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only images (jpeg, jpg, png, gif) are allowed'));
        }
    }
});

const db = new sqlite3.Database('./database.sqlite');

// List all students
router.get('/', (req, res) => {
    db.all('SELECT * FROM students ORDER BY name ASC', [], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Database error');
        }
        res.render('students/list', { 
            students: rows,
            user: req.session.user // Add user for navigation
        });
    });
});

// Show new student form - FIXED: Add user and student: null
router.get('/new', (req, res) => {
    res.render('students/form', {
        student: null,  // ← CRITICAL: Pass null for new students
        user: req.session.user
    });
});

// Save new student with photo - FIXED: Route matches form action
router.post('/new', upload.single('photo'), (req, res) => {
    const { name, gender, class: studentClass, guardian_name, dob, email, phone, address, status } = req.body;
    
    // Input validation
    if (!name || !studentClass) {
        return res.status(400).send('Name and Class are required');
    }
    
    const photoPath = req.file ? `/uploads/student-photos/${req.file.filename}` : null;
    
    db.run('INSERT INTO students (name, gender, class, guardian_name, dob, photo, email, phone, address, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, gender, studentClass, guardian_name, dob, photoPath, email, phone, address, status || 'Active'], 
        function(err) {
            if (err) {
                console.error('Failed to add student:', err);
                return res.status(500).send('Failed to add student');
            }
            res.redirect('/students');
        }
    );
});

// Show edit student form - FIXED: Route matches form action
router.get('/edit/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM students WHERE id = ?', [id], (err, student) => {
        if (err || !student) {
            return res.status(404).send('Student not found');
        }
        res.render('students/form', { 
            student: student,  // ← Pass student for editing
            user: req.session.user
        });
    });
});

// Update student with optional photo - FIXED: Route matches form action
router.post('/edit/:id', upload.single('photo'), (req, res) => {
    const { id } = req.params;
    const { name, gender, class: studentClass, guardian_name, dob, email, phone, address, status, remove_photo } = req.body;
    
    // First, get the current student to check for existing photo
    db.get('SELECT * FROM students WHERE id = ?', [id], (err, student) => {
        if (err || !student) {
            return res.status(404).send('Student not found');
        }
        
        let photoPath = student.photo;
        
        // Handle photo removal
        if (remove_photo === 'true' && student.photo) {
            // Delete the old photo file
            const oldPhotoPath = 'public' + student.photo;
            if (fs.existsSync(oldPhotoPath)) {
                fs.unlinkSync(oldPhotoPath);
            }
            photoPath = null;
        }
        
        // Handle new photo upload
        if (req.file) {
            // Delete old photo if exists
            if (student.photo) {
                const oldPhotoPath = 'public' + student.photo;
                if (fs.existsSync(oldPhotoPath)) {
                    fs.unlinkSync(oldPhotoPath);
                }
            }
            photoPath = `/uploads/student-photos/${req.file.filename}`;
        }
        
        // Update student record with ALL fields
        db.run('UPDATE students SET name = ?, gender = ?, class = ?, guardian_name = ?, dob = ?, photo = ?, email = ?, phone = ?, address = ?, status = ? WHERE id = ?',
            [name, gender, studentClass, guardian_name, dob, photoPath, email, phone, address, status || 'Active', id],
            function(err) {
                if (err) {
                    console.error('Failed to update student:', err);
                    return res.status(500).send('Failed to update student');
                }
                res.redirect('/students');
            }
        );
    });
});

// Delete student (with photo cleanup)
router.get('/delete/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM students WHERE id = ?', [id], (err, student) => {
        if (err || !student) {
            return res.status(404).send('Student not found');
        }
        res.render('students/delete', { 
            student: student,
            user: req.session.user 
        });
    });
});

// Confirm and delete student
router.post('/delete/:id', (req, res) => {
    const { id } = req.params;
    
    // First, get student to delete photo file
    db.get('SELECT photo FROM students WHERE id = ?', [id], (err, student) => {
        if (err || !student) {
            return res.status(404).send('Student not found');
        }
        
        // Delete photo file if exists
        if (student.photo) {
            const photoPath = 'public' + student.photo;
            if (fs.existsSync(photoPath)) {
                fs.unlinkSync(photoPath);
            }
        }
        
        // Delete student record
        db.run('DELETE FROM students WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('Failed to delete student:', err);
                return res.status(500).send('Failed to delete student');
            }
            
            // Delete related records
            db.run('DELETE FROM attendance WHERE student_id = ?', [id]);
            db.run('DELETE FROM exams WHERE student_id = ?', [id]);
            db.run('DELETE FROM fees WHERE student_id = ?', [id]);
            
            res.redirect('/students');
        });
    });
});
// GET /students/api/all - API endpoint to get all students
router.get('/api/all', (req, res) => {
    try {
        db.all('SELECT id, name, class, admission_number, parent_name, parent_phone FROM students ORDER BY name', 
            (err, students) => {
                if (err) {
                    console.error('Error fetching students:', err);
                    return res.status(500).json({ error: 'Failed to fetch students' });
                }
                res.json(students);
            }
        );
    } catch (error) {
        console.error('Students API error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});
// Student profile view
router.get('/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM students WHERE id = ?', [id], (err, student) => {
        if (err || !student) {
            return res.status(404).send('Student not found');
        }
        res.render('students/profile', { 
            student: student,
            user: req.session.user 
        });
    });
});

module.exports = router;