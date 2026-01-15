const express = require('express');
const router = express.Router();
const { isAuthenticated, authorizeRoles } = require('../middleware/auth');

router.get('/', isAuthenticated, authorizeRoles('Admin', 'Accountant', 'Teacher'), (req, res) => {
    res.render('reports/index', { 
        user: req.session.user,
        message: 'Reports module coming soon!' 
    });
});

module.exports = router;