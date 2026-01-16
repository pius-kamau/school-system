const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

// Connect to the database (will create file if missing)
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('❌ Database connection error:', err);
  else console.log('✅ Connected to SQLite database.');
});

const bcrypt = require('bcrypt');
const pass = bcrypt.hashSync('teacher123', 10);
db.run(`INSERT INTO users (username, password_hash, role) VALUES ('teacher', ?, 'Teacher')`, [pass]);

// Create tables
db.serialize(() => {
  // Students
  db.run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    gender TEXT,
    class TEXT,
    guardian_name TEXT,
    dob TEXT,
    photo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

  // Teachers table with enhanced columns
db.run(`CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    qualification TEXT,
    experience TEXT,
    gender TEXT,
    dob TEXT,
    date_of_joining TEXT,
    salary TEXT,
    photo TEXT,
    status TEXT DEFAULT 'Active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
  // Attendance
  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    date TEXT,
    status TEXT,
    FOREIGN KEY(student_id) REFERENCES students(id)
  )`);
  // In your database setup file, add these tables:
db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    date DATE NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'late', 'excused')),
    notes TEXT,
    recorded_by INTEGER, -- teacher_id from users table
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY(recorded_by) REFERENCES users(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    grade TEXT,
    teacher_id INTEGER,
    academic_year TEXT DEFAULT '2024-2025',
    FOREIGN KEY(teacher_id) REFERENCES teachers(id)
)`);
// In your database setup file (where you create other tables)
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    // Attendance table
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        date DATE NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'late', 'excused')),
        notes TEXT,
        recorded_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
    )`, (err) => {
        if (err) console.error('❌ Attendance table error:', err);
        else console.log('✅ Attendance table created/verified');
    });
    
    // Add any other tables you need...
});

db.close();
// Add class_id to students table if not exists
db.run(`ALTER TABLE students ADD COLUMN class_id INTEGER REFERENCES classes(id)`);

console.log('✅ Attendance tables created/updated!');

  // Exams
  db.run(`CREATE TABLE IF NOT EXISTS exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    subject TEXT,
    term TEXT,
    score REAL,
    grade TEXT,
    FOREIGN KEY(student_id) REFERENCES students(id)
  )`);

  // Fees
  db.run(`CREATE TABLE IF NOT EXISTS fees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    term TEXT,
    amount_paid REAL,
    balance REAL,
    FOREIGN KEY(student_id) REFERENCES students(id)
  )`);

  // Users
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT
  )`);

  // Default admin account
  const adminPassword = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'admin', ?, 'Admin')`, [adminPassword]);

  console.log('🏫 All tables created successfully!');
  console.log('🔐 Default login: admin / admin123');
});

db.close();