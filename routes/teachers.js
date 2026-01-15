const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

// List teachers
router.get('/', (req, res) => {
  db.all('SELECT * FROM teachers', [], (err, rows) => {
    if (err) return res.status(500).send('Database error');
    res.render('teachers/list', { 
      title: 'Teachers',
      teachers: rows,
      user: req.session.user 
    });
  });
});

// Add new teacher
router.get('/new', (req, res) => {
  res.render('teachers/form', { 
    title: 'Add Teacher',
    user: req.session.user 
  });
});

router.post('/new', (req, res) => {
  const { name, subject, phone, email } = req.body;
  db.run('INSERT INTO teachers (name, subject, phone, email) VALUES (?, ?, ?, ?)',
    [name, subject, phone, email], (err) => {
      if (err) return res.status(500).send('Error adding teacher');
      res.redirect('/teachers');
  });
});

module.exports = router;