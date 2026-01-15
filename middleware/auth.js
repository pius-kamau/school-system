// middleware/auth.js - UPDATED WITH DEBUGGING

function isAuthenticated(req, res, next) {
  console.log('🔐 [isAuthenticated] Checking authentication...');
  console.log('   Session ID:', req.sessionID);
  console.log('   Has session?:', !!req.session);
  console.log('   Session user:', req.session ? req.session.user : 'NO SESSION');
  console.log('   URL:', req.originalUrl);
  console.log('   Method:', req.method);
  
  if (!req.session || !req.session.user) {
    console.log('❌ [isAuthenticated] User NOT authenticated, redirecting to login');
    return res.redirect('/auth/login');
  }
  
  console.log('✅ [isAuthenticated] User authenticated:', req.session.user.username);
  next();
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    console.log('👑 [authorizeRoles] Checking for roles:', allowedRoles);
    
    if (!req.session || !req.session.user) {
      console.log('❌ [authorizeRoles] No user in session');
      return res.redirect('/auth/login');
    }

    const userRole = req.session.user.role;
    console.log('   User role:', userRole);
    console.log('   Allowed roles:', allowedRoles);
    console.log('   Is allowed?:', allowedRoles.includes(userRole));
    
    if (!allowedRoles.includes(userRole)) {
      console.log('❌ [authorizeRoles] Access denied for role:', userRole);
      return res.status(403).send('<h1>Access Denied 🚫</h1><p><a href="/dashboard">Back to Dashboard</a></p>');
    }
    
    console.log('✅ [authorizeRoles] User authorized:', req.session.user.username);
    next();
  };
}

module.exports = { isAuthenticated, authorizeRoles };