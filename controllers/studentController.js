const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

// List students
exports.listStudents = (req, res) => {
  db.all('SELECT * FROM students ORDER BY id DESC', [], (err, rows) => {
    if (err) throw err;

    res.render('layout', {
      title: 'Students',
      user: req.session?.user || { username: 'Guest', role: 'Viewer' },
      content: 'students/list',
      students: rows,
    });
  });
};

// Add student
exports.addStudent = (req, res) => {
  const { admission_no, first_name, last_name, class_name, guardian_name } = req.body;
  const query = `INSERT INTO students (admission_no, first_name, last_name, class, guardian_name)
                 VALUES (?, ?, ?, ?, ?)`;
  db.run(query, [admission_no, first_name, last_name, class_name, guardian_name], (err) => {
    if (err) throw err;
    res.redirect('/students');
  });
};