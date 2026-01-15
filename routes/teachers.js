const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth');

const db = new sqlite3.Database('./database.sqlite');

// Configure file upload for teacher photos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'public/uploads/teacher-photos/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'teacher-' + uniqueSuffix + path.extname(file.originalname));
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

// List all teachers (Admin only)
router.get('/', isAuthenticated, authorizeRoles('Admin'), (req, res) => {
    db.all('SELECT * FROM teachers ORDER BY name ASC', [], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Database error');
        }
        res.render('teachers/list', { 
            teachers: rows,
            user: req.session.user 
        });
    });
});

// Show new teacher form
router.get('/new', isAuthenticated, authorizeRoles('Admin'), (req, res) => {
    res.render('teachers/form', { 
        teacher: null,
        user: req.session.user 
    });
});

// Save new teacher with photo
router.post('/new', isAuthenticated, authorizeRoles('Admin'), upload.single('photo'), (req, res) => {
    const { 
        name, 
        subject, 
        phone, 
        email, 
        address, 
        qualification, 
        experience,
        gender,
        dob,
        date_of_joining,
        salary,
        status 
    } = req.body;
    
    // Input validation
    if (!name || !subject) {
        return res.status(400).send('Name and Subject are required');
    }
    
    const photoPath = req.file ? `/uploads/teacher-photos/${req.file.filename}` : null;
    
    db.run(`INSERT INTO teachers (
        name, subject, phone, email, address, qualification, experience,
        gender, dob, date_of_joining, salary, photo, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, subject, phone, email, address, qualification, experience,
         gender, dob, date_of_joining, salary, photoPath, status || 'Active'], 
        function(err) {
            if (err) {
                console.error('Failed to add teacher:', err);
                return res.status(500).send('Failed to add teacher');
            }
            res.redirect('/teachers');
        }
    );
});

// Show teacher profile
router.get('/:id', isAuthenticated, authorizeRoles('Admin'), (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM teachers WHERE id = ?', [id], (err, teacher) => {
        if (err || !teacher) {
            return res.status(404).send('Teacher not found');
        }
        res.render('teachers/profile', { 
            teacher,
            user: req.session.user 
        });
    });
});

// Show edit teacher form
router.get('/edit/:id', isAuthenticated, authorizeRoles('Admin'), (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM teachers WHERE id = ?', [id], (err, teacher) => {
        if (err || !teacher) {
            return res.status(404).send('Teacher not found');
        }
        res.render('teachers/edit', { 
            teacher,
            user: req.session.user 
        });
    });
});

// Update teacher with optional photo
router.post('/edit/:id', isAuthenticated, authorizeRoles('Admin'), upload.single('photo'), (req, res) => {
    const { id } = req.params;
    const { 
        name, subject, phone, email, address, qualification, experience,
        gender, dob, date_of_joining, salary, status, remove_photo 
    } = req.body;
    
    // First, get current teacher to check for existing photo
    db.get('SELECT photo FROM teachers WHERE id = ?', [id], (err, teacher) => {
        if (err || !teacher) {
            return res.status(404).send('Teacher not found');
        }
        
        let photoPath = teacher.photo;
        
        // Handle photo removal
        if (remove_photo === 'true' && teacher.photo) {
            // Delete old photo file
            const oldPhotoPath = 'public' + teacher.photo;
            if (fs.existsSync(oldPhotoPath)) {
                fs.unlinkSync(oldPhotoPath);
            }
            photoPath = null;
        }
        
        // Handle new photo upload
        if (req.file) {
            // Delete old photo if exists
            if (teacher.photo) {
                const oldPhotoPath = 'public' + teacher.photo;
                if (fs.existsSync(oldPhotoPath)) {
                    fs.unlinkSync(oldPhotoPath);
                }
            }
            photoPath = `/uploads/teacher-photos/${req.file.filename}`;
        }
        
        // Update teacher record
        db.run(`UPDATE teachers SET 
            name = ?, subject = ?, phone = ?, email = ?, address = ?, 
            qualification = ?, experience = ?, gender = ?, dob = ?,
            date_of_joining = ?, salary = ?, photo = ?, status = ?
            WHERE id = ?`,
            [name, subject, phone, email, address, qualification, experience,
             gender, dob, date_of_joining, salary, photoPath, status, id],
            function(err) {
                if (err) {
                    console.error('Failed to update teacher:', err);
                    return res.status(500).send('Failed to update teacher');
                }
                res.redirect('/teachers');
            }
        );
    });
});

// Show delete confirmation
router.get('/delete/:id', isAuthenticated, authorizeRoles('Admin'), (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM teachers WHERE id = ?', [id], (err, teacher) => {
        if (err || !teacher) {
            return res.status(404).send('Teacher not found');
        }
        res.render('teachers/delete', { 
            teacher,
            user: req.session.user 
        });
    });
});

// Delete teacher
router.post('/delete/:id', isAuthenticated, authorizeRoles('Admin'), (req, res) => {
    const { id } = req.params;
    
    // First, get teacher to delete photo file
    db.get('SELECT photo FROM teachers WHERE id = ?', [id], (err, teacher) => {
        if (err || !teacher) {
            return res.status(404).send('Teacher not found');
        }
        
        // Delete photo file if exists
        if (teacher.photo) {
            const photoPath = 'public' + teacher.photo;
            if (fs.existsSync(photoPath)) {
                fs.unlinkSync(photoPath);
            }
        }
        
        // Delete teacher record
        db.run('DELETE FROM teachers WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('Failed to delete teacher:', err);
                return res.status(500).send('Failed to delete teacher');
            }
            res.redirect('/teachers');
        });
    });
});

module.exports = router;