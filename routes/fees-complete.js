const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

console.log('💰 Fees routes loaded!');

// Initialize database connection
const dbPath = path.join(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath);

// Helper function to promisify database operations
function dbGet(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function dbRun(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// Middleware to check authentication
function checkAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    next();
}

// Apply authentication check to all fee routes
router.use(checkAuth);

// ==================== DASHBOARD & PAGES ====================

// GET /fees - Dashboard
router.get('/', async (req, res) => {
    try {
        console.log('Fees dashboard accessed by:', req.session.user);
        
        let stats = {
            total_collected: 0,
            total_balance: 0,
            total_students: 0,
            total_transactions: 0
        };
        
        let recentFees = [];
        let outstanding = [];
        
        try {
            // Get real data
            const totalCollected = await dbGet('SELECT COALESCE(SUM(amount_paid), 0) as total FROM fees');
            stats.total_collected = totalCollected?.total || 0;
            
            const totalBalance = await dbGet('SELECT COALESCE(SUM(balance), 0) as total FROM fees WHERE balance > 0');
            stats.total_balance = totalBalance?.total || 0;
            
            const totalStudents = await dbGet('SELECT COUNT(*) as count FROM students');
            stats.total_students = totalStudents?.count || 0;
            
            const totalTransactions = await dbGet('SELECT COUNT(*) as count FROM fees');
            stats.total_transactions = totalTransactions?.count || 0;
            
            recentFees = await dbAll(`
                SELECT f.*, s.name as student_name, s.class 
                FROM fees f 
                LEFT JOIN students s ON f.student_id = s.id 
                ORDER BY f.created_at DESC 
                LIMIT 10
            `);
            
            outstanding = await dbAll(`
                SELECT s.id, s.name, s.class, s.admission_number,
                       COALESCE(SUM(f.balance), 0) as total_balance
                FROM students s 
                LEFT JOIN fees f ON s.id = f.student_id
                GROUP BY s.id, s.name, s.class, s.admission_number
                HAVING total_balance > 0
                LIMIT 10
            `);
            
        } catch (dbError) {
            console.log('Database error:', dbError.message);
        }
        
        res.render('fees/dashboard', {
            title: 'Fee Management',
            user: req.session.user,
            stats: stats,
            recentFees: recentFees,
            outstanding: outstanding,
            today: new Date().toISOString().split('T')[0]
        });
        
    } catch (error) {
        console.error('Fees error:', error);
        res.status(500).send(`
            <h1>Fees Error</h1>
            <p>${error.message}</p>
            <a href="/">Go Home</a>
        `);
    }
});

// GET /fees/payment-form - RECORD PAYMENT FORM (THIS IS THE MISSING ROUTE)
router.get('/payment-form', async (req, res) => {
    try {
        console.log('💰 Payment form accessed by:', req.session.user?.username);
        
        // Get next receipt number
        let nextReceiptNumber = '0001';
        
        try {
            const result = await dbGet('SELECT MAX(receipt_number) as last_receipt FROM fees');
            if (result && result.last_receipt) {
                const lastNum = parseInt(result.last_receipt) || 0;
                nextReceiptNumber = (lastNum + 1).toString().padStart(4, '0');
                console.log('Next receipt number:', nextReceiptNumber);
            }
        } catch (dbError) {
            console.log('No existing receipts, using default:', nextReceiptNumber);
        }
        
        // Get today's date
        const today = new Date().toISOString().split('T')[0];
        
        // Get today's payments for sidebar
        let todayPayments = [];
        let todayTotal = 0;
        
        try {
            todayPayments = await dbAll(`
                SELECT f.*, s.name as student_name 
                FROM fees f 
                JOIN students s ON f.student_id = s.id 
                WHERE DATE(f.payment_date) = ?
                ORDER BY f.created_at DESC 
                LIMIT 5
            `, [today]);
            
            const todayTotalResult = await dbGet(`
                SELECT COALESCE(SUM(amount_paid), 0) as total 
                FROM fees 
                WHERE DATE(payment_date) = ?
            `, [today]);
            todayTotal = todayTotalResult?.total || 0;
            
        } catch (dbError) {
            console.log('Could not fetch today stats:', dbError.message);
        }
        
        // Get monthly total
        let monthlyTotal = 0;
        try {
            const monthStart = new Date();
            monthStart.setDate(1);
            const monthStartStr = monthStart.toISOString().split('T')[0];
            
            const monthlyResult = await dbGet(`
                SELECT COALESCE(SUM(amount_paid), 0) as total 
                FROM fees 
                WHERE DATE(payment_date) >= ?
            `, [monthStartStr]);
            monthlyTotal = monthlyResult?.total || 0;
        } catch (error) {
            console.log('Monthly total error:', error.message);
        }
        
        // Get pending count
        let pendingCount = 0;
        try {
            const pendingResult = await dbGet(`
                SELECT COUNT(DISTINCT student_id) as count 
                FROM fees 
                WHERE balance > 0
            `);
            pendingCount = pendingResult?.count || 0;
        } catch (error) {
            console.log('Pending count error:', error.message);
        }
        
        // Get recent count (last 7 days)
        let recentCount = 0;
        try {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            const weekAgoStr = weekAgo.toISOString().split('T')[0];
            
            const recentResult = await dbGet(`
                SELECT COUNT(*) as count 
                FROM fees 
                WHERE DATE(payment_date) >= ?
            `, [weekAgoStr]);
            recentCount = recentResult?.count || 0;
        } catch (error) {
            console.log('Recent count error:', error.message);
        }
        
        // Render the payment form
        res.render('fees/payment-form', {
            title: 'Record Payment',
            user: req.session.user,
            nextReceiptNumber: nextReceiptNumber,
            todayPayments: todayPayments || [],
            todayTotal: todayTotal,
            monthlyTotal: monthlyTotal,
            pendingCount: pendingCount,
            recentCount: recentCount,
            today: today
        });
        
    } catch (error) {
        console.error('❌ Payment form error:', error);
        // Fallback with minimal data
        res.render('fees/payment-form', {
            title: 'Record Payment',
            user: req.session.user,
            nextReceiptNumber: '0001',
            todayPayments: [],
            todayTotal: 0,
            monthlyTotal: 0,
            pendingCount: 0,
            recentCount: 0,
            today: new Date().toISOString().split('T')[0]
        });
    }
});

// GET /fees/transactions - View all transactions
router.get('/transactions', async (req, res) => {
    try {
        const transactions = await dbAll(`
            SELECT f.*, s.name as student_name, s.class
            FROM fees f
            LEFT JOIN students s ON f.student_id = s.id
            ORDER BY f.created_at DESC
            LIMIT 50
        `);
        
        res.render('fees/transactions', {
            title: 'Fee Transactions',
            user: req.session.user,
            transactions: transactions
        });
        
    } catch (error) {
        console.error('Transactions error:', error);
        res.status(500).send('Error loading transactions');
    }
});

// GET /fees/reports - Reports page
router.get('/reports', (req, res) => {
    res.render('fees/reports', {
        title: 'Fee Reports',
        user: req.session.user
    });
});

// GET /fees/outstanding - Outstanding balances
router.get('/outstanding', async (req, res) => {
    try {
        const outstanding = await dbAll(`
            SELECT s.id, s.name, s.class, s.admission_number, s.fee_amount,
                   COALESCE(SUM(f.amount_paid), 0) as total_paid,
                   s.fee_amount - COALESCE(SUM(f.amount_paid), 0) as balance
            FROM students s
            LEFT JOIN fees f ON s.id = f.student_id
            GROUP BY s.id, s.name, s.class, s.admission_number, s.fee_amount
            HAVING balance > 0
            ORDER BY balance DESC
        `);
        
        res.render('fees/outstanding', {
            title: 'Outstanding Balances',
            user: req.session.user,
            outstanding: outstanding
        });
        
    } catch (error) {
        console.error('Outstanding error:', error);
        res.status(500).send('Error loading outstanding balances');
    }
});

// ==================== API ENDPOINTS ====================

// Get all students for dropdown
router.get('/students/all', async (req, res) => {
    try {
        console.log('Loading students for dropdown...');
        
        const students = await dbAll(`
            SELECT id, name, class, fee_amount, admission_number,
                   guardian_name as parent_name, phone as parent_phone
            FROM students 
            ORDER BY name
        `);
        
        console.log(`Loaded ${students.length} students`);
        res.json(students);
        
    } catch (error) {
        console.error('Error loading students:', error);
        res.json([
            {
                id: 1,
                name: "Test Student",
                class: "Form 1",
                admission_number: "STU001",
                parent_name: "Parent",
                parent_phone: "0712 345 678",
                fee_amount: 15000
            }
        ]);
    }
});

// Get student details by ID
router.get('/student/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const student = await dbGet(`
            SELECT s.*, 
                   COALESCE(SUM(f.amount_paid), 0) as total_paid,
                   s.fee_amount - COALESCE(SUM(f.amount_paid), 0) as balance
            FROM students s
            LEFT JOIN fees f ON s.id = f.student_id
            WHERE s.id = ?
            GROUP BY s.id
        `, [id]);
        
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        res.json(student);
    } catch (error) {
        console.error('Student details error:', error);
        res.status(500).json({ error: 'Failed to load student details' });
    }
});

// POST /fees/payments - Save new payment (WORKING VERSION)
router.post('/payments', async (req, res) => {
    console.log('\n' + '='.repeat(60));
    console.log('💰 PAYMENT REQUEST RECEIVED');
    console.log('='.repeat(60));
    
    try {
        console.log('Request body:', req.body);
        
        // Check if body exists
        if (!req.body || Object.keys(req.body).length === 0) {
            console.log('❌ ERROR: Request body is empty!');
            return res.status(400).json({ 
                success: false, 
                message: 'No data received. Please fill the form.' 
            });
        }
        
        const {
            studentId,
            receiptNumber,
            amount,
            paymentDate,
            paymentMethod,
            notes,
            mpesaCode,
            phoneNumber,
            bankName,
            bankReference
        } = req.body;
        
        // Validate required fields
        if (!studentId || !receiptNumber || !amount || !paymentDate || !paymentMethod) {
            console.log('Missing fields:', { studentId, receiptNumber, amount, paymentDate, paymentMethod });
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields: Student, Receipt Number, Amount, Payment Date, Payment Method' 
            });
        }
        
        // Check for duplicate receipt number
        const existingReceipt = await dbGet(
            'SELECT id FROM fees WHERE receipt_number = ?',
            [receiptNumber]
        );
        
        if (existingReceipt) {
            return res.status(400).json({ 
                success: false, 
                message: 'Receipt number already exists. Please use a different receipt number.' 
            });
        }
        
        // Get student's total fee
        const student = await dbGet(
            'SELECT fee_amount FROM students WHERE id = ?',
            [studentId]
        );
        
        if (!student) {
            return res.status(404).json({ 
                success: false, 
                message: 'Student not found. Please select a valid student.' 
            });
        }
        
        // Calculate total paid so far
        const totalPaidResult = await dbGet(`
            SELECT COALESCE(SUM(amount_paid), 0) as total_paid 
            FROM fees 
            WHERE student_id = ?
        `, [studentId]);
        
        const totalPaid = totalPaidResult?.total_paid || 0;
        const amountNum = parseFloat(amount);
        const totalDueAmount = student.fee_amount || 15000;
        const newTotalPaid = totalPaid + amountNum;
        const balanceAmount = Math.max(0, totalDueAmount - newTotalPaid);
        const status = newTotalPaid >= totalDueAmount ? 'Paid' : 'Partial';
        
        console.log('Payment calculation:', {
            totalPaid,
            amountNum,
            totalDueAmount,
            newTotalPaid,
            balanceAmount,
            status
        });
        
        // Insert payment record
        await dbRun(`
            INSERT INTO fees (
                student_id, 
                receipt_number, 
                amount_paid,
                amount_due,
                payment_date, 
                payment_method, 
                status,
                balance,
                notes, 
                mpesa_code, 
                phone_number,
                bank_name, 
                bank_reference,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [
            studentId, 
            receiptNumber, 
            amountNum,
            totalDueAmount,
            paymentDate,
            paymentMethod, 
            status,
            balanceAmount,
            notes || null, 
            mpesaCode || null,
            phoneNumber || null, 
            bankName || null, 
            bankReference || null
        ]);
        
        console.log('✅ Payment saved successfully');
        
        res.json({
            success: true,
            message: 'Payment recorded successfully!',
            receiptNumber: receiptNumber,
            amount: amountNum,
            status: status,
            balance: balanceAmount
        });
        
    } catch (error) {
        console.error('❌ Save payment error:', error);
        console.error('Error stack:', error.stack);
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to save payment: ' + error.message 
        });
    }
});

// ==================== TEST & DEBUG ENDPOINTS ====================

// Test database connection
router.get('/test-db', async (req, res) => {
    try {
        const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
        
        // Check fees table columns
        const feeColumns = await dbAll("PRAGMA table_info(fees)");
        
        res.json({
            success: true,
            tables: tables,
            fees_columns: feeColumns.map(col => col.name),
            message: 'Database check completed'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test payment endpoint
router.post('/test-payment', async (req, res) => {
    console.log('Test payment endpoint:', req.body);
    res.json({
        success: true,
        message: 'Test endpoint working',
        received: req.body
    });
});

// List all available routes
router.get('/routes', (req, res) => {
    const routes = router.stack.map(layer => {
        if (layer.route) {
            return {
                path: layer.route.path,
                method: Object.keys(layer.route.methods)[0]
            };
        }
    }).filter(r => r);
    
    res.json({
        success: true,
        routes: routes,
        hasPaymentForm: routes.some(r => r.path === '/payment-form')
    });
});

// Redirect from /payment to /payment-form
router.get('/payment', (req, res) => {
    res.redirect('/fees/payment-form');
});

// Simple test endpoint
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Fees routes are working!',
        time: new Date().toISOString()
    });
});

module.exports = router;