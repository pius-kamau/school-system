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
        res.render('students/list', { students: rows });
    });
});

// Show new student form
router.get('/new', (req, res) => {
    res.render('students/form');
});

// Save new student with photo
router.post('/new', upload.single('photo'), (req, res) => {
    const { name, gender, class: studentClass, guardian_name, dob } = req.body;
    
    // Input validation
    if (!name || !studentClass) {
        return res.status(400).send('Name and Class are required');
    }
    
    const photoPath = req.file ? `/uploads/student-photos/${req.file.filename}` : null;
    
    db.run('INSERT INTO students (name, gender, class, guardian_name, dob, photo) VALUES (?, ?, ?, ?, ?, ?)',
        [name, gender, studentClass, guardian_name, dob, photoPath], 
        function(err) {
            if (err) {
                console.error('Failed to add student:', err);
                return res.status(500).send('Failed to add student');
            }
            res.redirect('/students');
        }
    );
});

// Show edit student form
router.get('/edit/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM students WHERE id = ?', [id], (err, student) => {
        if (err || !student) {
            return res.status(404).send('Student not found');
        }
        res.render('students/edit', { student });
    });
});

// Update student with optional photo
router.post('/edit/:id', upload.single('photo'), (req, res) => {
    const { id } = req.params;
    const { name, gender, class: studentClass, guardian_name, dob, remove_photo } = req.body;
    
    // First, get the current student to check for existing photo
    db.get('SELECT photo FROM students WHERE id = ?', [id], (err, student) => {
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
        
        // Update student record
        db.run('UPDATE students SET name = ?, gender = ?, class = ?, guardian_name = ?, dob = ?, photo = ? WHERE id = ?',
            [name, gender, studentClass, guardian_name, dob, photoPath, id],
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
        res.render('students/delete', { student });
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

// Student profile view
router.get('/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM students WHERE id = ?', [id], (err, student) => {
        if (err || !student) {
            return res.status(404).send('Student not found');
        }
        res.render('students/profile', { student });
    });
});

module.exports = router;