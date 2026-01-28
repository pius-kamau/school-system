const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath);

console.log('\n=== DELETING DUMMY PAYMENTS ===\n');

// First, let's count before deletion
db.get("SELECT COUNT(*) as count FROM fees", (err, result) => {
    if (err) {
        console.error('Error counting:', err.message);
        return;
    }
    
    console.log(`Before deletion: ${result.count} payments`);
    
    // Delete all payments EXCEPT your payments (IDs 9, 10, 11)
    db.run("DELETE FROM fees WHERE id NOT IN (9, 10, 11)", function(err) {
        if (err) {
            console.error('Error deleting:', err.message);
            return;
        }
        
        console.log(`Deleted ${this.changes} dummy payments`);
        
        // Count after deletion
        db.get("SELECT COUNT(*) as count FROM fees", (err, result2) => {
            if (err) {
                console.error('Error counting after:', err.message);
                return;
            }
            
            console.log(`After deletion: ${result2.count} payments remain`);
            
            // Show remaining payments
            db.all("SELECT id, receipt_number, student_id, amount_paid, payment_date FROM fees ORDER BY id", (err, rows) => {
                if (err) {
                    console.error('Error fetching remaining:', err.message);
                    return;
                }
                
                console.log('\n=== REMAINING PAYMENTS ===\n');
                rows.forEach(payment => {
                    console.log(`ID: ${payment.id}, Receipt: ${payment.receipt_number}, Amount: ${payment.amount_paid}, Date: ${payment.payment_date}`);
                });
                
                console.log('\n✅ Deletion complete!');
                db.close();
            });
        });
    });
});