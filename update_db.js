// update_db.js - Enhanced database migration for Students and Teachers
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('❌ Database error:', err);
    } else {
        console.log('✅ Connected to SQLite database.');
        console.log('🔧 Running database updates...\n');
        
        runMigrations();
    }
});

function runMigrations() {
    const migrations = [
        // STUDENTS TABLE UPDATES
        { 
            sql: `ALTER TABLE students ADD COLUMN photo TEXT`,
            description: 'Add photo column to students'
        },
        { 
            sql: `ALTER TABLE students ADD COLUMN guardian_phone TEXT`,
            description: 'Add guardian_phone column to students'
        },
        { 
            sql: `ALTER TABLE students ADD COLUMN address TEXT`,
            description: 'Add address column to students'
        },
        { 
            sql: `ALTER TABLE students ADD COLUMN email TEXT`,
            description: 'Add email column to students'
        },
        { 
            sql: `ALTER TABLE students ADD COLUMN phone TEXT`,
            description: 'Add phone column to students'
        },
        { 
            sql: `ALTER TABLE students ADD COLUMN status TEXT DEFAULT 'Active'`,
            description: 'Add status column to students'
        },
        { 
            sql: `ALTER TABLE students ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
            description: 'Add created_at timestamp to students'
        },
        
        // TEACHERS TABLE UPDATES
        { 
            sql: `ALTER TABLE teachers ADD COLUMN photo TEXT`,
            description: 'Add photo column to teachers'
        },
        { 
            sql: `ALTER TABLE teachers ADD COLUMN address TEXT`,
            description: 'Add address column to teachers'
        },
        { 
            sql: `ALTER TABLE teachers ADD COLUMN qualification TEXT`,
            description: 'Add qualification column to teachers'
        },
        { 
            sql: `ALTER TABLE teachers ADD COLUMN experience TEXT`,
            description: 'Add experience column to teachers'
        },
        { 
            sql: `ALTER TABLE teachers ADD COLUMN gender TEXT`,
            description: 'Add gender column to teachers'
        },
        { 
            sql: `ALTER TABLE teachers ADD COLUMN dob TEXT`,
            description: 'Add dob column to teachers'
        },
        { 
            sql: `ALTER TABLE teachers ADD COLUMN date_of_joining TEXT`,
            description: 'Add date_of_joining column to teachers'
        },
        { 
            sql: `ALTER TABLE teachers ADD COLUMN salary TEXT`,
            description: 'Add salary column to teachers'
        },
        { 
            sql: `ALTER TABLE teachers ADD COLUMN status TEXT DEFAULT 'Active'`,
            description: 'Add status column to teachers'
        },
        { 
            sql: `ALTER TABLE teachers ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
            description: 'Add created_at timestamp to teachers'
        },
        
        // CREATE ATTENDANCE TABLE IF NOT EXISTS
        { 
            sql: `CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER,
                date TEXT,
                status TEXT,
                remarks TEXT,
                FOREIGN KEY(student_id) REFERENCES students(id)
            )`,
            description: 'Create attendance table'
        },
        
        // CREATE FEES TABLE IF NOT EXISTS
        { 
            sql: `CREATE TABLE IF NOT EXISTS fees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER,
                term TEXT,
                amount_paid REAL,
                balance REAL,
                payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                payment_method TEXT,
                receipt_number TEXT,
                FOREIGN KEY(student_id) REFERENCES students(id)
            )`,
            description: 'Create fees table'
        },
        
        // CREATE USERS TABLE IF NOT EXISTS
        { 
            sql: `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                full_name TEXT,
                email TEXT,
                last_login DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            description: 'Create users table'
        },
        
        // CREATE SETTINGS TABLE IF NOT EXISTS
        { 
            sql: `CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                school_name TEXT DEFAULT 'Offline School System',
                school_logo TEXT,
                address TEXT,
                phone TEXT,
                email TEXT,
                academic_year TEXT DEFAULT '2024',
                term TEXT DEFAULT 'Term 1',
                currency TEXT DEFAULT 'KES',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            description: 'Create settings table'
        }
    ];
    
    let completed = 0;
    let successful = 0;
    let skipped = 0;
    let failed = 0;
    
    console.log(`📋 Running ${migrations.length} database migrations...\n`);
    
    migrations.forEach((migration, index) => {
        db.run(migration.sql, function(err) {
            completed++;
            
            if (err) {
                // Check if error is because column/table already exists
                if (err.message.includes('duplicate column name') || 
                    err.message.includes('already exists')) {
                    console.log(`   ${index + 1}. ⏭️  ${migration.description} (already exists)`);
                    skipped++;
                } else {
                    console.log(`   ${index + 1}. ❌ ${migration.description} FAILED:`, err.message);
                    failed++;
                }
            } else {
                console.log(`   ${index + 1}. ✅ ${migration.description} (added)`);
                successful++;
            }
            
            // When all migrations are processed
            if (completed === migrations.length) {
                console.log('\n📊 Migration Summary:');
                console.log(`   ✅ Successful: ${successful}`);
                console.log(`   ⏭️  Skipped: ${skipped}`);
                console.log(`   ❌ Failed: ${failed}`);
                
                // Insert default settings if table is empty
                db.get(`SELECT COUNT(*) as count FROM settings`, (err, row) => {
                    if (err) {
                        console.log('   ℹ️  Could not check settings table');
                    } else if (row.count === 0) {
                        db.run(`INSERT INTO settings (school_name) VALUES ('Offline School System')`, () => {
                            console.log('   📝 Default settings initialized');
                        });
                    }
                });
                
                // Add default admin user if not exists
                setTimeout(() => {
                    const bcrypt = require('bcrypt');
                    const adminPassword = bcrypt.hashSync('admin123', 10);
                    
                    db.run(`INSERT OR IGNORE INTO users (id, username, password_hash, role, full_name) 
                            VALUES (1, 'admin', ?, 'Admin', 'System Administrator')`, [adminPassword], (err) => {
                        if (err) {
                            console.log('   ℹ️  Could not add default admin user');
                        } else {
                            console.log('   👤 Default admin user ensured');
                        }
                        
                        // Add teacher account
                        const teacherPassword = bcrypt.hashSync('teacher123', 10);
                        db.run(`INSERT OR IGNORE INTO users (username, password_hash, role, full_name) 
                                VALUES ('teacher', ?, 'Teacher', 'John Teacher')`, [teacherPassword]);
                        
                        // Add accountant account
                        const accountantPassword = bcrypt.hashSync('accountant123', 10);
                        db.run(`INSERT OR IGNORE INTO users (username, password_hash, role, full_name) 
                                VALUES ('accountant', ?, 'Accountant', 'Jane Accountant')`, [accountantPassword]);
                        
                        // Add clerk account
                        const clerkPassword = bcrypt.hashSync('clerk123', 10);
                        db.run(`INSERT OR IGNORE INTO users (username, password_hash, role, full_name) 
                                VALUES ('clerk', ?, 'Clerk', 'Mary Clerk')`, [clerkPassword]);
                        
                        console.log('\n🎉 Database update completed successfully!');
                        console.log('\n📋 Next steps:');
                        console.log('   1. Restart your server: node app.js');
                        console.log('   2. Login with: admin / admin123');
                        console.log('   3. Your Students and Teachers modules are now ready!');
                        
                        db.close();
                    });
                }, 1000);
            }
        });
    });
}