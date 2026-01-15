const express = require('express');
const router = express.Router();
const { isAuthenticated, authorizeRoles } = require('../middleware/auth');

router.get('/', isAuthenticated, authorizeRoles('Admin', 'Accountant'), (req, res) => {
    res.render('fees/index', { 
        user: req.session.user,
        message: 'Fees module coming soon!' 
    });
});

module.exports = router;