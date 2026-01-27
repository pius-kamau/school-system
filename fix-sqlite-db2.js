const sqlite3 = require('sqlite3').verbose();
const path = require('path');

console.log('🔧 FIXING SQLITE DATABASE STRUCTURE - PART 2');
console.log('=============================================');

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
        return;
    }
    console.log('✅ Connected to SQLite database');
});

// Function to run SQL queries
function runSQL(sql) {
    return new Promise((resolve, reject) => {
        console.log('Executing:', sql.substring(0, 100).replace(/\n/g, ' ') + '...');
        db.run(sql, function(err) {
            if (err) {
                console.error('❌ Error:', err.message);
                reject(err);
            } else {
                console.log('✅ Success');
                resolve(this);
            }
        });
    });
}

async function fixDatabase() {
    try {
        console.log('\n1. ADDING MISSING COLUMNS TO EXISTING TABLES');
        
        // Add fee_amount to students if not exists
        try {
            await runSQL(`ALTER TABLE students ADD COLUMN fee_amount DECIMAL(10,2) DEFAULT 15000`);
        } catch (err) {
            console.log('fee_amount may already exist');
        }
        
        try {
            await runSQL(`ALTER TABLE students ADD COLUMN admission_number VARCHAR(50)`);
        } catch (err) {
            console.log('admission_number may already exist');
        }
        
        console.log('\n2. UPDATING STUDENTS WITH DEFAULT VALUES');
        
        // Update existing students
        await runSQL(`UPDATE students SET 
            admission_number = 'STU' || printf('%03d', id) 
            WHERE admission_number IS NULL OR admission_number = ''`);
        
        await runSQL(`UPDATE students SET 
            fee_amount = 15000 
            WHERE fee_amount IS NULL OR fee_amount = 0`);
        
        console.log('\n3. ADDING MISSING COLUMNS TO FEES TABLE');
        
        // Add missing columns to existing fees table
        const feeColumns = [
            'mpesa_code VARCHAR(50)',
            'phone_number VARCHAR(20)',
            'bank_name VARCHAR(100)',
            'bank_reference VARCHAR(100)'
        ];
        
        for (const col of feeColumns) {
            const colName = col.split(' ')[0];
            try {
                await runSQL(`ALTER TABLE fees ADD COLUMN ${col}`);
            } catch (err) {
                console.log(`Column ${colName} may already exist`);
            }
        }
        
        console.log('\n4. UPDATING EXISTING FEES RECORDS');
        
        // Update status for existing fees records
        await runSQL(`UPDATE fees SET status = 
            CASE 
                WHEN balance > 0 THEN 'Partial'
                WHEN balance = 0 THEN 'Paid'
                ELSE 'Pending'
            END
            WHERE status IS NULL`);
        
        console.log('\n5. VERIFICATION');
        
        // Show final structure
        console.log('\n📊 FINAL STUDENTS TABLE COLUMNS:');
        db.all("PRAGMA table_info(students)", (err, cols) => {
            if (cols) {
                cols.forEach(col => console.log(`  - ${col.name} (${col.type})`));
            }
        });
        
        console.log('\n💰 FINAL FEES TABLE COLUMNS:');
        db.all("PRAGMA table_info(fees)", (err, cols) => {
            if (cols) {
                cols.forEach(col => console.log(`  - ${col.name} (${col.type})`));
            }
        });
        
        // Wait a bit for async operations
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Show counts
        db.get('SELECT COUNT(*) as students FROM students', (err, row) => {
            console.log(`\n👥 Total students: ${row?.students || 0}`);
        });
        
        db.get('SELECT COUNT(*) as fees FROM fees', (err, row) => {
            console.log(`💰 Total fee records: ${row?.fees || 0}`);
        });
        
        // Show sample data
        db.all('SELECT id, name, class, fee_amount, admission_number FROM students LIMIT 3', (err, rows) => {
            if (rows && rows.length > 0) {
                console.log('\n📋 SAMPLE STUDENTS:');
                rows.forEach(student => {
                    console.log(`  ${student.id}. ${student.name} (${student.class}) - Fee: ${student.fee_amount}`);
                });
            }
        });
        
        db.all('SELECT id, student_id, receipt_number, amount_paid, balance, status FROM fees LIMIT 3', (err, rows) => {
            if (rows && rows.length > 0) {
                console.log('\n💰 SAMPLE FEES:');
                rows.forEach(fee => {
                    console.log(`  Receipt: ${fee.receipt_number} - Paid: ${fee.amount_paid} - Balance: ${fee.balance} - Status: ${fee.status}`);
                });
            }
        });
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ DATABASE FIX COMPLETED!');
        console.log('='.repeat(60));
        console.log('\n🎉 Your database is now ready for the fees system!');
        console.log('⚠️  Important: Use amount_paid (not amount) and amount_due (not total_due)');
        console.log('\n🔄 Now update your fees-complete.js to match this structure.');
        
    } catch (error) {
        console.error('❌ Error fixing database:', error.message);
    } finally {
        // Close database
        db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err.message);
            } else {
                console.log('🔒 Database connection closed');
            }
        });
    }
}

// Run the fix
fixDatabase();