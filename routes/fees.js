const express = require('express');
const router = express.Router();
const sqlite3 = require('better-sqlite3');
const path = require('path');

console.log('Fees routes loaded!');

// Initialize database connection
const db = new sqlite3(path.join(__dirname, '../database.sqlite'));

// Middleware to check authentication
function checkAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    next();
}

// Apply authentication check to all fee routes
router.use(checkAuth);

// GET /fees - Simple dashboard
router.get('/', (req, res) => {
    try {
        console.log('Fees dashboard accessed by:', req.session.user);
        
        // Get REAL data from database or show zeros
        let stats = {
            total_collected: 0,
            total_balance: 0,
            total_students: 0,
            total_transactions: 0
        };
        
        let recentFees = [];
        let outstanding = [];
        
        try {
            // Try to get real data from database
            // Total collected
            const totalCollected = db.prepare('SELECT COALESCE(SUM(amount_paid), 0) as total FROM fees').get();
            stats.total_collected = totalCollected.total || 0;
            
            // Total balance
            const totalBalance = db.prepare('SELECT COALESCE(SUM(balance), 0) as total FROM fees WHERE balance > 0').get();
            stats.total_balance = totalBalance.total || 0;
            
            // Total students with fee records
            const totalStudents = db.prepare('SELECT COUNT(DISTINCT student_id) as count FROM fees').get();
            stats.total_students = totalStudents.count || 0;
            
            // Total transactions
            const totalTransactions = db.prepare('SELECT COUNT(*) as count FROM fees').get();
            stats.total_transactions = totalTransactions.count || 0;
            
            // Recent fees
            recentFees = db.prepare(`
                SELECT f.*, s.name as student_name, s.class 
                FROM fees f 
                LEFT JOIN students s ON f.student_id = s.id 
                ORDER BY f.created_at DESC 
                LIMIT 10
            `).all();
            
            // Outstanding balances
            outstanding = db.prepare(`
                SELECT s.id, s.name, s.class, 
                       COALESCE(SUM(f.balance), 0) as total_balance,
                       COUNT(CASE WHEN f.balance > 0 THEN 1 END) as pending_payments
                FROM students s 
                LEFT JOIN fees f ON s.id = f.student_id AND f.balance > 0
                GROUP BY s.id, s.name, s.class
                HAVING total_balance > 0
                LIMIT 10
            `).all();
            
        } catch (dbError) {
            console.log('Database not ready or no data yet:', dbError.message);
            // Keep zeros if database error or no data
        }
        
        res.render('fees/dashboard', {
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

// GET /fees/payment-form - New Record Payment Form
router.get('/payment-form', async (req, res) => {
    try {
        console.log('Payment form accessed by:', req.session.user.username);
        
        // Get next receipt number
        let nextReceiptNumber = '0001';
        
        try {
            const result = db.prepare('SELECT MAX(receipt_number) as last_receipt FROM fees').get();
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
            todayPayments = db.prepare(`
                SELECT f.*, s.name as student_name 
                FROM fees f 
                JOIN students s ON f.student_id = s.id 
                WHERE DATE(f.payment_date) = ?
                ORDER BY f.created_at DESC 
                LIMIT 5
            `).all(today);
            
            const todayTotalResult = db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total 
                FROM fees 
                WHERE DATE(payment_date) = ?
            `).get(today);
            todayTotal = todayTotalResult.total || 0;
            
        } catch (dbError) {
            console.log('Could not fetch today stats:', dbError.message);
        }
        
        // Get monthly total
        let monthlyTotal = 0;
        try {
            const monthStart = new Date();
            monthStart.setDate(1);
            const monthStartStr = monthStart.toISOString().split('T')[0];
            
            const monthlyResult = db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total 
                FROM fees 
                WHERE DATE(payment_date) >= ?
            `).get(monthStartStr);
            monthlyTotal = monthlyResult.total || 0;
        } catch (error) {
            console.log('Monthly total error:', error.message);
        }
        
        // Get pending count
        let pendingCount = 0;
        try {
            const pendingResult = db.prepare(`
                SELECT COUNT(*) as count 
                FROM students 
                WHERE (fee_amount - COALESCE((SELECT SUM(amount) FROM fees WHERE student_id = students.id AND status = 'Paid'), 0)) > 0
            `).get();
            pendingCount = pendingResult.count || 0;
        } catch (error) {
            console.log('Pending count error:', error.message);
        }
        
        // Get recent count (last 7 days)
        let recentCount = 0;
        try {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            const weekAgoStr = weekAgo.toISOString().split('T')[0];
            
            const recentResult = db.prepare(`
                SELECT COUNT(*) as count 
                FROM fees 
                WHERE DATE(payment_date) >= ?
            `).get(weekAgoStr);
            recentCount = recentResult.count || 0;
        } catch (error) {
            console.log('Recent count error:', error.message);
        }
        
        // Render the payment form with all required data
        res.render('fees/payment-form', {
            title: 'Record Payment',
            user: req.session.user,
            nextReceiptNumber: nextReceiptNumber,
            todayPayments: todayPayments || [],
            todayTotal: todayTotal,
            monthlyTotal: monthlyTotal,
            pendingCount: pendingCount,
            recentCount: recentCount
        });
        
    } catch (error) {
        console.error('Payment form error:', error);
        // Fallback with minimal data
        res.render('fees/payment-form', {
            title: 'Record Payment',
            user: req.session.user,
            nextReceiptNumber: '0001',
            todayPayments: [],
            todayTotal: 0,
            monthlyTotal: 0,
            pendingCount: 0,
            recentCount: 0
        });
    }
});

// POST /fees/payments - Save new payment
router.post('/payments', async (req, res) => {
    try {
        console.log('Saving payment:', req.body);
        
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
            bankReference,
            chequeNumber,
            chequeBank
        } = req.body;
        
        // Validate required fields
        if (!studentId || !receiptNumber || !amount || !paymentDate) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields' 
            });
        }
        
        // Check for duplicate receipt number
        const existingReceipt = db.prepare(
            'SELECT id FROM fees WHERE receipt_number = ?'
        ).get(receiptNumber);
        
        if (existingReceipt) {
            return res.status(400).json({ 
                success: false, 
                message: 'Receipt number already exists' 
            });
        }
        
        // Get student's total fee
        const student = db.prepare(
            'SELECT fee_amount FROM students WHERE id = ?'
        ).get(studentId);
        
        if (!student) {
            return res.status(404).json({ 
                success: false, 
                message: 'Student not found' 
            });
        }
        
        // Calculate total paid so far
        const totalPaidResult = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) as total_paid 
            FROM fees 
            WHERE student_id = ? AND status = 'Paid'
        `).get(studentId);
        
        const totalPaid = totalPaidResult.total_paid || 0;
        const amountNum = parseFloat(amount);
        const totalDue = student.fee_amount || 0;
        const newTotalPaid = totalPaid + amountNum;
        const balance = totalDue - newTotalPaid;
        const status = amountNum >= totalDue ? 'Paid' : 
                      (amountNum > 0 ? 'Partial' : 'Pending');
        
        // Insert payment record
        const insert = db.prepare(`
            INSERT INTO fees (
                student_id, receipt_number, amount, payment_date, 
                payment_method, status, notes, mpesa_code, phone_number,
                bank_name, bank_reference, cheque_number, cheque_bank,
                total_due, balance, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `);
        
        insert.run(
            studentId, receiptNumber, amountNum, paymentDate,
            paymentMethod, status, notes || null, mpesaCode || null,
            phoneNumber || null, bankName || null, bankReference || null,
            chequeNumber || null, chequeBank || null, totalDue, balance
        );
        
        console.log('Payment saved successfully');
        
        // Return success response
        res.json({
            success: true,
            message: 'Payment recorded successfully',
            receiptNumber: receiptNumber,
            amount: amountNum,
            status: status,
            balance: balance
        });
        
    } catch (error) {
        console.error('Save payment error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to save payment: ' + error.message 
        });
    }
});

// Search students for payment
router.get('/search-students', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.length < 2) {
            return res.json([]);
        }
        
        const query = `
            SELECT s.*, 
                   COALESCE(SUM(f.amount), 0) as total_paid,
                   s.fee_amount as total_fee_due
            FROM students s
            LEFT JOIN fees f ON s.id = f.student_id AND f.status = 'Paid'
            WHERE s.name LIKE ? OR s.admission_number LIKE ? OR s.class LIKE ?
            GROUP BY s.id
            ORDER BY s.name
            LIMIT 10
        `;
        
        const searchTerm = `%${q}%`;
        const students = db.prepare(query).all(searchTerm, searchTerm, searchTerm);
        
        res.json(students);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get student fee details
router.get('/student-details/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            SELECT s.*, 
                   COALESCE(SUM(f.amount), 0) as total_paid,
                   s.fee_amount as total_fee_due
            FROM students s
            LEFT JOIN fees f ON s.id = f.student_id AND f.status = 'Paid'
            WHERE s.id = ?
            GROUP BY s.id
        `;
        
        const student = db.prepare(query).get(id);
        
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        res.json(student);
    } catch (error) {
        console.error('Student details error:', error);
        res.status(500).json({ error: 'Failed to load student details' });
    }
});

// Get payment statistics for sidebar
router.get('/payment-stats', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Today's payments
        const todayPayments = db.prepare(`
            SELECT f.*, s.name as student_name 
            FROM fees f
            JOIN students s ON f.student_id = s.id
            WHERE DATE(f.payment_date) = ?
            ORDER BY f.created_at DESC
            LIMIT 5
        `).all(today);
        
        // Today's total
        const todayTotal = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM fees 
            WHERE DATE(payment_date) = ?
        `).get(today);
        
        // Monthly total
        const monthStart = new Date();
        monthStart.setDate(1);
        const monthStartStr = monthStart.toISOString().split('T')[0];
        
        const monthlyTotal = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM fees 
            WHERE DATE(payment_date) >= ?
        `).get(monthStartStr);
        
        // Pending payments count
        const pendingCount = db.prepare(`
            SELECT COUNT(*) as count 
            FROM students 
            WHERE (fee_amount - COALESCE((SELECT SUM(amount) FROM fees WHERE student_id = students.id AND status = 'Paid'), 0)) > 0
        `).get();
        
        // Last 7 days count
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekAgoStr = weekAgo.toISOString().split('T')[0];
        
        const recentCount = db.prepare(`
            SELECT COUNT(*) as count 
            FROM fees 
            WHERE DATE(payment_date) >= ?
        `).get(weekAgoStr);
        
        res.json({
            todayPayments: todayPayments || [],
            todayTotal: todayTotal?.total || 0,
            monthlyTotal: monthlyTotal?.total || 0,
            pendingCount: pendingCount?.count || 0,
            recentCount: recentCount?.count || 0
        });
        
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ 
            error: 'Failed to load statistics',
            details: error.message 
        });
    }
});

// GET /fees/transactions - View all transactions
router.get('/transactions', (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        
        // Get total count
        const totalResult = db.prepare('SELECT COUNT(*) as total FROM fees').get();
        const total = totalResult.total || 0;
        
        // Get transactions
        const transactions = db.prepare(`
            SELECT f.*, s.name as student_name, s.class, s.admission_number
            FROM fees f
            LEFT JOIN students s ON f.student_id = s.id
            ORDER BY f.created_at DESC
            LIMIT ? OFFSET ?
        `).all(limit, offset);
        
        res.render('fees/transactions', {
            title: 'Fee Transactions',
            user: req.session.user,
            transactions: transactions,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            total: total
        });
        
    } catch (error) {
        console.error('Transactions error:', error);
        res.status(500).send('Error loading transactions');
    }
});

// GET /fees/reports - Fee reports
router.get('/reports', (req, res) => {
    try {
        res.render('fees/reports', {
            title: 'Fee Reports',
            user: req.session.user
        });
    } catch (error) {
        console.error('Reports error:', error);
        res.status(500).send('Error loading reports');
    }
});

// GET /fees/outstanding - Outstanding balances
router.get('/outstanding', (req, res) => {
    try {
        const outstanding = db.prepare(`
            SELECT s.id, s.name, s.class, s.admission_number, s.fee_amount,
                   COALESCE(SUM(f.amount), 0) as total_paid,
                   s.fee_amount - COALESCE(SUM(f.amount), 0) as balance
            FROM students s
            LEFT JOIN fees f ON s.id = f.student_id AND f.status = 'Paid'
            GROUP BY s.id, s.name, s.class, s.admission_number, s.fee_amount
            HAVING balance > 0
            ORDER BY balance DESC
        `).all();
        
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

module.exports = router;