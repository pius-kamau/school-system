const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

// List attendance for today
router.get('/', (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  db.all('SELECT * FROM students', [], (err, students) => {
    if (err) return res.send('Database error');
    res.render('attendance/list', { students, today });
  });
});

// Mark attendance for today
router.post('/', (req, res) => {
  const { attendanceDate } = req.body;
  const attendanceData = req.body;

  Object.keys(attendanceData).forEach((studentId) => {
    if (studentId.startsWith('status_')) {
      const id = studentId.split('_')[1];
      const status = attendanceData[studentId];
      db.run(
        'INSERT INTO attendance (student_id, date, status) VALUES (?, ?, ?)',
        [id, attendanceDate, status],
        (err) => {
          if (err) console.error(err);
        }
      );
    }
  });

  res.redirect('/attendance');
});

module.exports = router;