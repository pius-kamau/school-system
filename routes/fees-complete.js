const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { createObjectCsvWriter } = require('csv-writer');
const ExcelJS = require('exceljs');

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
        db.run(query, params, function (err) {
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

            // Get recent fees (FIXED for single name column)
            recentFees = await dbAll(`
                SELECT f.*, COALESCE(s.name, 'Unknown Student') as student_name, s.class 
                FROM fees f 
                LEFT JOIN students s ON f.student_id = s.id 
                ORDER BY f.created_at DESC 
                LIMIT 10
            `);

            // Get outstanding balances (FIXED for single name column)
            outstanding = await dbAll(`
                SELECT s.id, COALESCE(s.name, 'Unknown Student') as name, s.class, s.admission_number,
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

// GET /fees/payment-form - RECORD PAYMENT FORM
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

        // Get today's payments for sidebar (FIXED for single name column)
        let todayPayments = [];
        let todayTotal = 0;

        try {
            todayPayments = await dbAll(`
                SELECT f.*, COALESCE(s.name, 'Unknown Student') as student_name 
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

        // Render the payment form
        res.render('fees/payment-form', {
            title: 'Record Payment',
            user: req.session.user,
            nextReceiptNumber: nextReceiptNumber,
            todayPayments: todayPayments || [],
            todayTotal: todayTotal,
            monthlyTotal: monthlyTotal,
            pendingCount: pendingCount,
            recentCount: 0,
            today: today,
            currentTerm: 'Term 1',
            academicYear: '2024'
        });

    } catch (error) {
        console.error('❌ Payment form error:', error);
        res.render('fees/payment-form', {
            title: 'Record Payment',
            user: req.session.user,
            nextReceiptNumber: '0001',
            todayPayments: [],
            todayTotal: 0,
            monthlyTotal: 0,
            pendingCount: 0,
            recentCount: 0,
            today: new Date().toISOString().split('T')[0],
            currentTerm: 'Term 1',
            academicYear: '2024'
        });
    }
});

// ==================== REDIRECTS ====================

// Redirect /fees/payment to /fees/payment-form
router.get('/payment', (req, res) => {
    console.log('Redirecting /fees/payment to /fees/payment-form');
    res.redirect('/fees/payment-form');
});

// ==================== OTHER PAGES ====================

// GET /fees/transactions
router.get('/transactions', async (req, res) => {
    try {
        const transactions = await dbAll(`
            SELECT f.*, COALESCE(s.name, 'Unknown Student') as student_name, s.class
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

// GET /fees/reports
router.get('/reports', (req, res) => {
    res.render('fees/reports', {
        title: 'Fee Reports',
        user: req.session.user
    });
});

// GET /fees/outstanding
router.get('/outstanding', async (req, res) => {
    try {
        const outstanding = await dbAll(`
            SELECT s.id, COALESCE(s.name, 'Unknown Student') as name, s.class, s.admission_number, s.fee_amount,
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

// GET /fees/students/all - Get all students for dropdown (FIXED CASE SENSITIVITY)
router.get('/students/all', async (req, res) => {
    try {
        console.log('Loading students for dropdown...');

        const students = await dbAll(`
            SELECT 
                id,
                name,
                COALESCE(admission_number, 'N/A') as admission_number,
                COALESCE(class, 'N/A') as class,
                COALESCE(fee_amount, 15000) as fee_amount,
                COALESCE(guardian_name, '') as parent_name,
                COALESCE(phone, '') as parent_phone,
                COALESCE(status, 'Active') as status
            FROM students 
            WHERE UPPER(COALESCE(status, 'Active')) = 'ACTIVE'
            ORDER BY name
        `);

        console.log(`Loaded ${students.length} active students`);
        
        // Add first_name and last_name fields (split from name)
        const formattedStudents = students.map(student => {
            const nameParts = student.name ? student.name.split(' ') : ['', ''];
            return {
                ...student,
                first_name: nameParts[0] || '',
                last_name: nameParts.slice(1).join(' ') || '',
                name: student.name || 'Unknown Student'
            };
        });

        res.json(formattedStudents);

    } catch (error) {
        console.error('Error loading students:', error);
        res.json([]);
    }
});

// POST /fees/payments - Save new payment (UPDATED WITH CATEGORIES)
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
            term,
            academicYear,
            categoryId,
            notes,
            mpesaCode,
            phoneNumber,
            bankName,
            bankReference
        } = req.body;

        // Validate required fields - INCLUDING categoryId
        if (!studentId || !receiptNumber || !amount || !paymentDate || !paymentMethod || !term || !categoryId) {
            console.log('Missing fields:', { studentId, receiptNumber, amount, paymentDate, paymentMethod, term, categoryId });
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: Student, Receipt Number, Amount, Payment Date, Payment Method, Term, Fee Category'
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

        // Get fee category details
        const category = await dbGet(
            'SELECT name, default_amount FROM fee_categories WHERE id = ? AND is_active = 1',
            [categoryId]
        );

        if (!category) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or inactive fee category. Please select a valid category.'
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

        // Calculate total paid for this category and student
        const totalPaidResult = await dbGet(`
            SELECT COALESCE(SUM(amount_paid), 0) as total_paid 
            FROM fees 
            WHERE student_id = ? AND category_id = ? AND term = ? AND academic_year = ?
        `, [studentId, categoryId, term, academicYear || '2026']);

        const totalPaid = totalPaidResult?.total_paid || 0;
        const amountNum = parseFloat(amount);
        const defaultAmount = category.default_amount || 0;
        const newTotalPaid = totalPaid + amountNum;
        const balanceAmount = Math.max(0, defaultAmount - newTotalPaid);
        const status = defaultAmount === 0 ? 'Paid' :
            (newTotalPaid >= defaultAmount ? 'Paid' :
                (newTotalPaid > 0 ? 'Partial' : 'Unpaid'));

        console.log('Payment calculation:', {
            category: category.name,
            totalPaid,
            amountNum,
            defaultAmount,
            newTotalPaid,
            balanceAmount,
            status
        });

        // Get current user ID for created_by
        const createdBy = req.session.user?.id || 1;

        // Insert payment record - UPDATED FOR YOUR TABLE STRUCTURE
        await dbRun(`
            INSERT INTO fees (
                student_id, 
                receipt_number, 
                amount_paid,
                amount_due,
                payment_date, 
                payment_method, 
                term,
                academic_year,
                category_id,
                fee_type,
                status,
                balance,
                notes, 
                mpesa_code, 
                phone_number,
                bank_name, 
                bank_reference,
                created_by,
                created_at,
                due_date  -- Added this missing column
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
        `, [
            studentId,
            receiptNumber,
            amountNum,
            defaultAmount,
            paymentDate,
            paymentMethod,
            term,
            academicYear || '2024-2025',  // Changed to match your default
            categoryId,
            category.name,
            status,
            balanceAmount,
            notes || null,
            mpesaCode || null,
            phoneNumber || null,
            bankName || null,
            bankReference || null,
            createdBy,
            paymentDate  // Use payment date as due date if not provided
        ]);

        console.log('✅ Payment saved successfully');

        res.json({
            success: true,
            message: `Payment for ${category.name} recorded successfully!`,
            receiptNumber: receiptNumber,
            amount: amountNum,
            category: category.name,
            status: status,
            balance: balanceAmount,
            term: term,
            receiptUrl: `/fees/receipt/${receiptNumber}`
        });

    } catch (error) {
        console.error('❌ Save payment error:', error);
        console.error('Error details:', error.message);

        // Handle specific constraint errors
        if (error.message.includes('NOT NULL constraint failed')) {
            const columnName = error.message.split('fees.')[1];
            return res.status(400).json({
                success: false,
                message: `Database error: Missing required column '${columnName}'. Please contact administrator.`
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to save payment: ' + error.message
        });
    }
});

// ==================== FIXED RECENT PAYMENTS ROUTES ====================

// GET /fees/recent-payments - Get recent payments for the sidebar (FIXED FOR SINGLE NAME COLUMN)
router.get('/recent-payments', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        console.log(`📋 [Recent Payments] Fetching payments for: ${today}`);

        const payments = await dbAll(`
            SELECT 
                f.id,
                f.receipt_number,
                f.amount_paid,
                f.payment_date,
                f.created_at,
                COALESCE(s.name, 'Unknown Student') as student_name
            FROM fees f
            LEFT JOIN students s ON f.student_id = s.id
            WHERE DATE(f.payment_date) = ?
            ORDER BY f.created_at DESC
            LIMIT 10
        `, [today]);

        console.log(`✅ [Recent Payments] Found ${payments.length} payments`);

        const totalResult = await dbGet(`
            SELECT COALESCE(SUM(amount_paid), 0) as total 
            FROM fees 
            WHERE DATE(payment_date) = ?
        `, [today]);

        res.json({
            success: true,
            payments: payments,
            total: totalResult?.total || 0,
            count: payments.length
        });

    } catch (error) {
        console.error('❌ [Recent Payments] Error:', error);
        res.json({
            success: false,
            payments: [],
            total: 0,
            count: 0
        });
    }
});

// GET /fees/test-recent-payments - Test recent payments format
router.get('/test-recent-payments', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        console.log(`Looking for payments for date: ${today}`);
        
        const payments = await dbAll(`
            SELECT 
                f.id,
                f.receipt_number,
                f.amount_paid,
                f.payment_date,
                f.created_at,
                s.name as student_name
            FROM fees f
            LEFT JOIN students s ON f.student_id = s.id
            WHERE DATE(f.payment_date) = ?
            ORDER BY f.created_at DESC
            LIMIT 10
        `, [today]);
        
        console.log(`Found ${payments.length} payments today`);
        
        if (payments.length > 0) {
            console.log('Sample payment:', payments[0]);
        }
        
        res.json({
            success: true,
            date: today,
            payments: payments,
            count: payments.length,
            sample_payment: payments.length > 0 ? payments[0] : null
        });
        
    } catch (error) {
        console.error('Test error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// GET /fees/outstanding-data - Get outstanding balances for sidebar (FIXED FOR SINGLE NAME COLUMN)
router.get('/outstanding-data', async (req, res) => {
    try {
        const outstanding = await dbAll(`
            SELECT s.id, COALESCE(s.name, 'Unknown Student') as name, s.class, s.admission_number,
                   COALESCE(SUM(f.balance), 0) as balance
            FROM students s
            LEFT JOIN fees f ON s.id = f.student_id
            GROUP BY s.id, s.name, s.class, s.admission_number
            HAVING balance > 0
            ORDER BY balance DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            outstanding: outstanding,
            count: outstanding.length
        });

    } catch (error) {
        console.error('Error fetching outstanding data:', error);
        res.json({
            success: false,
            outstanding: [],
            count: 0
        });
    }
});

// ==================== TEST & DEBUG ENDPOINTS ====================

// Test endpoint
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Fees routes are working!',
        time: new Date().toISOString()
    });
});

// Check database structure
router.get('/check-db', async (req, res) => {
    try {
        const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");

        // Check fees table columns
        const feeColumns = await dbAll("PRAGMA table_info(fees)");

        // Check which columns are NOT NULL
        const notNullColumns = feeColumns.filter(col => col.notnull === 1).map(col => col.name);

        res.json({
            success: true,
            tables: tables,
            fees_columns: feeColumns.map(col => ({
                name: col.name,
                type: col.type,
                not_null: col.notnull === 1,
                default_value: col.dflt_value
            })),
            required_columns: notNullColumns,
            message: 'Database check completed'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// List all routes
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
        routes: routes
    });
});

// GET /fees/test-db - Simple database test
router.get('/test-db', async (req, res) => {
    try {
        console.log("Testing database structure...");

        // Just check if fee_categories table exists
        const tableCheck = await dbGet(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='fee_categories'"
        );

        console.log("Table check result:", tableCheck);

        res.json({
            success: true,
            tableExists: !!tableCheck,
            tableName: tableCheck ? tableCheck.name : null,
            message: tableCheck ? 'fee_categories table exists!' : 'fee_categories table NOT found'
        });

    } catch (error) {
        console.error('Database test error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /fees/create-categories-table - Create the fee_categories table
router.get('/create-categories-table', async (req, res) => {
    try {
        console.log("Creating fee_categories table...");

        // Step 1: Create the table
        await dbRun(`
            CREATE TABLE IF NOT EXISTS fee_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(100) NOT NULL UNIQUE,
                description TEXT,
                default_amount DECIMAL(10,2),
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("✅ Table created successfully");

        // Step 2: Insert default categories
        await dbRun(`
            INSERT OR IGNORE INTO fee_categories (name, description, default_amount) VALUES 
            ('Tuition Fee', 'Main academic tuition fee', 15000.00),
            ('Library Fee', 'Library access and book rental', 2000.00),
            ('Sports Fee', 'Sports facilities and equipment', 1500.00),
            ('Laboratory Fee', 'Science lab equipment and materials', 3000.00),
            ('Examination Fee', 'Term and final examination fees', 1000.00),
            ('Transport Fee', 'School bus transportation', 5000.00),
            ('Hostel Fee', 'Boarding and accommodation', 10000.00),
            ('Activity Fee', 'Co-curricular activities', 1500.00),
            ('Development Fee', 'School development fund', 2000.00),
            ('Uniform Fee', 'School uniform cost', 3000.00)
        `);
        console.log("✅ Default categories inserted");

        // Step 3: Verify the data
        const categories = await dbAll("SELECT * FROM fee_categories");
        console.log("Total categories:", categories.length);

        res.json({
            success: true,
            message: 'Fee categories table created successfully!',
            categoriesCount: categories.length,
            categories: categories
        });

    } catch (error) {
        console.error('Error creating table:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /fees/add-category-column - Add category_id column to fees table
router.get('/add-category-column', async (req, res) => {
    try {
        console.log("Adding category_id column to fees table...");

        // Step 1: Check if column already exists
        const tableInfo = await dbAll("PRAGMA table_info(fees)");
        const hasCategoryId = tableInfo.some(col => col.name === 'category_id');

        if (hasCategoryId) {
            console.log("✅ category_id column already exists");
            return res.json({
                success: true,
                message: 'category_id column already exists in fees table',
                columns: tableInfo.map(col => col.name)
            });
        }

        // Step 2: Add the column
        await dbRun(`
            ALTER TABLE fees 
            ADD COLUMN category_id INTEGER REFERENCES fee_categories(id)
        `);
        console.log("✅ Added category_id column");

        // Step 3: Update existing records to use Tuition Fee category (id: 1)
        await dbRun(`
            UPDATE fees 
            SET category_id = 1 
            WHERE category_id IS NULL
        `);
        console.log("✅ Updated existing records to use Tuition Fee category");

        // Step 4: Verify
        const updatedInfo = await dbAll("PRAGMA table_info(fees)");
        const columnNames = updatedInfo.map(col => col.name);

        res.json({
            success: true,
            message: 'category_id column added to fees table successfully!',
            columns: columnNames,
            hasCategoryId: columnNames.includes('category_id')
        });

    } catch (error) {
        console.error('Error adding column:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /fees/verify-structure - Verify the complete structure
router.get('/verify-structure', async (req, res) => {
    try {
        console.log("Verifying database structure...");

        // 1. Check fee_categories
        const categories = await dbAll("SELECT id, name FROM fee_categories");

        // 2. Check fees table columns
        const feeColumns = await dbAll("PRAGMA table_info(fees)");
        const columnNames = feeColumns.map(col => col.name);

        // 3. Check sample data with category_id
        const sampleFees = await dbAll(`
            SELECT f.id, f.receipt_number, f.amount_paid, f.category_id, fc.name as category_name
            FROM fees f
            LEFT JOIN fee_categories fc ON f.category_id = fc.id
            LIMIT 5
        `);

        res.json({
            success: true,
            feeCategoriesCount: categories.length,
            feeCategories: categories,
            feesTableColumns: columnNames,
            hasCategoryIdColumn: columnNames.includes('category_id'),
            sampleFeeRecords: sampleFees,
            message: 'Database structure verification complete'
        });

    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /fees/categories/active - Get active categories only
router.get('/categories/active', async (req, res) => {
    try {
        const categories = await dbAll(`
            SELECT id, name, default_amount 
            FROM fee_categories 
            WHERE is_active = 1 
            ORDER BY name ASC
        `);

        res.json({
            success: true,
            categories: categories,
            count: categories.length
        });
    } catch (error) {
        console.error('Error fetching active categories:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch active categories'
        });
    }
});

// ========================================
// RECEIPT GENERATION (FIXED ERROR HANDLING)
// ========================================

// GET /fees/receipt/:receiptNumber - Generate receipt for a specific payment
router.get('/receipt/:receiptNumber', async (req, res) => {
    try {
        const { receiptNumber } = req.params;

        console.log(`Generating receipt for: ${receiptNumber}`);

        // Get payment details with student and category info (FIXED FOR SINGLE NAME COLUMN)
        const receipt = await dbGet(`
            SELECT 
                f.*,
                s.name,
                s.admission_number,
                s.class,
                fc.name as category_name
            FROM fees f
            LEFT JOIN students s ON f.student_id = s.id
            LEFT JOIN fee_categories fc ON f.category_id = fc.id
            WHERE f.receipt_number = ?
        `, [receiptNumber]);

        if (!receipt) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Receipt Not Found</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 50px; text-align: center; }
                        h1 { color: #dc3545; }
                        .container { max-width: 600px; margin: 0 auto; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>Receipt Not Found</h1>
                        <p>Receipt #${receiptNumber} was not found in the system.</p>
                        <a href="/fees/payment-form">Back to Payment Form</a>
                    </div>
                </body>
                </html>
            `);
        }

        // Get student info
        const student = {
            name: receipt.name,
            admission_number: receipt.admission_number,
            class: receipt.class
        };

        // Get category info
        const category = {
            name: receipt.category_name || receipt.fee_type || 'General Fee'
        };

        // Clean up receipt object
        delete receipt.name;
        delete receipt.admission_number;
        delete receipt.class;
        delete receipt.category_name;

        // Render receipt - MAKE SURE receipt-template.ejs is in views folder
        res.render('receipt-template', {
            title: `Receipt #${receiptNumber}`,
            receipt: receipt,
            student: student,
            category: category
        });

    } catch (error) {
        console.error('Error generating receipt:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error Generating Receipt</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 50px; text-align: center; }
                    h1 { color: #dc3545; }
                </style>
            </head>
            <body>
                <h1>Error Generating Receipt</h1>
                <p>An error occurred while generating the receipt. Please try again.</p>
                <a href="/fees/payment-form">Back to Payment Form</a>
            </body>
            </html>
        `);
    }
});

// GET /fees/receipt-by-id/:id - Generate receipt by payment ID
router.get('/receipt-by-id/:id', async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`Generating receipt for payment ID: ${id}`);

        const receipt = await dbGet(`
            SELECT 
                f.*,
                s.name,
                s.admission_number,
                s.class,
                fc.name as category_name
            FROM fees f
            LEFT JOIN students s ON f.student_id = s.id
            LEFT JOIN fee_categories fc ON f.category_id = fc.id
            WHERE f.id = ?
        `, [id]);

        if (!receipt) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Receipt Not Found</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 50px; text-align: center; }
                        h1 { color: #dc3545; }
                    </style>
                </head>
                <body>
                    <h1>Receipt Not Found</h1>
                    <p>Payment record with ID ${id} not found.</p>
                    <a href="/fees/payment-form">Back to Payment Form</a>
                </body>
                </html>
            `);
        }

        const student = {
            name: receipt.name,
            admission_number: receipt.admission_number,
            class: receipt.class
        };

        const category = {
            name: receipt.category_name || receipt.fee_type || 'General Fee'
        };

        delete receipt.name;
        delete receipt.admission_number;
        delete receipt.class;
        delete receipt.category_name;

        res.render('receipt-template', {
            title: `Receipt #${receipt.receipt_number}`,
            receipt: receipt,
            student: student,
            category: category
        });

    } catch (error) {
        console.error('Error generating receipt by ID:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error Generating Receipt</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 50px; text-align: center; }
                    h1 { color: #dc3545; }
                </style>
            </head>
            <body>
                <h1>Error Generating Receipt</h1>
                <p>An error occurred while generating the receipt.</p>
                <a href="/fees/payment-form">Back to Payment Form</a>
            </body>
            </html>
        `);
    }
});

// GET /fees/receipts/student/:studentId - Get all receipts for a student
router.get('/receipts/student/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;

        const receipts = await dbAll(`
            SELECT 
                f.id,
                f.receipt_number,
                f.amount_paid,
                f.payment_date,
                f.payment_method,
                f.term,
                f.academic_year,
                f.status,
                f.balance,
                fc.name as fee_category
            FROM fees f
            LEFT JOIN fee_categories fc ON f.category_id = fc.id
            WHERE f.student_id = ?
            ORDER BY f.payment_date DESC
        `, [studentId]);

        // Get student info (FIXED FOR SINGLE NAME COLUMN)
        const student = await dbGet(
            'SELECT name, admission_number, class FROM students WHERE id = ?',
            [studentId]
        );

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        res.json({
            success: true,
            student: student,
            receipts: receipts,
            count: receipts.length,
            total_paid: receipts.reduce((sum, r) => sum + parseFloat(r.amount_paid), 0)
        });

    } catch (error) {
        console.error('Error fetching student receipts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch student receipts'
        });
    }
});

// GET /fees/receipts/today - Get today's receipts
router.get('/receipts/today', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        const receipts = await dbAll(`
            SELECT 
                f.id,
                f.receipt_number,
                f.amount_paid,
                f.payment_date,
                f.payment_method,
                f.status,
                s.name as student_name,
                fc.name as fee_category
            FROM fees f
            LEFT JOIN students s ON f.student_id = s.id
            LEFT JOIN fee_categories fc ON f.category_id = fc.id
            WHERE DATE(f.payment_date) = ?
            ORDER BY f.created_at DESC
            LIMIT 20
        `, [today]);

        const total = receipts.reduce((sum, r) => sum + parseFloat(r.amount_paid), 0);

        res.json({
            success: true,
            receipts: receipts,
            count: receipts.length,
            total: total,
            date: today
        });

    } catch (error) {
        console.error('Error fetching today\'s receipts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch today\'s receipts'
        });
    }
});

// GET /fees/receipts/print-all - Print multiple receipts
router.get('/receipts/print-all', async (req, res) => {
    try {
        const { startDate, endDate, studentId } = req.query;

        let query = `
            SELECT 
                f.*,
                s.name,
                s.admission_number,
                s.class,
                fc.name as category_name
            FROM fees f
            LEFT JOIN students s ON f.student_id = s.id
            LEFT JOIN fee_categories fc ON f.category_id = fc.id
            WHERE 1=1
        `;

        const params = [];

        if (startDate) {
            query += ' AND f.payment_date >= ?';
            params.push(startDate);
        }

        if (endDate) {
            query += ' AND f.payment_date <= ?';
            params.push(endDate);
        }

        if (studentId) {
            query += ' AND f.student_id = ?';
            params.push(studentId);
        }

        query += ' ORDER BY f.payment_date DESC, f.receipt_number DESC';

        const receipts = await dbAll(query, params);

        // Group by receipt
        const groupedReceipts = receipts.map(receipt => {
            const student = {
                name: receipt.name,
                admission_number: receipt.admission_number,
                class: receipt.class
            };

            const category = {
                name: receipt.category_name || receipt.fee_type || 'General Fee'
            };

            // Clean up
            delete receipt.name;
            delete receipt.admission_number;
            delete receipt.class;
            delete receipt.category_name;

            return {
                receipt: receipt,
                student: student,
                category: category
            };
        });

        res.render('receipts-batch', {
            title: 'Batch Receipts',
            receipts: groupedReceipts,
            startDate: startDate,
            endDate: endDate,
            studentId: studentId,
            count: groupedReceipts.length
        });

    } catch (error) {
        console.error('Error generating batch receipts:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error Generating Receipts</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 50px; text-align: center; }
                    h1 { color: #dc3545; }
                </style>
            </head>
            <body>
                <h1>Error Generating Receipts</h1>
                <p>An error occurred while generating batch receipts.</p>
                <a href="/fees/payment-form">Back to Payment Form</a>
            </body>
            </html>
        `);
    }
});

// Debug: Check fees table structure
router.get('/debug/table-structure', async (req, res) => {
    try {
        const columns = await dbAll("PRAGMA table_info(fees)");

        // Show which columns are NOT NULL
        const notNullColumns = columns.filter(col => col.notnull === 1);
        const nullableColumns = columns.filter(col => col.notnull === 0);

        res.json({
            success: true,
            table: 'fees',
            all_columns: columns.map(col => ({
                name: col.name,
                type: col.type,
                not_null: col.notnull === 1,
                default_value: col.dflt_value,
                primary_key: col.pk === 1
            })),
            required_columns: notNullColumns.map(col => col.name),
            optional_columns: nullableColumns.map(col => col.name),
            message: `Found ${columns.length} columns in fees table`
        });

    } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// ==================== RESET COLLECTIONS ====================

// GET /fees/reset - Reset collections page
router.get('/reset', (req, res) => {
    res.render('fees/reset-collections', {
        title: 'Reset Collections',
        user: req.session.user
    });
});

// GET /fees/reset/stats - Get current statistics
router.get('/reset/stats', async (req, res) => {
    try {
        // Get total payments
        const paymentsResult = await dbGet('SELECT COUNT(*) as count FROM fees');
        const totalPayments = paymentsResult?.count || 0;
        
        // Get total collected
        const collectedResult = await dbGet('SELECT COALESCE(SUM(amount_paid), 0) as total FROM fees');
        const totalCollected = collectedResult?.total || 0;
        
        // Calculate average
        const averagePayment = totalPayments > 0 ? (totalCollected / totalPayments) : 0;
        
        res.json({
            success: true,
            total_payments: totalPayments,
            total_collected: totalCollected,
            average_payment: Math.round(averagePayment)
        });
    } catch (error) {
        console.error('Error getting reset stats:', error);
        res.json({
            success: false,
            message: 'Failed to load statistics'
        });
    }
});

// POST /fees/reset/perform - Perform the reset
router.post('/reset/perform', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('🔄 RESET REQUEST RECEIVED');
        console.log('Request body:', req.body);
        console.log('Requested by:', req.session.user?.username);
        console.log('='.repeat(60));
        
        const { reset_type, cutoff_date } = req.body;
        
        if (!reset_type) {
            return res.json({
                success: false,
                message: 'Reset type is required'
            });
        }
        
        let query = '';
        let params = [];
        let action = '';
        
        switch (reset_type) {
            case 'all':
                query = 'DELETE FROM fees';
                action = 'All payments';
                console.log('🔄 Resetting: ALL payments');
                break;
                
            case 'current_year':
                const currentYear = new Date().getFullYear();
                const yearPattern = `${currentYear}%`;
                query = 'DELETE FROM fees WHERE academic_year LIKE ?';
                params = [yearPattern];
                action = `Payments for year ${currentYear}`;
                console.log(`🔄 Resetting: Payments for year ${currentYear}`);
                break;
                
            case 'before_date':
                if (!cutoff_date) {
                    return res.json({
                        success: false,
                        message: 'Cutoff date is required for this reset type'
                    });
                }
                query = 'DELETE FROM fees WHERE payment_date < ?';
                params = [cutoff_date];
                action = `Payments before ${cutoff_date}`;
                console.log(`🔄 Resetting: Payments before ${cutoff_date}`);
                break;
                
            default:
                return res.json({
                    success: false,
                    message: 'Invalid reset type'
                });
        }
        
        // Get count before deletion for logging
        const countQuery = query.replace('DELETE', 'SELECT COUNT(*) as count');
        const countResult = await dbGet(countQuery, params);
        const recordsToDelete = countResult?.count || 0;
        
        console.log(`📊 Records to delete: ${recordsToDelete}`);
        
        if (recordsToDelete === 0) {
            return res.json({
                success: true,
                message: 'No records found to delete'
            });
        }
        
        // Perform the deletion
        const result = await dbRun(query, params);
        const deletedCount = result.changes;
        
        console.log(`✅ Deleted ${deletedCount} payment records`);
        
        // Update receipt numbers sequence if needed
        if (reset_type === 'all') {
            // When resetting all, we might want to reset receipt numbers
            // But we'll keep it as is for now - next receipt will continue from existing max
        }
        
        res.json({
            success: true,
            message: `${action} have been reset successfully. ${deletedCount} records deleted.`,
            deleted_count: deletedCount
        });
        
    } catch (error) {
        console.error('❌ Reset error:', error);
        res.json({
            success: false,
            message: 'Reset failed: ' + error.message
        });
    }
});

// POST /fees/reset/all - Quick reset all (for testing/emergency)
router.post('/reset/all', async (req, res) => {
    try {
        console.log('\n⚠️  EMERGENCY RESET ALL REQUESTED');
        console.log('Requested by:', req.session.user?.username);
        
        // Double-check with a confirmation code
        const { confirmation_code } = req.body;
        
        if (confirmation_code !== 'EMERGENCY_RESET_123') {
            return res.json({
                success: false,
                message: 'Invalid confirmation code'
            });
        }
        
        // Get count before deletion
        const countResult = await dbGet('SELECT COUNT(*) as count FROM fees');
        const totalRecords = countResult?.count || 0;
        
        // Delete all payments
        const result = await dbRun('DELETE FROM fees');
        const deletedCount = result.changes;
        
        console.log(`✅ Emergency reset: Deleted ${deletedCount} of ${totalRecords} records`);
        
        res.json({
            success: true,
            message: `Emergency reset complete. ${deletedCount} payment records deleted.`,
            deleted_count: deletedCount
        });
        
    } catch (error) {
        console.error('❌ Emergency reset error:', error);
        res.status(500).json({
            success: false,
            message: 'Emergency reset failed'
        });
    }
});
// ==================== BACKUP & RESET SYSTEM ====================

// GET /fees/backup - Backup management page
router.get('/backup', (req, res) => {
    res.render('fees/backup', {
        title: 'Backup & Restore',
        user: req.session.user
    });
});

// GET /fees/reset - Reset collections page (with backup option)
router.get('/reset', (req, res) => {
    res.render('fees/reset-collections', {
        title: 'Reset Collections',
        user: req.session.user
    });
});

// GET /fees/backup/create - Create a new backup
router.get('/backup/create', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('💾 CREATING BACKUP');
        console.log('Requested by:', req.session.user?.username);
        console.log('='.repeat(60));
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(__dirname, '../backups');
        
        // Create backups directory if it doesn't exist
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        // 1. Create full database backup
        const dbBackupPath = path.join(backupDir, `database-backup-${timestamp}.sqlite`);
        fs.copyFileSync(dbPath, dbBackupPath);
        console.log(`✅ Database backup created: ${dbBackupPath}`);
        
        // 2. Create SQL dump
        const sqlDumpPath = path.join(backupDir, `sql-dump-${timestamp}.sql`);
        await createSqlDump(sqlDumpPath);
        console.log(`✅ SQL dump created: ${sqlDumpPath}`);
        
        // 3. Create JSON backup
        const jsonBackupPath = path.join(backupDir, `json-backup-${timestamp}.json`);
        await createJsonBackup(jsonBackupPath);
        console.log(`✅ JSON backup created: ${jsonBackupPath}`);
        
        // 4. Create CSV backups
        const csvDir = path.join(backupDir, `csv-backup-${timestamp}`);
        if (!fs.existsSync(csvDir)) {
            fs.mkdirSync(csvDir, { recursive: true });
        }
        await createCsvBackups(csvDir);
        console.log(`✅ CSV backups created in: ${csvDir}`);
        
        // Get backup size
        const dbSize = fs.statSync(dbBackupPath).size;
        const sqlSize = fs.statSync(sqlDumpPath).size;
        const jsonSize = fs.statSync(jsonBackupPath).size;
        
        res.json({
            success: true,
            message: 'Backup created successfully!',
            backups: [
                { type: 'Database', path: dbBackupPath, size: formatBytes(dbSize) },
                { type: 'SQL Dump', path: sqlDumpPath, size: formatBytes(sqlSize) },
                { type: 'JSON Data', path: jsonBackupPath, size: formatBytes(jsonSize) },
                { type: 'CSV Files', path: csvDir, size: 'Multiple files' }
            ],
            timestamp: timestamp,
            total_size: formatBytes(dbSize + sqlSize + jsonSize)
        });
        
    } catch (error) {
        console.error('❌ Backup error:', error);
        res.status(500).json({
            success: false,
            message: 'Backup failed: ' + error.message
        });
    }
});

// GET /fees/backup/list - List all available backups
router.get('/backup/list', async (req, res) => {
    try {
        const backupDir = path.join(__dirname, '../backups');
        
        if (!fs.existsSync(backupDir)) {
            return res.json({
                success: true,
                backups: [],
                message: 'No backups found'
            });
        }
        
        const files = fs.readdirSync(backupDir);
        const backups = [];
        
        // Group backups by timestamp
        const backupGroups = {};
        
        files.forEach(file => {
            const match = file.match(/(backup|dump)-([^\.]+)/);
            if (match) {
                const timestamp = match[2];
                if (!backupGroups[timestamp]) {
                    backupGroups[timestamp] = {
                        timestamp: timestamp,
                        date: formatTimestamp(timestamp),
                        files: []
                    };
                }
                
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                
                backupGroups[timestamp].files.push({
                    name: file,
                    path: filePath,
                    size: formatBytes(stats.size),
                    type: getFileType(file),
                    created: stats.mtime
                });
            }
        });
        
        // Convert to array and sort by date (newest first)
        const sortedBackups = Object.values(backupGroups)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Check disk space
        const diskInfo = getDiskInfo(backupDir);
        
        res.json({
            success: true,
            backups: sortedBackups,
            disk_info: diskInfo,
            count: sortedBackups.length
        });
        
    } catch (error) {
        console.error('❌ List backups error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to list backups'
        });
    }
});

// GET /fees/backup/download/:filename - Download a backup file
router.get('/backup/download/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const backupDir = path.join(__dirname, '../backups');
        const filePath = path.join(backupDir, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                message: 'Backup file not found'
            });
        }
        
        res.download(filePath, filename, (err) => {
            if (err) {
                console.error('Download error:', err);
            }
        });
        
    } catch (error) {
        console.error('❌ Download error:', error);
        res.status(500).json({
            success: false,
            message: 'Download failed'
        });
    }
});

// POST /fees/backup/restore - Restore from backup
router.post('/backup/restore', async (req, res) => {
    try {
        const { backup_file } = req.body;
        
        if (!backup_file) {
            return res.json({
                success: false,
                message: 'Backup file is required'
            });
        }
        
        const backupDir = path.join(__dirname, '../backups');
        const backupPath = path.join(backupDir, backup_file);
        
        if (!fs.existsSync(backupPath)) {
            return res.json({
                success: false,
                message: 'Backup file not found'
            });
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('🔄 RESTORING FROM BACKUP');
        console.log('Backup file:', backup_file);
        console.log('Requested by:', req.session.user?.username);
        console.log('='.repeat(60));
        
        // Create a backup before restoring (safety measure)
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safetyBackupPath = path.join(backupDir, `pre-restore-safety-${timestamp}.sqlite`);
        fs.copyFileSync(dbPath, safetyBackupPath);
        console.log(`✅ Safety backup created: ${safetyBackupPath}`);
        
        // Restore based on file type
        let restoreMessage = '';
        
        if (backup_file.endsWith('.sqlite')) {
            // Restore entire database
            fs.copyFileSync(backupPath, dbPath);
            restoreMessage = 'Database restored successfully from SQLite backup';
            console.log('✅ Database restored from SQLite file');
            
        } else if (backup_file.endsWith('.sql')) {
            // Restore from SQL dump
            await restoreFromSqlDump(backupPath);
            restoreMessage = 'Database restored successfully from SQL dump';
            console.log('✅ Database restored from SQL dump');
            
        } else if (backup_file.endsWith('.json')) {
            // Restore from JSON backup
            await restoreFromJsonBackup(backupPath);
            restoreMessage = 'Data restored successfully from JSON backup';
            console.log('✅ Data restored from JSON backup');
            
        } else {
            return res.json({
                success: false,
                message: 'Unsupported backup file format'
            });
        }
        
        res.json({
            success: true,
            message: restoreMessage,
            safety_backup: path.basename(safetyBackupPath),
            restored_file: backup_file
        });
        
    } catch (error) {
        console.error('❌ Restore error:', error);
        res.status(500).json({
            success: false,
            message: 'Restore failed: ' + error.message
        });
    }
});

// DELETE /fees/backup/delete/:filename - Delete a backup file
router.delete('/backup/delete/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const backupDir = path.join(__dirname, '../backups');
        const filePath = path.join(backupDir, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                message: 'Backup file not found'
            });
        }
        
        fs.unlinkSync(filePath);
        console.log(`🗑️  Backup deleted: ${filename}`);
        
        res.json({
            success: true,
            message: 'Backup file deleted successfully'
        });
        
    } catch (error) {
        console.error('❌ Delete backup error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete backup'
        });
    }
});

// GET /fees/reset/stats - Get current statistics for reset page
router.get('/reset/stats', async (req, res) => {
    try {
        // Get total payments
        const paymentsResult = await dbGet('SELECT COUNT(*) as count FROM fees');
        const totalPayments = paymentsResult?.count || 0;
        
        // Get total collected
        const collectedResult = await dbGet('SELECT COALESCE(SUM(amount_paid), 0) as total FROM fees');
        const totalCollected = collectedResult?.total || 0;
        
        // Calculate average
        const averagePayment = totalPayments > 0 ? (totalCollected / totalPayments) : 0;
        
        // Get oldest and newest payment dates
        const datesResult = await dbGet(`
            SELECT 
                MIN(payment_date) as oldest,
                MAX(payment_date) as newest
            FROM fees
        `);
        
        res.json({
            success: true,
            total_payments: totalPayments,
            total_collected: totalCollected,
            average_payment: Math.round(averagePayment),
            date_range: {
                oldest: datesResult?.oldest || 'N/A',
                newest: datesResult?.newest || 'N/A'
            }
        });
    } catch (error) {
        console.error('Error getting reset stats:', error);
        res.json({
            success: false,
            message: 'Failed to load statistics'
        });
    }
});

// POST /fees/reset/perform - Perform reset with backup option
router.post('/reset/perform', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('🔄 RESET REQUEST WITH BACKUP');
        console.log('Request body:', req.body);
        console.log('Requested by:', req.session.user?.username);
        console.log('='.repeat(60));
        
        const { reset_type, cutoff_date, create_backup } = req.body;
        
        if (!reset_type) {
            return res.json({
                success: false,
                message: 'Reset type is required'
            });
        }
        
        // Create backup if requested
        let backupInfo = null;
        if (create_backup === 'true') {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = path.join(__dirname, '../backups');
            
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            
            const backupPath = path.join(backupDir, `pre-reset-backup-${timestamp}.sqlite`);
            fs.copyFileSync(dbPath, backupPath);
            
            backupInfo = {
                path: backupPath,
                filename: path.basename(backupPath),
                size: formatBytes(fs.statSync(backupPath).size)
            };
            
            console.log(`✅ Pre-reset backup created: ${backupPath}`);
        }
        
        // Perform the reset
        let query = '';
        let params = [];
        let action = '';
        
        switch (reset_type) {
            case 'all':
                query = 'DELETE FROM fees';
                action = 'All payments';
                console.log('🔄 Resetting: ALL payments');
                break;
                
            case 'current_year':
                const currentYear = new Date().getFullYear();
                const yearPattern = `${currentYear}%`;
                query = 'DELETE FROM fees WHERE academic_year LIKE ?';
                params = [yearPattern];
                action = `Payments for year ${currentYear}`;
                console.log(`🔄 Resetting: Payments for year ${currentYear}`);
                break;
                
            case 'before_date':
                if (!cutoff_date) {
                    return res.json({
                        success: false,
                        message: 'Cutoff date is required for this reset type'
                    });
                }
                query = 'DELETE FROM fees WHERE payment_date < ?';
                params = [cutoff_date];
                action = `Payments before ${cutoff_date}`;
                console.log(`🔄 Resetting: Payments before ${cutoff_date}`);
                break;
                
            default:
                return res.json({
                    success: false,
                    message: 'Invalid reset type'
                });
        }
        
        // Get count before deletion
        const countQuery = query.replace('DELETE', 'SELECT COUNT(*) as count');
        const countResult = await dbGet(countQuery, params);
        const recordsToDelete = countResult?.count || 0;
        
        console.log(`📊 Records to delete: ${recordsToDelete}`);
        
        if (recordsToDelete === 0) {
            return res.json({
                success: true,
                message: 'No records found to delete',
                backup_created: backupInfo ? true : false,
                backup: backupInfo
            });
        }
        
        // Perform the deletion
        const result = await dbRun(query, params);
        const deletedCount = result.changes;
        
        console.log(`✅ Deleted ${deletedCount} payment records`);
        
        res.json({
            success: true,
            message: `${action} have been reset successfully. ${deletedCount} records deleted.`,
            deleted_count: deletedCount,
            backup_created: backupInfo ? true : false,
            backup: backupInfo
        });
        
    } catch (error) {
        console.error('❌ Reset error:', error);
        res.json({
            success: false,
            message: 'Reset failed: ' + error.message
        });
    }
});

// POST /fees/reset/all - Quick reset all (emergency - requires backup)
router.post('/reset/all', async (req, res) => {
    try {
        console.log('\n⚠️  EMERGENCY RESET ALL REQUESTED');
        console.log('Requested by:', req.session.user?.username);
        
        // Require backup before emergency reset
        const { confirmation_code, skip_backup } = req.body;
        
        if (confirmation_code !== 'EMERGENCY_RESET_123') {
            return res.json({
                success: false,
                message: 'Invalid confirmation code'
            });
        }
        
        // Create mandatory backup unless explicitly skipped
        let backupInfo = null;
        if (skip_backup !== 'true') {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = path.join(__dirname, '../backups');
            
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            
            const backupPath = path.join(backupDir, `emergency-pre-reset-${timestamp}.sqlite`);
            fs.copyFileSync(dbPath, backupPath);
            
            backupInfo = {
                path: backupPath,
                filename: path.basename(backupPath),
                size: formatBytes(fs.statSync(backupPath).size)
            };
            
            console.log(`✅ Mandatory emergency backup created: ${backupPath}`);
        }
        
        // Get count before deletion
        const countResult = await dbGet('SELECT COUNT(*) as count FROM fees');
        const totalRecords = countResult?.count || 0;
        
        // Delete all payments
        const result = await dbRun('DELETE FROM fees');
        const deletedCount = result.changes;
        
        console.log(`✅ Emergency reset: Deleted ${deletedCount} of ${totalRecords} records`);
        
        res.json({
            success: true,
            message: `Emergency reset complete. ${deletedCount} payment records deleted.`,
            deleted_count: deletedCount,
            backup_created: backupInfo ? true : false,
            backup: backupInfo,
            warning: skip_backup === 'true' ? 'WARNING: No backup was created!' : null
        });
        
    } catch (error) {
        console.error('❌ Emergency reset error:', error);
        res.status(500).json({
            success: false,
            message: 'Emergency reset failed'
        });
    }
});

// ==================== HELPER FUNCTIONS ====================

// Helper function to create SQL dump
async function createSqlDump(outputPath) {
    return new Promise((resolve, reject) => {
        const dump = [];
        
        // Get all tables
        db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, tables) => {
            if (err) {
                reject(err);
                return;
            }
            
            let tablesProcessed = 0;
            
            tables.forEach(table => {
                const tableName = table.name;
                
                // Get table schema
                db.all(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, [tableName], (err, schemas) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    if (schemas.length > 0 && schemas[0].sql) {
                        dump.push(schemas[0].sql + ';');
                        dump.push('');
                    }
                    
                    // Get table data
                    db.all(`SELECT * FROM ${tableName}`, (err, rows) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        
                        if (rows.length > 0) {
                            rows.forEach(row => {
                                const columns = Object.keys(row);
                                const values = columns.map(col => {
                                    const value = row[col];
                                    if (value === null) return 'NULL';
                                    if (typeof value === 'number') return value;
                                    return `'${value.toString().replace(/'/g, "''")}'`;
                                });
                                
                                dump.push(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values.join(', ')});`);
                            });
                            dump.push('');
                        }
                        
                        tablesProcessed++;
                        
                        if (tablesProcessed === tables.length) {
                            fs.writeFileSync(outputPath, dump.join('\n'));
                            resolve();
                        }
                    });
                });
            });
            
            if (tables.length === 0) {
                fs.writeFileSync(outputPath, '-- No tables found in database\n');
                resolve();
            }
        });
    });
}

// Helper function to create JSON backup
async function createJsonBackup(outputPath) {
    const backupData = {};
    
    // Get all tables
    const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    
    for (const table of tables) {
        const rows = await dbAll(`SELECT * FROM ${table.name}`);
        backupData[table.name] = {
            count: rows.length,
            data: rows
        };
    }
    
    backupData.metadata = {
        backup_timestamp: new Date().toISOString(),
        database_version: '1.0',
        tables_count: tables.length,
        total_records: Object.values(backupData).reduce((sum, table) => sum + (table.count || 0), 0)
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(backupData, null, 2));
}

// Helper function to create CSV backups
async function createCsvBackups(outputDir) {
    const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    
    for (const table of tables) {
        const rows = await dbAll(`SELECT * FROM ${table.name}`);
        
        if (rows.length > 0) {
            const columns = Object.keys(rows[0]);
            const csvContent = [
                columns.join(','),
                ...rows.map(row => 
                    columns.map(col => {
                        const value = row[col];
                        if (value === null) return '';
                        if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
                        return value;
                    }).join(',')
                )
            ].join('\n');
            
            fs.writeFileSync(path.join(outputDir, `${table.name}.csv`), csvContent);
        }
    }
}

// Helper function to restore from SQL dump
async function restoreFromSqlDump(sqlPath) {
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    const statements = sqlContent.split(';').filter(stmt => stmt.trim());
    
    // Execute each statement
    for (const stmt of statements) {
        if (stmt.trim()) {
            await dbRun(stmt);
        }
    }
}

// Helper function to restore from JSON backup
async function restoreFromJsonBackup(jsonPath) {
    const backupData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    // First, clear existing data (optional - you might want to merge instead)
    const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    
    for (const table of tables) {
        if (table.name !== 'sqlite_sequence') { // Don't delete sequence table
            await dbRun(`DELETE FROM ${table.name}`);
        }
    }
    
    // Restore data for each table
    for (const [tableName, tableData] of Object.entries(backupData)) {
        if (tableName === 'metadata') continue;
        
        if (tableData.data && tableData.data.length > 0) {
            for (const row of tableData.data) {
                const columns = Object.keys(row);
                const values = columns.map(col => row[col]);
                const placeholders = columns.map(() => '?').join(', ');
                
                await dbRun(
                    `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
                    values
                );
            }
        }
    }
}

// Helper function to format bytes to human readable
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper function to format timestamp
function formatTimestamp(timestamp) {
    try {
        const date = new Date(timestamp.replace(/-/g, ':').replace('T', ' ').split('.')[0]);
        return date.toLocaleString();
    } catch (e) {
        return timestamp;
    }
}

// Helper function to get file type
function getFileType(filename) {
    if (filename.endsWith('.sqlite')) return 'Database';
    if (filename.endsWith('.sql')) return 'SQL Dump';
    if (filename.endsWith('.json')) return 'JSON Data';
    if (filename.endsWith('.csv')) return 'CSV File';
    return 'Other';
}

// Helper function to get disk info
function getDiskInfo(path) {
    try {
        const stats = fs.statfsSync ? fs.statfsSync(path) : null;
        if (stats) {
            const total = stats.bsize * stats.blocks;
            const free = stats.bsize * stats.bavail;
            const used = total - free;
            
            return {
                total: formatBytes(total),
                free: formatBytes(free),
                used: formatBytes(used),
                used_percentage: ((used / total) * 100).toFixed(1)
            };
        }
    } catch (error) {
        console.log('Could not get disk info:', error.message);
    }
    
    return { total: 'Unknown', free: 'Unknown', used: 'Unknown', used_percentage: 'Unknown' };
}
// ==================== REPORTS SYSTEM ====================

// GET /fees/reports - Reports main page
router.get('/reports', (req, res) => {
    res.render('fees/reports', {
        title: 'Fee Reports & Analytics',
        user: req.session.user
    });
});

// GET /fees/reports/academic-years - Get all academic years from fees
router.get('/reports/academic-years', async (req, res) => {
    try {
        const years = await dbAll(`
            SELECT DISTINCT academic_year 
            FROM fees 
            WHERE academic_year IS NOT NULL 
            ORDER BY academic_year DESC
        `);
        
        res.json({
            success: true,
            years: years.map(row => row.academic_year)
        });
    } catch (error) {
        console.error('Error fetching academic years:', error);
        res.json({
            success: false,
            years: []
        });
    }
});

// GET /fees/reports/student-classes - Get all unique student classes
router.get('/reports/student-classes', async (req, res) => {
    try {
        const classes = await dbAll(`
            SELECT DISTINCT class 
            FROM students 
            WHERE class IS NOT NULL AND class != ''
            ORDER BY class
        `);
        
        res.json({
            success: true,
            classes: classes.map(row => row.class)
        });
    } catch (error) {
        console.error('Error fetching student classes:', error);
        res.json({
            success: false,
            classes: []
        });
    }
});

// POST /fees/reports/generate - Generate report based on filters
router.post('/reports/generate', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('📊 REPORT GENERATION REQUEST');
        console.log('Request body:', req.body);
        console.log('Requested by:', req.session.user?.username);
        console.log('='.repeat(60));
        
        const {
            report_type,
            date_range,
            start_date,
            end_date,
            academic_year,
            term,
            fee_category,
            payment_status,
            payment_method,
            student_class,
            sort_by
        } = req.body;
        
        // Build WHERE clause based on filters
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        // Date range filter
        if (date_range && date_range !== 'all') {
            const now = new Date();
            let startDate, endDate;
            
            switch (date_range) {
                case 'today':
                    startDate = endDate = now.toISOString().split('T')[0];
                    break;
                case 'yesterday':
                    const yesterday = new Date(now);
                    yesterday.setDate(now.getDate() - 1);
                    startDate = endDate = yesterday.toISOString().split('T')[0];
                    break;
                case 'this_week':
                    const weekStart = new Date(now);
                    weekStart.setDate(now.getDate() - now.getDay());
                    startDate = weekStart.toISOString().split('T')[0];
                    endDate = now.toISOString().split('T')[0];
                    break;
                case 'last_week':
                    const lastWeekStart = new Date(now);
                    lastWeekStart.setDate(now.getDate() - now.getDay() - 7);
                    const lastWeekEnd = new Date(lastWeekStart);
                    lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
                    startDate = lastWeekStart.toISOString().split('T')[0];
                    endDate = lastWeekEnd.toISOString().split('T')[0];
                    break;
                case 'this_month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                    endDate = now.toISOString().split('T')[0];
                    break;
                case 'last_month':
                    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    startDate = lastMonth.toISOString().split('T')[0];
                    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
                    endDate = lastMonthEnd.toISOString().split('T')[0];
                    break;
                case 'this_year':
                    startDate = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
                    endDate = now.toISOString().split('T')[0];
                    break;
                case 'last_year':
                    const lastYear = now.getFullYear() - 1;
                    startDate = new Date(lastYear, 0, 1).toISOString().split('T')[0];
                    endDate = new Date(lastYear, 11, 31).toISOString().split('T')[0];
                    break;
                case 'custom':
                    startDate = start_date;
                    endDate = end_date;
                    break;
            }
            
            if (startDate && endDate) {
                whereClause += ' AND f.payment_date BETWEEN ? AND ?';
                params.push(startDate, endDate);
            }
        }
        
        // Academic year filter
        if (academic_year && academic_year !== 'all') {
            whereClause += ' AND f.academic_year = ?';
            params.push(academic_year);
        }
        
        // Term filter
        if (term && term !== 'all') {
            whereClause += ' AND f.term = ?';
            params.push(term);
        }
        
        // Fee category filter
        if (fee_category && fee_category !== 'all') {
            whereClause += ' AND f.category_id = ?';
            params.push(fee_category);
        }
        
        // Payment status filter
        if (payment_status && payment_status !== 'all') {
            whereClause += ' AND f.status = ?';
            params.push(payment_status);
        }
        
        // Payment method filter
        if (payment_method && payment_method !== 'all') {
            whereClause += ' AND f.payment_method = ?';
            params.push(payment_method);
        }
        
        // Student class filter
        if (student_class && student_class !== 'all') {
            whereClause += ' AND s.class = ?';
            params.push(student_class);
        }
        
        // Build ORDER BY clause
        let orderByClause = 'ORDER BY ';
        switch (sort_by) {
            case 'date_asc':
                orderByClause += 'f.payment_date ASC';
                break;
            case 'amount_desc':
                orderByClause += 'f.amount_paid DESC';
                break;
            case 'amount_asc':
                orderByClause += 'f.amount_paid ASC';
                break;
            case 'student_asc':
                orderByClause += 's.name ASC';
                break;
            case 'student_desc':
                orderByClause += 's.name DESC';
                break;
            default: // date_desc
                orderByClause += 'f.payment_date DESC';
        }
        
        // Generate report based on type
        let reportData = {};
        
        switch (report_type) {
            case 'daily_collection':
                reportData = await generateDailyCollectionReport(whereClause, params, orderByClause);
                break;
            case 'monthly_summary':
                reportData = await generateMonthlySummaryReport(whereClause, params);
                break;
            case 'student_ledger':
                reportData = await generateStudentLedgerReport(whereClause, params, orderByClause);
                break;
            case 'category_wise':
                reportData = await generateCategoryWiseReport(whereClause, params);
                break;
            case 'outstanding_report':
                reportData = await generateOutstandingReport(whereClause, params, orderByClause);
                break;
            case 'receipt_register':
                reportData = await generateReceiptRegisterReport(whereClause, params, orderByClause);
                break;
            case 'class_performance':
                reportData = await generateClassPerformanceReport(whereClause, params);
                break;
            case 'payment_method':
                reportData = await generatePaymentMethodReport(whereClause, params);
                break;
            default:
                return res.json({
                    success: false,
                    message: 'Invalid report type'
                });
        }
        
        console.log(`✅ Report generated: ${report_type}, Records: ${reportData.summary?.total_records || 0}`);
        
        res.json({
            success: true,
            report_type: report_type,
            ...reportData
        });
        
    } catch (error) {
        console.error('❌ Report generation error:', error);
        res.status(500).json({
            success: false,
            message: 'Report generation failed: ' + error.message
        });
    }
});

// GET /fees/reports/export - Export report in various formats
router.get('/reports/export', async (req, res) => {
    try {
        const { export_format, report_type, ...filters } = req.query;
        
        // Generate report data first
        const reportResponse = await generateReportData(report_type, filters);
        
        if (!reportResponse.success) {
            return res.status(400).send('Failed to generate report data');
        }
        
        // Export based on format
        switch (export_format) {
            case 'csv':
                return exportToCSV(res, reportResponse.data, report_type);
            case 'pdf':
                return exportToPDF(res, reportResponse, report_type);
            case 'excel':
                return exportToExcel(res, reportResponse.data, report_type);
            default:
                return res.status(400).send('Unsupported export format');
        }
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).send('Export failed: ' + error.message);
    }
});

// Helper function to generate report data
async function generateReportData(report_type, filters) {
    // Similar to the POST /generate logic but returns data
    // This is a simplified version - implement based on your needs
    return { success: true, data: [] };
}

// Helper function to export to CSV
function exportToCSV(res, data, reportType) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${reportType}-report-${timestamp}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Convert data to CSV
    if (data.length === 0) {
        res.write('No data available\n');
        return res.end();
    }
    
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => 
        Object.values(row).map(value => 
            `"${String(value || '').replace(/"/g, '""')}"`
        ).join(',')
    );
    
    res.write(headers + '\n');
    res.write(rows.join('\n'));
    res.end();
}

// Helper function to export to PDF
function exportToPDF(res, reportData, reportType) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${reportType}-report-${timestamp}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // In a real implementation, you would use a PDF library like pdfkit
    // For now, we'll return a simple message
    res.send('PDF export would be generated here. Install pdfkit for actual PDF generation.');
}

// Helper function to export to Excel
function exportToExcel(res, data, reportType) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${reportType}-report-${timestamp}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // In a real implementation, you would use a library like exceljs
    // For now, we'll return a simple message
    res.send('Excel export would be generated here. Install exceljs for actual Excel generation.');
}

// ==================== REPORT GENERATION FUNCTIONS ====================

async function generateDailyCollectionReport(whereClause, params, orderByClause) {
    // Base query for all payments
    const baseQuery = `
        SELECT 
            f.id,
            f.receipt_number,
            f.payment_date,
            s.name as student_name,
            s.class,
            s.admission_number,
            fc.name as fee_category,
            f.amount_paid,
            f.amount_due,
            f.balance,
            f.status,
            f.payment_method,
            f.term,
            f.academic_year,
            f.created_at
        FROM fees f
        LEFT JOIN students s ON f.student_id = s.id
        LEFT JOIN fee_categories fc ON f.category_id = fc.id
        ${whereClause}
        ${orderByClause}
    `;
    
    const payments = await dbAll(baseQuery, params);
    
    // Get summary statistics
    const summaryQuery = `
        SELECT 
            COUNT(*) as total_records,
            COALESCE(SUM(f.amount_paid), 0) as total_collected,
            COALESCE(SUM(f.amount_due), 0) as total_due,
            COALESCE(SUM(f.balance), 0) as total_balance
        FROM fees f
        ${whereClause}
    `;
    
    const summary = await dbGet(summaryQuery, params);
    
    // Get daily totals for chart
    const dailyTotalsQuery = `
        SELECT 
            payment_date,
            COUNT(*) as payment_count,
            COALESCE(SUM(amount_paid), 0) as daily_total
        FROM fees
        ${whereClause}
        GROUP BY payment_date
        ORDER BY payment_date
    `;
    
    const dailyTotals = await dbAll(dailyTotalsQuery, params);
    
    // Prepare chart data
    const charts = [];
    if (dailyTotals.length > 0) {
        charts.push({
            type: 'line',
            title: 'Daily Collection Trend',
            labels: dailyTotals.map(row => row.payment_date),
            datasets: [{
                label: 'Daily Collection (KSh)',
                data: dailyTotals.map(row => row.daily_total),
                borderColor: '#4361ee',
                backgroundColor: 'rgba(67, 97, 238, 0.1)',
                fill: true
            }]
        });
    }
    
    // Get category breakdown for chart
    const categoryBreakdownQuery = `
        SELECT 
            fc.name as category,
            COUNT(*) as payment_count,
            COALESCE(SUM(f.amount_paid), 0) as category_total
        FROM fees f
        LEFT JOIN fee_categories fc ON f.category_id = fc.id
        ${whereClause}
        GROUP BY fc.name
        ORDER BY category_total DESC
    `;
    
    const categoryBreakdown = await dbAll(categoryBreakdownQuery, params);
    
    if (categoryBreakdown.length > 0) {
        charts.push({
            type: 'pie',
            title: 'Collection by Category',
            labels: categoryBreakdown.map(row => row.category),
            datasets: [{
                data: categoryBreakdown.map(row => row.category_total),
                backgroundColor: [
                    '#4361ee', '#4cc9f0', '#7209b7', '#f8961e', 
                    '#f72585', '#2a9d8f', '#4895ef', '#9d4edd'
                ]
            }]
        });
    }
    
    return {
        summary: {
            total_records: summary.total_records,
            total_collected: summary.total_collected,
            total_due: summary.total_due,
            total_balance: summary.total_balance,
            average_per_payment: summary.total_records > 0 ? summary.total_collected / summary.total_records : 0
        },
        charts: charts,
        data: payments
    };
}

async function generateMonthlySummaryReport(whereClause, params) {
    // Query to get monthly totals
    const monthlyQuery = `
        SELECT 
            strftime('%Y-%m', payment_date) as month,
            COUNT(*) as payment_count,
            COALESCE(SUM(amount_paid), 0) as monthly_total,
            COALESCE(SUM(amount_due), 0) as monthly_due,
            COALESCE(SUM(balance), 0) as monthly_balance
        FROM fees
        ${whereClause}
        GROUP BY strftime('%Y-%m', payment_date)
        ORDER BY month DESC
    `;
    
    const monthlyData = await dbAll(monthlyQuery, params);
    
    // Summary statistics
    const summaryQuery = `
        SELECT 
            COUNT(*) as total_records,
            COALESCE(SUM(amount_paid), 0) as total_collected,
            COALESCE(SUM(amount_due), 0) as total_due,
            COALESCE(SUM(balance), 0) as total_balance,
            MIN(payment_date) as earliest_date,
            MAX(payment_date) as latest_date
        FROM fees
        ${whereClause}
    `;
    
    const summary = await dbGet(summaryQuery, params);
    
    // Prepare charts
    const charts = [];
    if (monthlyData.length > 0) {
        charts.push({
            type: 'bar',
            title: 'Monthly Collection Summary',
            labels: monthlyData.map(row => row.month),
            datasets: [
                {
                    label: 'Collected (KSh)',
                    data: monthlyData.map(row => row.monthly_total),
                    backgroundColor: '#4361ee'
                },
                {
                    label: 'Balance (KSh)',
                    data: monthlyData.map(row => row.monthly_balance),
                    backgroundColor: '#f72585'
                }
            ]
        });
    }
    
    return {
        summary: {
            total_records: summary.total_records,
            total_collected: summary.total_collected,
            total_due: summary.total_due,
            total_balance: summary.total_balance,
            date_range: {
                from: summary.earliest_date,
                to: summary.latest_date
            }
        },
        charts: charts,
        data: monthlyData
    };
}

async function generateStudentLedgerReport(whereClause, params, orderByClause) {
    // Get student summary first
    const studentSummaryQuery = `
        SELECT 
            s.id,
            s.name as student_name,
            s.admission_number,
            s.class,
            s.fee_amount as annual_fee,
            COUNT(f.id) as total_payments,
            COALESCE(SUM(f.amount_paid), 0) as total_paid,
            s.fee_amount - COALESCE(SUM(f.amount_paid), 0) as current_balance,
            MAX(f.payment_date) as last_payment_date
        FROM students s
        LEFT JOIN fees f ON s.id = f.student_id
        ${whereClause.replace('f.', 's.')}
        GROUP BY s.id, s.name, s.admission_number, s.class, s.fee_amount
        HAVING total_payments > 0 OR ? = 1
        ORDER BY s.name
    `;
    
    const studentSummary = await dbAll(studentSummaryQuery, [1]); // Include all students
    
    // Get detailed transactions for each student
    const detailedData = [];
    for (const student of studentSummary) {
        const studentPaymentsQuery = `
            SELECT 
                f.receipt_number,
                f.payment_date,
                fc.name as fee_category,
                f.amount_paid,
                f.amount_due,
                f.balance,
                f.status,
                f.payment_method,
                f.term,
                f.academic_year
            FROM fees f
            LEFT JOIN fee_categories fc ON f.category_id = fc.id
            WHERE f.student_id = ?
            ORDER BY f.payment_date DESC
        `;
        
        const payments = await dbAll(studentPaymentsQuery, [student.id]);
        
        detailedData.push({
            student_info: student,
            payments: payments
        });
    }
    
    // Summary statistics
    const totalStudents = studentSummary.length;
    const totalPaid = studentSummary.reduce((sum, student) => sum + student.total_paid, 0);
    const totalBalance = studentSummary.reduce((sum, student) => sum + (student.current_balance > 0 ? student.current_balance : 0), 0);
    
    return {
        summary: {
            total_students: totalStudents,
            total_paid: totalPaid,
            total_balance: totalBalance,
            students_with_balance: studentSummary.filter(s => s.current_balance > 0).length
        },
        data: detailedData,
        student_summary: studentSummary
    };
}

async function generateCategoryWiseReport(whereClause, params) {
    const categoryQuery = `
        SELECT 
            fc.id,
            fc.name as category_name,
            fc.default_amount,
            COUNT(f.id) as payment_count,
            COALESCE(SUM(f.amount_paid), 0) as total_collected,
            COALESCE(SUM(f.amount_due), 0) as total_due,
            COALESCE(SUM(f.balance), 0) as total_balance,
            COALESCE(AVG(f.amount_paid), 0) as average_payment
        FROM fee_categories fc
        LEFT JOIN fees f ON fc.id = f.category_id
        ${whereClause.replace('f.', 'fc.')}
        GROUP BY fc.id, fc.name, fc.default_amount
        ORDER BY total_collected DESC
    `;
    
    const categoryData = await dbAll(categoryQuery, params);
    
    // Summary
    const totalCategories = categoryData.length;
    const totalCollected = categoryData.reduce((sum, cat) => sum + cat.total_collected, 0);
    
    // Chart data
    const charts = [];
    if (categoryData.length > 0) {
        charts.push({
            type: 'bar',
            title: 'Collection by Fee Category',
            labels: categoryData.map(row => row.category_name),
            datasets: [{
                label: 'Total Collected (KSh)',
                data: categoryData.map(row => row.total_collected),
                backgroundColor: '#4361ee'
            }]
        });
        
        charts.push({
            type: 'doughnut',
            title: 'Category Distribution',
            labels: categoryData.map(row => row.category_name),
            datasets: [{
                data: categoryData.map(row => row.total_collected),
                backgroundColor: [
                    '#4361ee', '#4cc9f0', '#7209b7', '#f8961e', 
                    '#f72585', '#2a9d8f', '#4895ef', '#9d4edd',
                    '#ff9e00', '#06d6a0'
                ]
            }]
        });
    }
    
    return {
        summary: {
            total_categories: totalCategories,
            total_collected: totalCollected,
            average_per_category: totalCategories > 0 ? totalCollected / totalCategories : 0
        },
        charts: charts,
        data: categoryData
    };
}

async function generateOutstandingReport(whereClause, params, orderByClause) {
    const outstandingQuery = `
        SELECT 
            s.id,
            s.name as student_name,
            s.admission_number,
            s.class,
            s.guardian_name,
            s.phone as guardian_phone,
            COUNT(f.id) as total_payments,
            COALESCE(SUM(f.amount_paid), 0) as total_paid,
            s.fee_amount as annual_fee,
            s.fee_amount - COALESCE(SUM(f.amount_paid), 0) as outstanding_balance,
            MAX(f.payment_date) as last_payment_date,
            CASE 
                WHEN (s.fee_amount - COALESCE(SUM(f.amount_paid), 0)) <= 0 THEN 'Paid'
                WHEN (s.fee_amount - COALESCE(SUM(f.amount_paid), 0)) > 0 
                     AND (s.fee_amount - COALESCE(SUM(f.amount_paid), 0)) < s.fee_amount THEN 'Partial'
                ELSE 'Unpaid'
            END as payment_status
        FROM students s
        LEFT JOIN fees f ON s.id = f.student_id
        WHERE s.status = 'Active'
        GROUP BY s.id, s.name, s.admission_number, s.class, s.guardian_name, s.phone, s.fee_amount
        HAVING outstanding_balance > 0
        ORDER BY outstanding_balance DESC
    `;
    
    const outstandingData = await dbAll(outstandingQuery);
    
    // Summary statistics
    const totalStudents = outstandingData.length;
    const totalOutstanding = outstandingData.reduce((sum, student) => sum + student.outstanding_balance, 0);
    const averageOutstanding = totalStudents > 0 ? totalOutstanding / totalStudents : 0;
    
    // Class-wise breakdown
    const classBreakdownQuery = `
        SELECT 
            s.class,
            COUNT(*) as student_count,
            SUM(s.fee_amount - COALESCE(SUM(f.amount_paid), 0)) as class_outstanding
        FROM students s
        LEFT JOIN fees f ON s.id = f.student_id
        WHERE s.status = 'Active'
        GROUP BY s.class
        HAVING class_outstanding > 0
        ORDER BY class_outstanding DESC
    `;
    
    const classBreakdown = await dbAll(classBreakdownQuery);
    
    // Charts
    const charts = [];
    if (classBreakdown.length > 0) {
        charts.push({
            type: 'bar',
            title: 'Outstanding by Class',
            labels: classBreakdown.map(row => row.class || 'Not Specified'),
            datasets: [{
                label: 'Outstanding Amount (KSh)',
                data: classBreakdown.map(row => row.class_outstanding),
                backgroundColor: '#f72585'
            }]
        });
    }
    
    return {
        summary: {
            total_students: totalStudents,
            total_outstanding: totalOutstanding,
            average_outstanding: averageOutstanding,
            highest_outstanding: outstandingData.length > 0 ? Math.max(...outstandingData.map(s => s.outstanding_balance)) : 0
        },
        charts: charts,
        data: outstandingData,
        class_breakdown: classBreakdown
    };
}

async function generateReceiptRegisterReport(whereClause, params, orderByClause) {
    const receiptQuery = `
        SELECT 
            f.id,
            f.receipt_number,
            f.payment_date,
            s.name as student_name,
            s.admission_number,
            s.class,
            fc.name as fee_category,
            f.amount_paid,
            f.amount_due,
            f.balance,
            f.status,
            f.payment_method,
            f.term,
            f.academic_year,
            f.created_at,
            f.created_by,
            f.mpesa_code,
            f.phone_number,
            f.bank_name,
            f.bank_reference,
            f.notes
        FROM fees f
        LEFT JOIN students s ON f.student_id = s.id
        LEFT JOIN fee_categories fc ON f.category_id = fc.id
        ${whereClause}
        ${orderByClause}
    `;
    
    const receiptData = await dbAll(receiptQuery, params);
    
    // Summary
    const totalReceipts = receiptData.length;
    const totalAmount = receiptData.reduce((sum, receipt) => sum + receipt.amount_paid, 0);
    
    // Daily receipt count
    const dailyReceiptQuery = `
        SELECT 
            payment_date,
            COUNT(*) as receipt_count,
            SUM(amount_paid) as daily_total
        FROM fees
        ${whereClause}
        GROUP BY payment_date
        ORDER BY payment_date
    `;
    
    const dailyData = await dbAll(dailyReceiptQuery, params);
    
    // Charts
    const charts = [];
    if (dailyData.length > 0) {
        charts.push({
            type: 'line',
            title: 'Daily Receipt Issuance',
            labels: dailyData.map(row => row.payment_date),
            datasets: [
                {
                    label: 'Number of Receipts',
                    data: dailyData.map(row => row.receipt_count),
                    borderColor: '#4361ee',
                    yAxisID: 'y'
                },
                {
                    label: 'Amount (KSh)',
                    data: dailyData.map(row => row.daily_total),
                    borderColor: '#f72585',
                    yAxisID: 'y1'
                }
            ]
        });
    }
    
    return {
        summary: {
            total_receipts: totalReceipts,
            total_amount: totalAmount,
            average_per_receipt: totalReceipts > 0 ? totalAmount / totalReceipts : 0,
            receipt_range: receiptData.length > 0 ? 
                `${receiptData[receiptData.length - 1].receipt_number} - ${receiptData[0].receipt_number}` : 
                'N/A'
        },
        charts: charts,
        data: receiptData
    };
}

async function generateClassPerformanceReport(whereClause, params) {
    const classQuery = `
        SELECT 
            s.class,
            COUNT(DISTINCT s.id) as student_count,
            COUNT(f.id) as payment_count,
            COALESCE(SUM(f.amount_paid), 0) as total_collected,
            COALESCE(AVG(f.amount_paid), 0) as average_payment,
            COALESCE(SUM(s.fee_amount), 0) as total_annual_fee,
            COALESCE(SUM(s.fee_amount - COALESCE(SUM(f.amount_paid), 0)), 0) as total_outstanding
        FROM students s
        LEFT JOIN fees f ON s.id = f.student_id
        WHERE s.status = 'Active' AND s.class IS NOT NULL AND s.class != ''
        GROUP BY s.class
        ORDER BY total_collected DESC
    `;
    
    const classData = await dbAll(classQuery);
    
    // Calculate collection percentage
    classData.forEach(cls => {
        cls.collection_percentage = cls.total_annual_fee > 0 ? 
            (cls.total_collected / cls.total_annual_fee) * 100 : 0;
        cls.collection_percentage = Math.round(cls.collection_percentage * 100) / 100;
    });
    
    // Summary
    const totalClasses = classData.length;
    const totalCollected = classData.reduce((sum, cls) => sum + cls.total_collected, 0);
    const averageCollection = totalClasses > 0 ? totalCollected / totalClasses : 0;
    
    // Charts
    const charts = [];
    if (classData.length > 0) {
        charts.push({
            type: 'bar',
            title: 'Collection by Class',
            labels: classData.map(row => row.class || 'Not Specified'),
            datasets: [{
                label: 'Total Collected (KSh)',
                data: classData.map(row => row.total_collected),
                backgroundColor: '#4361ee'
            }]
        });
        
        charts.push({
            type: 'bar',
            title: 'Collection Percentage by Class',
            labels: classData.map(row => row.class || 'Not Specified'),
            datasets: [{
                label: 'Collection %',
                data: classData.map(row => row.collection_percentage),
                backgroundColor: '#4cc9f0'
            }],
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            }
        });
    }
    
    return {
        summary: {
            total_classes: totalClasses,
            total_collected: totalCollected,
            average_collection: averageCollection,
            best_performing_class: classData.length > 0 ? classData[0].class : 'N/A',
            best_collection: classData.length > 0 ? classData[0].total_collected : 0
        },
        charts: charts,
        data: classData
    };
}

async function generatePaymentMethodReport(whereClause, params) {
    const methodQuery = `
        SELECT 
            payment_method,
            COUNT(*) as transaction_count,
            COALESCE(SUM(amount_paid), 0) as total_amount,
            COALESCE(AVG(amount_paid), 0) as average_amount,
            MIN(payment_date) as first_transaction,
            MAX(payment_date) as last_transaction
        FROM fees
        WHERE payment_method IS NOT NULL AND payment_method != ''
        GROUP BY payment_method
        ORDER BY total_amount DESC
    `;
    
    const methodData = await dbAll(methodQuery);
    
    // Summary
    const totalMethods = methodData.length;
    const totalTransactions = methodData.reduce((sum, method) => sum + method.transaction_count, 0);
    const totalAmount = methodData.reduce((sum, method) => sum + method.total_amount, 0);
    
    // Charts
    const charts = [];
    if (methodData.length > 0) {
        charts.push({
            type: 'pie',
            title: 'Transactions by Payment Method',
            labels: methodData.map(row => row.payment_method),
            datasets: [{
                data: methodData.map(row => row.transaction_count),
                backgroundColor: [
                    '#4361ee', '#4cc9f0', '#7209b7', '#f8961e', 
                    '#f72585', '#2a9d8f'
                ]
            }]
        });
        
        charts.push({
            type: 'doughnut',
            title: 'Amount by Payment Method',
            labels: methodData.map(row => row.payment_method),
            datasets: [{
                data: methodData.map(row => row.total_amount),
                backgroundColor: [
                    '#4361ee', '#4cc9f0', '#7209b7', '#f8961e', 
                    '#f72585', '#2a9d8f'
                ]
            }]
        });
    }
    
    // Monthly trend by payment method
    const monthlyTrendQuery = `
        SELECT 
            strftime('%Y-%m', payment_date) as month,
            payment_method,
            COUNT(*) as transaction_count,
            COALESCE(SUM(amount_paid), 0) as monthly_amount
        FROM fees
        WHERE payment_method IS NOT NULL AND payment_method != ''
        GROUP BY strftime('%Y-%m', payment_date), payment_method
        ORDER BY month, payment_method
    `;
    
    const monthlyTrend = await dbAll(monthlyTrendQuery);
    
    if (monthlyTrend.length > 0) {
        // Group by month for line chart
        const months = [...new Set(monthlyTrend.map(row => row.month))];
        const methods = [...new Set(monthlyTrend.map(row => row.payment_method))];
        
        const datasets = methods.map((method, index) => {
            const data = months.map(month => {
                const row = monthlyTrend.find(r => r.month === month && r.payment_method === method);
                return row ? row.monthly_amount : 0;
            });
            
            const colors = ['#4361ee', '#4cc9f0', '#7209b7', '#f8961e', '#f72585'];
            return {
                label: method,
                data: data,
                borderColor: colors[index % colors.length],
                fill: false
            };
        });
        
        charts.push({
            type: 'line',
            title: 'Monthly Trend by Payment Method',
            labels: months,
            datasets: datasets
        });
    }
    
    return {
        summary: {
            total_methods: totalMethods,
            total_transactions: totalTransactions,
            total_amount: totalAmount,
            most_popular_method: methodData.length > 0 ? methodData[0].payment_method : 'N/A',
            most_popular_count: methodData.length > 0 ? methodData[0].transaction_count : 0
        },
        charts: charts,
        data: methodData,
        monthly_trend: monthlyTrend
    };
}
// ==================== EXPORT FUNCTIONS ====================

// GET /fees/reports/export - Export report in various formats
router.get('/reports/export', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('📤 EXPORT REQUEST');
        console.log('Query params:', req.query);
        console.log('Requested by:', req.session.user?.username);
        console.log('='.repeat(60));
        
        const { 
            export_format, 
            report_type,
            date_range,
            start_date,
            end_date,
            academic_year,
            term,
            fee_category,
            payment_status,
            payment_method,
            student_class,
            sort_by
        } = req.query;
        
        // Generate report data first
        const reportData = await generateExportData(req.query);
        
        if (!reportData.success) {
            return res.status(400).send(reportData.message || 'Failed to generate report data');
        }
        
        // Export based on format
        switch (export_format) {
            case 'csv':
                return await exportToCSV(res, reportData, report_type);
            case 'excel':
                return await exportToExcel(res, reportData, report_type);
            case 'pdf':
                return await exportToPDF(res, reportData, report_type);
            default:
                return res.status(400).send('Unsupported export format');
        }
        
    } catch (error) {
        console.error('❌ Export error:', error);
        res.status(500).send('Export failed: ' + error.message);
    }
});

// Helper function to generate data for export
async function generateExportData(filters) {
    try {
        const {
            report_type,
            date_range,
            start_date,
            end_date,
            academic_year,
            term,
            fee_category,
            payment_status,
            payment_method,
            student_class,
            sort_by
        } = filters;
        
        // Build WHERE clause based on filters (same as in generate report)
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        // Date range filter
        if (date_range && date_range !== 'all') {
            const now = new Date();
            let startDate, endDate;
            
            switch (date_range) {
                case 'today':
                    startDate = endDate = now.toISOString().split('T')[0];
                    break;
                case 'yesterday':
                    const yesterday = new Date(now);
                    yesterday.setDate(now.getDate() - 1);
                    startDate = endDate = yesterday.toISOString().split('T')[0];
                    break;
                case 'this_week':
                    const weekStart = new Date(now);
                    weekStart.setDate(now.getDate() - now.getDay());
                    startDate = weekStart.toISOString().split('T')[0];
                    endDate = now.toISOString().split('T')[0];
                    break;
                case 'last_week':
                    const lastWeekStart = new Date(now);
                    lastWeekStart.setDate(now.getDate() - now.getDay() - 7);
                    const lastWeekEnd = new Date(lastWeekStart);
                    lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
                    startDate = lastWeekStart.toISOString().split('T')[0];
                    endDate = lastWeekEnd.toISOString().split('T')[0];
                    break;
                case 'this_month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                    endDate = now.toISOString().split('T')[0];
                    break;
                case 'last_month':
                    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    startDate = lastMonth.toISOString().split('T')[0];
                    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
                    endDate = lastMonthEnd.toISOString().split('T')[0];
                    break;
                case 'this_year':
                    startDate = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
                    endDate = now.toISOString().split('T')[0];
                    break;
                case 'last_year':
                    const lastYear = now.getFullYear() - 1;
                    startDate = new Date(lastYear, 0, 1).toISOString().split('T')[0];
                    endDate = new Date(lastYear, 11, 31).toISOString().split('T')[0];
                    break;
                case 'custom':
                    startDate = start_date;
                    endDate = end_date;
                    break;
            }
            
            if (startDate && endDate) {
                whereClause += ' AND f.payment_date BETWEEN ? AND ?';
                params.push(startDate, endDate);
            }
        }
        
        // Build ORDER BY clause
        let orderByClause = 'ORDER BY ';
        switch (sort_by) {
            case 'date_asc':
                orderByClause += 'f.payment_date ASC';
                break;
            case 'amount_desc':
                orderByClause += 'f.amount_paid DESC';
                break;
            case 'amount_asc':
                orderByClause += 'f.amount_paid ASC';
                break;
            case 'student_asc':
                orderByClause += 's.name ASC';
                break;
            case 'student_desc':
                orderByClause += 's.name DESC';
                break;
            default: // date_desc
                orderByClause += 'f.payment_date DESC';
        }
        
        // Base query for payments data
        const query = `
            SELECT 
                f.receipt_number as "Receipt Number",
                f.payment_date as "Payment Date",
                s.name as "Student Name",
                s.admission_number as "Admission Number",
                s.class as "Class",
                fc.name as "Fee Category",
                f.amount_paid as "Amount Paid",
                f.amount_due as "Amount Due",
                f.balance as "Balance",
                f.status as "Status",
                f.payment_method as "Payment Method",
                f.term as "Term",
                f.academic_year as "Academic Year",
                f.mpesa_code as "MPesa Code",
                f.phone_number as "Phone Number",
                f.bank_name as "Bank Name",
                f.bank_reference as "Bank Reference",
                f.created_at as "Recorded At"
            FROM fees f
            LEFT JOIN students s ON f.student_id = s.id
            LEFT JOIN fee_categories fc ON f.category_id = fc.id
            ${whereClause}
            ${orderByClause}
        `;
        
        const data = await dbAll(query, params);
        
        // Get summary stats
        const summaryQuery = `
            SELECT 
                COUNT(*) as total_records,
                COALESCE(SUM(f.amount_paid), 0) as total_collected,
                COALESCE(SUM(f.amount_due), 0) as total_due,
                COALESCE(SUM(f.balance), 0) as total_balance
            FROM fees f
            ${whereClause}
        `;
        
        const summary = await dbGet(summaryQuery, params);
        
        return {
            success: true,
            data: data,
            summary: summary,
            filters: filters,
            generated_at: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('Error generating export data:', error);
        return {
            success: false,
            message: 'Failed to generate export data: ' + error.message
        };
    }
}

// Helper function to export to CSV
async function exportToCSV(res, reportData, reportType) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `fee-report-${reportType}-${timestamp}.csv`;
        
        // Create CSV writer
        const csvWriter = createObjectCsvWriter({
            path: path.join(__dirname, `../temp/${filename}`),
            header: Object.keys(reportData.data[0] || {}).map(key => ({
                id: key,
                title: key
            }))
        });
        
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Write data to CSV file
        await csvWriter.writeRecords(reportData.data);
        
        // Send file
        res.download(
            path.join(__dirname, `../temp/${filename}`),
            filename,
            (err) => {
                // Clean up temp file
                setTimeout(() => {
                    try {
                        fs.unlinkSync(path.join(__dirname, `../temp/${filename}`));
                    } catch (cleanupError) {
                        console.log('Could not delete temp file:', cleanupError.message);
                    }
                }, 1000);
                
                if (err) {
                    console.error('Download error:', err);
                }
            }
        );
        
    } catch (error) {
        console.error('CSV export error:', error);
        res.status(500).send('CSV export failed: ' + error.message);
    }
}

// Helper function to export to Excel
async function exportToExcel(res, reportData, reportType) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `fee-report-${reportType}-${timestamp}.xlsx`;
        
        // Create a new workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'School Management System';
        workbook.created = new Date();
        
        // Add a worksheet
        const worksheet = workbook.addWorksheet('Fee Report');
        
        // Add headers
        if (reportData.data.length > 0) {
            const headers = Object.keys(reportData.data[0]);
            worksheet.addRow(headers);
            
            // Style header row
            const headerRow = worksheet.getRow(1);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4361EE' }
            };
            
            // Add data rows
            reportData.data.forEach(row => {
                worksheet.addRow(Object.values(row));
            });
            
            // Auto-fit columns
            worksheet.columns.forEach(column => {
                let maxLength = 0;
                column.eachCell({ includeEmpty: true }, cell => {
                    const columnLength = cell.value ? cell.value.toString().length : 10;
                    if (columnLength > maxLength) {
                        maxLength = columnLength;
                    }
                });
                column.width = Math.min(maxLength + 2, 50);
            });
            
            // Add summary sheet
            const summarySheet = workbook.addWorksheet('Summary');
            
            summarySheet.addRow(['Fee Report Summary']);
            summarySheet.addRow([]);
            summarySheet.addRow(['Report Type:', reportType]);
            summarySheet.addRow(['Generated On:', new Date().toLocaleString()]);
            summarySheet.addRow(['Total Records:', reportData.summary.total_records]);
            summarySheet.addRow(['Total Collected:', `KSh ${parseInt(reportData.summary.total_collected).toLocaleString('en-KE')}`]);
            summarySheet.addRow(['Total Due:', `KSh ${parseInt(reportData.summary.total_due).toLocaleString('en-KE')}`]);
            summarySheet.addRow(['Total Balance:', `KSh ${parseInt(reportData.summary.total_balance).toLocaleString('en-KE')}`]);
            
            // Style summary sheet
            summarySheet.getRow(1).font = { bold: true, size: 16 };
            summarySheet.getRow(3).font = { bold: true };
            summarySheet.getRow(4).font = { bold: true };
            
            // Add filter information
            summarySheet.addRow([]);
            summarySheet.addRow(['Filter Information']);
            
            if (reportData.filters.date_range) {
                summarySheet.addRow(['Date Range:', reportData.filters.date_range]);
            }
            if (reportData.filters.start_date && reportData.filters.end_date) {
                summarySheet.addRow(['Start Date:', reportData.filters.start_date]);
                summarySheet.addRow(['End Date:', reportData.filters.end_date]);
            }
            if (reportData.filters.academic_year && reportData.filters.academic_year !== 'all') {
                summarySheet.addRow(['Academic Year:', reportData.filters.academic_year]);
            }
            if (reportData.filters.term && reportData.filters.term !== 'all') {
                summarySheet.addRow(['Term:', reportData.filters.term]);
            }
        }
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (error) {
        console.error('Excel export error:', error);
        res.status(500).send('Excel export failed: ' + error.message);
    }
}

// Helper function to export to PDF
async function exportToPDF(res, reportData, reportType) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `fee-report-${reportType}-${timestamp}.pdf`;
        
        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // For now, return a simple HTML that can be printed as PDF
        // In a real implementation, you would use a PDF library like pdfkit or puppeteer
        
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    h1 { color: #333; border-bottom: 2px solid #4361ee; padding-bottom: 10px; }
                    .summary { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th { background: #4361ee; color: white; padding: 10px; text-align: left; }
                    td { padding: 10px; border-bottom: 1px solid #ddd; }
                    .footer { margin-top: 40px; color: #666; font-size: 12px; text-align: center; }
                </style>
            </head>
            <body>
                <h1>Fee Report: ${reportType}</h1>
                <p>Generated on: ${new Date().toLocaleString()}</p>
                
                <div class="summary">
                    <h3>Summary</h3>
                    <p>Total Records: ${reportData.summary.total_records}</p>
                    <p>Total Collected: KSh ${parseInt(reportData.summary.total_collected).toLocaleString('en-KE')}</p>
                    <p>Total Due: KSh ${parseInt(reportData.summary.total_due).toLocaleString('en-KE')}</p>
                    <p>Total Balance: KSh ${parseInt(reportData.summary.total_balance).toLocaleString('en-KE')}</p>
                </div>
                
                <h3>Report Data (${reportData.data.length} records)</h3>
                <table>
                    <thead>
                        <tr>
                            ${reportData.data.length > 0 ? 
                                Object.keys(reportData.data[0]).map(key => `<th>${key}</th>`).join('') 
                                : '<th>No Data</th>'}
                        </tr>
                    </thead>
                    <tbody>
                        ${reportData.data.slice(0, 50).map(row => `
                            <tr>
                                ${Object.values(row).map(value => `<td>${value}</td>`).join('')}
                            </tr>
                        `).join('')}
                        ${reportData.data.length > 50 ? `
                            <tr>
                                <td colspan="${Object.keys(reportData.data[0] || {}).length}" style="text-align: center; font-style: italic;">
                                    ... and ${reportData.data.length - 50} more records
                                </td>
                            </tr>
                        ` : ''}
                    </tbody>
                </table>
                
                <div class="footer">
                    <p>School Management System - Fee Reports</p>
                    <p>This is a computer generated report. No signature required.</p>
                </div>
            </body>
            </html>
        `;
        
        res.send(html);
        
    } catch (error) {
        console.error('PDF export error:', error);
        res.status(500).send('PDF export failed: ' + error.message);
    }
}

// Also add a quick export route for testing
router.get('/reports/quick-export', async (req, res) => {
    try {
        // Get today's data
        const today = new Date().toISOString().split('T')[0];
        
        const data = await dbAll(`
            SELECT 
                f.receipt_number,
                f.payment_date,
                s.name as student_name,
                s.class,
                f.amount_paid,
                f.payment_method,
                f.status
            FROM fees f
            LEFT JOIN students s ON f.student_id = s.id
            WHERE DATE(f.payment_date) = ?
            ORDER BY f.created_at DESC
        `, [today]);
        
        if (data.length === 0) {
            return res.json({
                success: false,
                message: 'No data to export for today'
            });
        }
        
        // Convert to CSV
        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(row => 
            Object.values(row).map(value => 
                `"${String(value || '').replace(/"/g, '""')}"`
            ).join(',')
        );
        
        const csvContent = [headers, ...rows].join('\n');
        
        const filename = `today-fees-${today}.csv`;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
        
    } catch (error) {
        console.error('Quick export error:', error);
        res.status(500).send('Quick export failed: ' + error.message);
    }
});
module.exports = router;