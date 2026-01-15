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

  // Teachers
  db.run(`CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject TEXT,
    phone TEXT,
    email TEXT
  )`);

  // Attendance
  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    date TEXT,
    status TEXT,
    FOREIGN KEY(student_id) REFERENCES students(id)
  )`);

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