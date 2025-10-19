const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access token required'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Get user from database
        const user = await User.findById(decoded.id).select('-password');
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired'
            });
        }

        console.error('Auth middleware error:', error);
        res.status(500).json({
            success: false,
            message: 'Authentication error'
        });
    }
};

// Optional authentication (for public routes that can benefit from user context)
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select('-password');
            if (user) {
                req.user = user;
            }
        }
        next();
    } catch (error) {
        // Continue without user context for optional auth
        next();
    }
};

// Check if user owns the resource
const checkOwnership = (resourceField = 'user') => {
    return (req, res, next) => {
        try {
            const resourceUserId = req.params[resourceField] || req.body[resourceField];

            if (resourceUserId && resourceUserId.toString() !== req.user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. You can only access your own resources.'
                });
            }

            next();
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Ownership check error'
            });
        }
    };
};

// Rate limiting for sensitive operations
const sensitiveOperationLimit = (windowMs = 15 * 60 * 1000, max = 5) => {
    const attempts = new Map();

    return (req, res, next) => {
        const key = req.user._id.toString();
        const now = Date.now();
        const userAttempts = attempts.get(key) || [];

        // Remove old attempts
        const recentAttempts = userAttempts.filter(time => now - time < windowMs);

        if (recentAttempts.length >= max) {
            return res.status(429).json({
                success: false,
                message: 'Too many sensitive operations. Please try again later.'
            });
        }

        recentAttempts.push(now);
        attempts.set(key, recentAttempts);

        next();
    };
};

module.exports = {
    authenticateToken,
    optionalAuth,
    checkOwnership,
    sensitiveOperationLimit
};
