// update_db.js
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Database error:', err);
    } else {
        console.log('Connected to SQLite database.');
        
        // Add photo column to students table if it doesn't exist
        db.run(`ALTER TABLE students ADD COLUMN photo TEXT`, function(err) {
            if (err) {
                if (err.message.includes('duplicate column name')) {
                    console.log('Photo column already exists');
                } else {
                    console.error('Error adding photo column:', err);
                }
            } else {
                console.log('Photo column added successfully');
            }
            
            // Close database connection
            db.close();
        });
    }
});