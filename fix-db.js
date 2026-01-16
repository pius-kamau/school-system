// fix-db.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

console.log('🔧 Fixing attendance table...');

// Add missing columns to attendance table
db.serialize(() => {
    // Check current table structure
    db.all("PRAGMA table_info(attendance)", (err, columns) => {
        if (err) {
            console.error('Error checking table:', err.message);
            return;
        }
        
        console.log('Current attendance table columns:');
        columns.forEach(col => console.log(`  - ${col.name} (${col.type})`));
        
        // Check if notes column exists
        const hasNotes = columns.some(col => col.name === 'notes');
        const hasRecordedBy = columns.some(col => col.name === 'recorded_by');
        
        if (!hasNotes) {
            console.log('Adding notes column...');
            db.run('ALTER TABLE attendance ADD COLUMN notes TEXT', (err) => {
                if (err) {
                    console.error('Error adding notes column:', err.message);
                } else {
                    console.log('✅ Added notes column');
                }
            });
        }
        
        if (!hasRecordedBy) {
            console.log('Adding recorded_by column...');
            db.run('ALTER TABLE attendance ADD COLUMN recorded_by INTEGER', (err) => {
                if (err) {
                    console.error('Error adding recorded_by column:', err.message);
                } else {
                    console.log('✅ Added recorded_by column');
                }
            });
        }
        
        // Check status column values
        console.log('\nChecking existing attendance records...');
        db.all('SELECT DISTINCT status FROM attendance', (err, rows) => {
            if (err) {
                console.error('Error checking status:', err.message);
            } else {
                console.log('Existing status values:', rows.map(r => r.status));
            }
            
            db.close();
            console.log('\n🎉 Database fix complete!');
            console.log('Restart your server with: node app.js');
        });
    });
});