// middleware/auth.js

function isAuthenticated(req, res, next) {
  // ✅ make sure session exists first
  if (!req.session || !req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/auth/login');
    }

    const userRole = req.session.user.role;
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).send('<h1>Access Denied 🚫</h1><p><a href="/dashboard">Back to Dashboard</a></p>');
    }
    next();
  };
}

module.exports = { isAuthenticated, authorizeRoles };