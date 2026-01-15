// fix_migration.js
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

console.log('🔧 Running database fixes...\n');

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('❌ Database error:', err);
        process.exit(1);
    }
    
    console.log('✅ Connected to SQLite database.');
    
    // Fix 1: Add created_at columns without DEFAULT
    console.log('\n🛠️  Fixing created_at columns...');
    
    const fixes = [
        // Add created_at to students (without DEFAULT)
        `ALTER TABLE students ADD COLUMN created_at DATETIME`,
        
        // Add created_at to teachers (without DEFAULT)
        `ALTER TABLE teachers ADD COLUMN created_at DATETIME`,
        
        // Add full_name to users table
        `ALTER TABLE users ADD COLUMN full_name TEXT`,
        
        // Add email to users table
        `ALTER TABLE users ADD COLUMN email TEXT`,
        
        // Add last_login to users table
        `ALTER TABLE users ADD COLUMN last_login DATETIME`
    ];
    
    let completed = 0;
    
    fixes.forEach((sql, index) => {
        db.run(sql, function(err) {
            if (err) {
                if (err.message.includes('duplicate column name')) {
                    console.log(`   ${index + 1}. Column already exists`);
                } else {
                    console.log(`   ${index + 1}. Error:`, err.message);
                }
            } else {
                console.log(`   ${index + 1}. Column added successfully`);
            }
            
            completed++;
            
            if (completed === fixes.length) {
                console.log('\n✅ All columns added!');
                
                // Now update existing rows with default values
                console.log('\n📝 Setting default values...');
                
                db.serialize(() => {
                    // Set created_at to current timestamp for existing students
                    db.run(`UPDATE students SET created_at = datetime('now') WHERE created_at IS NULL`, (err) => {
                        if (err) console.log('   Could not update students created_at:', err.message);
                        else console.log('   ✅ Updated students created_at');
                    });
                    
                    // Set created_at to current timestamp for existing teachers
                    db.run(`UPDATE teachers SET created_at = datetime('now') WHERE created_at IS NULL`, (err) => {
                        if (err) console.log('   Could not update teachers created_at:', err.message);
                        else console.log('   ✅ Updated teachers created_at');
                    });
                    
                    // Set default admin user with full_name
                    setTimeout(() => {
                        console.log('\n👤 Creating/updating default users...');
                        
                        // Hash passwords
                        const adminPassword = bcrypt.hashSync('admin123', 10);
                        const teacherPassword = bcrypt.hashSync('teacher123', 10);
                        const accountantPassword = bcrypt.hashSync('accountant123', 10);
                        const clerkPassword = bcrypt.hashSync('clerk123', 10);
                        
                        // First, check if users table has data
                        db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => {
                            if (err) {
                                console.log('   Could not check users table');
                            } else if (row.count === 0) {
                                // Insert all default users
                                const users = [
                                    [1, 'admin', adminPassword, 'Admin', 'System Administrator'],
                                    ['teacher', teacherPassword, 'Teacher', 'John Teacher'],
                                    ['accountant', accountantPassword, 'Accountant', 'Jane Accountant'],
                                    ['clerk', clerkPassword, 'Clerk', 'Mary Clerk']
                                ];
                                
                                let userCount = 0;
                                
                                users.forEach((user, index) => {
                                    if (user[0] === 1) {
                                        // Admin user with ID
                                        db.run(`INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name) 
                                                VALUES (?, ?, ?, ?, ?)`, user, (err) => {
                                            if (err) console.log(`   User ${user[1]} error:`, err.message);
                                            else console.log(`   ✅ ${user[1]} user set`);
                                            userCount++;
                                            
                                            if (userCount === users.length) {
                                                finishMigration();
                                            }
                                        });
                                    } else {
                                        // Other users without ID
                                        db.run(`INSERT OR IGNORE INTO users (username, password_hash, role, full_name) 
                                                VALUES (?, ?, ?, ?)`, user, (err) => {
                                            if (err) console.log(`   User ${user[0]} error:`, err.message);
                                            else console.log(`   ✅ ${user[0]} user set`);
                                            userCount++;
                                            
                                            if (userCount === users.length) {
                                                finishMigration();
                                            }
                                        });
                                    }
                                });
                            } else {
                                // Users table has data, just update admin
                                db.run(`UPDATE users SET full_name = 'System Administrator' 
                                        WHERE username = 'admin' AND (full_name IS NULL OR full_name = '')`, (err) => {
                                    if (err) console.log('   Could not update admin full_name:', err.message);
                                    else console.log('   ✅ Updated admin user');
                                    
                                    finishMigration();
                                });
                            }
                        });
                    }, 500);
                });
            }
        });
    });
});

function finishMigration() {
    console.log('\n🎉 Database fixes completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Restart your server: node app.js');
    console.log('   2. Login with: admin / admin123');
    console.log('   3. Test your Students and Teachers modules!');
    
    setTimeout(() => {
        db.close();
        process.exit(0);
    }, 1000);
}