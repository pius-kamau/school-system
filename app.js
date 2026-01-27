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
const feesRoutes = require('./routes/fees-complete'); // ← KEEP THIS ONE
const reportsRoutes = require('./routes/reports');

const app = express();

// --- Session Setup (MUST COME FIRST) ---
app.use(
  session({
    secret: 'school-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      secure: false,
      httpOnly: true
    }
  })
);

// Add debugging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('   Session ID:', req.sessionID);
  console.log('   Session user:', req.session.user || 'No user');
  next();
});

// --- CRITICAL FIX: Add JSON parsing middleware ---
app.use(express.json()); // ← THIS IS MISSING AND CAUSING THE ERROR
app.use(express.urlencoded({ extended: true })); // This is already here for form data
app.use(express.static('public'));
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
    limits: { fileSize: 5 * 1024 * 1024 },
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

// --- Database Connection ---
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('❌ Database error:', err);
  else console.log('✅ SQLite connected successfully');
});

// --- Authentication & Routes ---
// PUBLIC ROUTES (no auth needed)
app.use('/auth', authRoutes);

// PROTECTED ROUTES (auth required)
app.use('/students', isAuthenticated, authorizeRoles('Admin', 'Clerk', 'Teacher'), studentRoutes);
app.use('/teachers', isAuthenticated, authorizeRoles('Admin'), teacherRoutes);
app.use('/attendance', isAuthenticated, authorizeRoles('Admin', 'Teacher'), attendanceRoutes);
app.use('/fees', isAuthenticated, authorizeRoles('Admin', 'Accountant'), feesRoutes);
app.use('/reports', isAuthenticated, authorizeRoles('Admin', 'Accountant', 'Teacher'), reportsRoutes);

// Test route to check session
app.get('/session-test', (req, res) => {
  if (!req.session.views) {
    req.session.views = 1;
  } else {
    req.session.views++;
  }
  
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).send('Session error');
    }
    
    res.send(`
      <h1>Session Test</h1>
      <p>Session ID: ${req.sessionID}</p>
      <p>Visit count: ${req.session.views}</p>
      <p>User: ${JSON.stringify(req.session.user)}</p>
      <p><a href="/session-test">Refresh</a></p>
    `);
  });
});

// --- Dashboard (Protected Route) ---
app.get('/dashboard', isAuthenticated, (req, res) => {
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
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('home');
});

// Debug route for fees
app.get('/test-fees', isAuthenticated, (req, res) => {
    console.log('Test fees route accessed by:', req.session.user);
    
    // Simple test response
    res.send(`
        <h1>Fees Test Route</h1>
        <p>If you can see this, authentication works!</p>
        <p>User: ${req.session.user.username}</p>
        <p>Role: ${req.session.user.role}</p>
        <p><a href="/fees">Try fees again</a></p>
    `);
});

// --- Start Server ---
app.listen(3000, () => {
  console.log('🏫 School System running at http://localhost:3000');
  console.log('📝 Session debugging enabled');
});