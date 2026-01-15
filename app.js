const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const session = require('express-session');
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const teacherRoutes = require('./routes/teachers');
const { isAuthenticated, authorizeRoles } = require('./middleware/auth');
const attendanceRoutes = require('./routes/attendance');
const multer = require('multer');
const feesRoutes = require('./routes/fees');
const reportsRoutes = require('./routes/reports');

const app = express();

// --- Middleware Setup ---
app.use(express.urlencoded({ extended: true })); // parse form submissions
app.use(express.static('public'));
app.use('/fees', isAuthenticated, authorizeRoles('Admin', 'Accountant'), feesRoutes);
app.use('/reports', isAuthenticated, authorizeRoles('Admin', 'Accountant', 'Teacher'), reportsRoutes);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- File Upload Configuration ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/student-photos/');
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
// --- Session Setup (must come BEFORE routes) ---
app.use(
  session({
    secret: 'school-secret-key',
    resave: false,
    saveUninitialized: true,
  })
);

// --- Database Connection ---
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('❌ Database error:', err);
  else console.log('✅ SQLite connected successfully');
});

// --- Authentication & Routes ---
app.use('/auth', authRoutes);
app.use('/students', isAuthenticated, authorizeRoles('Admin', 'Clerk', 'Teacher'), studentRoutes);
app.use('/teachers', isAuthenticated, authorizeRoles('Admin'), teacherRoutes);
app.use('/attendance', isAuthenticated, authorizeRoles('Admin', 'Teacher'), attendanceRoutes);

/// --- Dashboard (Protected Route) ---
app.get('/dashboard', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  
  const db = new sqlite3.Database('./database.sqlite');
  const user = req.session.user;
  
  // Get all statistics
  db.serialize(() => {
    // Get total students
    db.get('SELECT COUNT(*) as total FROM students', (err, studentsRow) => {
      if (err) console.error('Student count error:', err);
      
      // Get total teachers
      db.get('SELECT COUNT(*) as total FROM teachers', (err, teachersRow) => {
        if (err) console.error('Teacher count error:', err);
        
        // Get today's attendance
        const today = new Date().toISOString().split('T')[0];
        db.get('SELECT COUNT(*) as total FROM attendance WHERE date = ?', [today], (err, attendanceRow) => {
          if (err) console.error('Attendance error:', err);
          
          // Get total fees collected
          db.get('SELECT SUM(amount_paid) as total FROM fees', (err, feesRow) => {
            if (err) console.error('Fees error:', err);
            
            // Get recent students (last 5)
            db.all('SELECT * FROM students ORDER BY id DESC LIMIT 5', (err, recentStudents) => {
              if (err) console.error('Recent students error:', err);
              
              // Get today's absent students
              db.all(`
                SELECT s.id, s.name, s.class 
                FROM students s 
                WHERE s.id NOT IN (
                  SELECT student_id FROM attendance 
                  WHERE date = ? AND status = "Present"
                )
                LIMIT 5
              `, [today], (err, absentStudents) => {
                if (err) console.error('Absent students error:', err);
                
                // Render dashboard with all data
                res.render('dashboard', {
                  user: user,
                  stats: {
                    totalStudents: studentsRow?.total || 0,
                    totalTeachers: teachersRow?.total || 0,
                    todayAttendance: attendanceRow?.total || 0,
                    totalFees: feesRow?.total || 0,
                    attendanceRate: studentsRow?.total ? Math.round((attendanceRow?.total || 0) / studentsRow.total * 100) : 0
                  },
                  recentStudents: recentStudents || [],
                  absentStudents: absentStudents || [],
                  today: today
                });
                
                db.close();
              });
            });
          });
        });
      });
    });
  });
});

// --- Home Page ---
app.get('/', (req, res) => {
  res.render('home');
});

// --- Start Server ---
app.listen(3000, () => {
  console.log('🏫 School System running at http://localhost:3000');
});