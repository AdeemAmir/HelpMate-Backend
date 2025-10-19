const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const File = require('../models/File');
const Vitals = require('../models/Vitals');
const AiInsight = require('../models/AiInsight');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/users/dashboard
// @desc    Get user dashboard data
// @access  Private
router.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const { period = '30' } = req.query;

        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(period));

        // Get recent files
        const recentFiles = await File.find({
            user: req.user._id,
            createdAt: { $gte: daysAgo }
        })
            .populate('aiInsight', 'summary confidence')
            .sort({ createdAt: -1 })
            .limit(5);

        // Get recent vitals
        const recentVitals = await Vitals.find({
            user: req.user._id,
            createdAt: { $gte: daysAgo }
        })
            .sort({ date: -1 })
            .limit(5);

        // Get statistics
        const totalFiles = await File.countDocuments({ user: req.user._id });
        const totalVitals = await Vitals.countDocuments({ user: req.user._id });
        const processedFiles = await File.countDocuments({
            user: req.user._id,
            isProcessed: true
        });
        const criticalInsights = await AiInsight.countDocuments({
            user: req.user._id,
            'keyFindings.status': { $in: ['critical', 'abnormal'] }
        });

        // Get upcoming follow-ups
        const followUpInsights = await AiInsight.find({
            user: req.user._id,
            followUpRequired: true,
            isReviewed: false
        })
            .populate('file', 'originalName reportType testDate')
            .sort({ createdAt: -1 })
            .limit(3);

        // Get health trends (simplified)
        const vitalsTrends = await Vitals.aggregate([
            { $match: { user: req.user._id, date: { $gte: daysAgo } } },
            {
                $group: {
                    _id: null,
                    avgWeight: { $avg: '$weight.value' },
                    avgSystolic: { $avg: '$bloodPressure.systolic' },
                    avgDiastolic: { $avg: '$bloodPressure.diastolic' },
                    avgFastingSugar: { $avg: '$bloodSugar.fasting' }
                }
            }
        ]);

        res.json({
            success: true,
            data: {
                user: {
                    name: req.user.name,
                    email: req.user.email,
                    lastLogin: req.user.lastLogin
                },
                recentFiles,
                recentVitals,
                statistics: {
                    totalFiles,
                    totalVitals,
                    processedFiles,
                    criticalInsights,
                    processingRate: totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0
                },
                followUpInsights,
                vitalsTrends: vitalsTrends[0] || null,
                period: parseInt(period)
            }
        });

    } catch (error) {
        console.error('Get dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get dashboard data'
        });
    }
});

// @route   GET /api/users/profile
// @desc    Get user profile
// @access  Private
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                user: req.user
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get profile'
        });
    }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', authenticateToken, [
    body('name')
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Name must be between 2 and 50 characters'),
    body('phone')
        .optional()
        .isMobilePhone()
        .withMessage('Please provide a valid phone number'),
    body('dateOfBirth')
        .optional()
        .isISO8601()
        .withMessage('Invalid date of birth'),
    body('gender')
        .optional()
        .isIn(['male', 'female', 'other', 'prefer-not-to-say'])
        .withMessage('Invalid gender'),
    body('bloodGroup')
        .optional()
        .isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
        .withMessage('Invalid blood group'),
    body('emergencyContact.name')
        .optional()
        .trim()
        .isLength({ max: 50 })
        .withMessage('Emergency contact name too long'),
    body('emergencyContact.phone')
        .optional()
        .isMobilePhone()
        .withMessage('Invalid emergency contact phone'),
    body('preferences.language')
        .optional()
        .isIn(['en', 'ur'])
        .withMessage('Invalid language preference')
], async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const allowedUpdates = [
            'name', 'phone', 'dateOfBirth', 'gender', 'bloodGroup',
            'emergencyContact', 'preferences'
        ];

        const updates = {};
        Object.keys(req.body).forEach(key => {
            if (allowedUpdates.includes(key)) {
                updates[key] = req.body[key];
            }
        });

        const user = await User.findByIdAndUpdate(
            req.user._id,
            updates,
            { new: true, runValidators: true }
        );

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                user
            }
        });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Profile update failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// @route   GET /api/users/statistics
// @desc    Get user health statistics
// @access  Private
router.get('/statistics', authenticateToken, async (req, res) => {
    try {
        const { period = '90' } = req.query;

        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(period));

        // File statistics
        const fileStats = await File.aggregate([
            { $match: { user: req.user._id, createdAt: { $gte: daysAgo } } },
            {
                $group: {
                    _id: '$reportType',
                    count: { $sum: 1 }
                }
            }
        ]);

        // Vitals statistics
        const vitalsStats = await Vitals.aggregate([
            { $match: { user: req.user._id, date: { $gte: daysAgo } } },
            {
                $group: {
                    _id: null,
                    totalEntries: { $sum: 1 },
                    avgWeight: { $avg: '$weight.value' },
                    avgSystolic: { $avg: '$bloodPressure.systolic' },
                    avgDiastolic: { $avg: '$bloodPressure.diastolic' },
                    avgFastingSugar: { $avg: '$bloodSugar.fasting' },
                    avgHeartRate: { $avg: '$heartRate.value' }
                }
            }
        ]);

        // AI insights statistics
        const insightStats = await AiInsight.aggregate([
            { $match: { user: req.user._id, createdAt: { $gte: daysAgo } } },
            {
                $group: {
                    _id: null,
                    totalInsights: { $sum: 1 },
                    avgConfidence: { $avg: '$confidence' },
                    criticalCount: {
                        $sum: {
                            $cond: [
                                { $gt: [{ $size: { $filter: { input: '$keyFindings', cond: { $in: ['$this.status', ['critical', 'abnormal']] } } } }, 0] },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        // Monthly trends
        const monthlyTrends = await File.aggregate([
            { $match: { user: req.user._id, createdAt: { $gte: daysAgo } } },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        res.json({
            success: true,
            data: {
                fileStats,
                vitalsStats: vitalsStats[0] || null,
                insightStats: insightStats[0] || null,
                monthlyTrends,
                period: parseInt(period)
            }
        });

    } catch (error) {
        console.error('Get statistics error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get statistics'
        });
    }
});

// @route   GET /api/users/export
// @desc    Export user data
// @access  Private
router.get('/export', authenticateToken, async (req, res) => {
    try {
        const { format = 'json' } = req.query;

        // Get all user data
        const files = await File.find({ user: req.user._id })
            .populate('aiInsight')
            .sort({ createdAt: -1 });

        const vitals = await Vitals.find({ user: req.user._id })
            .sort({ date: -1 });

        const exportData = {
            user: {
                name: req.user.name,
                email: req.user.email,
                exportDate: new Date().toISOString()
            },
            files: files.map(file => ({
                originalName: file.originalName,
                reportType: file.reportType,
                testDate: file.testDate,
                labName: file.labName,
                doctorName: file.doctorName,
                description: file.description,
                aiInsight: file.aiInsight ? {
                    summary: file.aiInsight.summary,
                    keyFindings: file.aiInsight.keyFindings,
                    recommendations: file.aiInsight.recommendations,
                    confidence: file.aiInsight.confidence
                } : null
            })),
            vitals: vitals.map(vital => ({
                date: vital.date,
                bloodPressure: vital.bloodPressure,
                heartRate: vital.heartRate,
                bloodSugar: vital.bloodSugar,
                weight: vital.weight,
                height: vital.height,
                temperature: vital.temperature,
                oxygenSaturation: vital.oxygenSaturation,
                notes: vital.notes
            }))
        };

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="healthmate-export.json"');
            res.json(exportData);
        } else {
            res.status(400).json({
                success: false,
                message: 'Unsupported export format'
            });
        }

    } catch (error) {
        console.error('Export data error:', error);
        res.status(500).json({
            success: false,
            message: 'Data export failed'
        });
    }
});

// @route   DELETE /api/users/account
// @desc    Delete user account and all data
// @access  Private
router.delete('/account', authenticateToken, async (req, res) => {
    try {
        const { confirmPassword } = req.body;

        if (!confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Password confirmation required'
            });
        }

        // Verify password
        const user = await User.findById(req.user._id).select('+password');
        const isPasswordValid = await user.comparePassword(confirmPassword);

        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                message: 'Invalid password'
            });
        }

        // Delete all user data
        await File.deleteMany({ user: req.user._id });
        await Vitals.deleteMany({ user: req.user._id });
        await AiInsight.deleteMany({ user: req.user._id });
        await User.findByIdAndDelete(req.user._id);

        res.json({
            success: true,
            message: 'Account and all data deleted successfully'
        });

    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({
            success: false,
            message: 'Account deletion failed'
        });
    }
});

module.exports = router;
