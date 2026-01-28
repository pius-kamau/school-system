const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath);

console.log('\n=== CHECKING ALL PAYMENTS ===\n');

// Get all payments
db.all("SELECT id, receipt_number, student_id, amount_paid, payment_date, created_at FROM fees ORDER BY id", (err, rows) => {
    if (err) {
        console.error('Error:', err.message);
        return;
    }
    
    console.log(`Found ${rows.length} payments:\n`);
    
    rows.forEach(payment => {
        console.log(`ID: ${payment.id}, Receipt: ${payment.receipt_number}, Amount: ${payment.amount_paid}, Date: ${payment.payment_date}, Created: ${payment.created_at}`);
    });
    
    console.log('\n=== PAYMENT SUMMARY ===\n');
    console.log(`Total payments: ${rows.length}`);
    console.log('Recent payment:', rows[rows.length - 1]);
    
    db.close();
});