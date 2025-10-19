const express = require('express');
const { body, validationResult } = require('express-validator');
const Vitals = require('../models/Vitals');
const { authenticateToken } = require('../middleware/auth');
const { analyzeVitals } = require('../config/gemini');

const router = express.Router();

// @route   POST /api/vitals
// @desc    Add manual vitals
// @access  Private
router.post('/', authenticateToken, [
    body('date')
        .optional()
        .isISO8601()
        .withMessage('Invalid date'),
    body('bloodPressure.systolic')
        .optional()
        .isInt({ min: 50, max: 250 })
        .withMessage('Systolic pressure must be between 50-250'),
    body('bloodPressure.diastolic')
        .optional()
        .isInt({ min: 30, max: 150 })
        .withMessage('Diastolic pressure must be between 30-150'),
    body('heartRate.value')
        .optional()
        .isInt({ min: 30, max: 220 })
        .withMessage('Heart rate must be between 30-220'),
    body('bloodSugar.fasting')
        .optional()
        .isFloat({ min: 50, max: 500 })
        .withMessage('Fasting blood sugar must be between 50-500'),
    body('bloodSugar.postPrandial')
        .optional()
        .isFloat({ min: 50, max: 500 })
        .withMessage('Post-prandial blood sugar must be between 50-500'),
    body('bloodSugar.random')
        .optional()
        .isFloat({ min: 50, max: 500 })
        .withMessage('Random blood sugar must be between 50-500'),
    body('weight.value')
        .optional()
        .isFloat({ min: 20, max: 300 })
        .withMessage('Weight must be between 20-300'),
    body('height.value')
        .optional()
        .isFloat({ min: 100, max: 250 })
        .withMessage('Height must be between 100-250'),
    body('temperature.value')
        .optional()
        .isFloat({ min: 95, max: 110 })
        .withMessage('Temperature must be between 95-110'),
    body('oxygenSaturation.value')
        .optional()
        .isFloat({ min: 70, max: 100 })
        .withMessage('Oxygen saturation must be between 70-100'),
    body('notes')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Notes cannot exceed 1000 characters')
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

        const vitalsData = {
            user: req.user._id,
            ...req.body
        };

        // Set default date if not provided
        if (!vitalsData.date) {
            vitalsData.date = new Date();
        }

        const vitals = new Vitals(vitalsData);
        await vitals.save();

        // Check for alerts
        const alerts = vitals.checkNormalRanges();

        res.status(201).json({
            success: true,
            message: 'Vitals recorded successfully',
            data: {
                vitals,
                alerts,
                bmi: vitals.bmi,
                bmiCategory: vitals.bmiCategory
            }
        });

    } catch (error) {
        console.error('Add vitals error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to record vitals',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// @route   GET /api/vitals
// @desc    Get user's vitals
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            startDate,
            endDate,
            sortBy = 'date',
            sortOrder = 'desc'
        } = req.query;

        const query = { user: req.user._id };

        // Date range filter
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const vitals = await Vitals.find(query)
            .sort(sortOptions)
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Vitals.countDocuments(query);

        // Add alerts and BMI to each vital
        const vitalsWithAlerts = vitals.map(vital => {
            const alerts = vital.checkNormalRanges();
            return {
                ...vital.toObject(),
                alerts,
                bmi: vital.bmi,
                bmiCategory: vital.bmiCategory
            };
        });

        res.json({
            success: true,
            data: {
                vitals: vitalsWithAlerts,
                pagination: {
                    current: parseInt(page),
                    pages: Math.ceil(total / limit),
                    total
                }
            }
        });

    } catch (error) {
        console.error('Get vitals error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get vitals'
        });
    }
});

// @route   GET /api/vitals/trends
// @desc    Get vitals trends data
// @access  Private
router.get('/trends', authenticateToken, async (req, res) => {
    try {
        const { period = '30' } = req.query;

        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(period));

        const vitals = await Vitals.find({
            user: req.user._id,
            date: { $gte: daysAgo }
        }).sort({ date: 1 });

        res.json({
            success: true,
            data: vitals
        });

    } catch (error) {
        console.error('Get vitals trends error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get vitals trends'
        });
    }
});

// @route   GET /api/vitals/:id
// @desc    Get specific vitals
// @access  Private
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const vitals = await Vitals.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!vitals) {
            return res.status(404).json({
                success: false,
                message: 'Vitals not found'
            });
        }

        const alerts = vitals.checkNormalRanges();

        res.json({
            success: true,
            data: {
                vitals: {
                    ...vitals.toObject(),
                    alerts,
                    bmi: vitals.bmi,
                    bmiCategory: vitals.bmiCategory
                }
            }
        });

    } catch (error) {
        console.error('Get vitals error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get vitals'
        });
    }
});

// @route   PUT /api/vitals/:id
// @desc    Update vitals
// @access  Private
router.put('/:id', authenticateToken, [
    body('date')
        .optional()
        .isISO8601()
        .withMessage('Invalid date'),
    body('bloodPressure.systolic')
        .optional()
        .isInt({ min: 50, max: 250 })
        .withMessage('Systolic pressure must be between 50-250'),
    body('bloodPressure.diastolic')
        .optional()
        .isInt({ min: 30, max: 150 })
        .withMessage('Diastolic pressure must be between 30-150'),
    body('heartRate.value')
        .optional()
        .isInt({ min: 30, max: 220 })
        .withMessage('Heart rate must be between 30-220'),
    body('bloodSugar.fasting')
        .optional()
        .isFloat({ min: 50, max: 500 })
        .withMessage('Fasting blood sugar must be between 50-500'),
    body('bloodSugar.postPrandial')
        .optional()
        .isFloat({ min: 50, max: 500 })
        .withMessage('Post-prandial blood sugar must be between 50-500'),
    body('bloodSugar.random')
        .optional()
        .isFloat({ min: 50, max: 500 })
        .withMessage('Random blood sugar must be between 50-500'),
    body('weight.value')
        .optional()
        .isFloat({ min: 20, max: 300 })
        .withMessage('Weight must be between 20-300'),
    body('height.value')
        .optional()
        .isFloat({ min: 100, max: 250 })
        .withMessage('Height must be between 100-250'),
    body('temperature.value')
        .optional()
        .isFloat({ min: 95, max: 110 })
        .withMessage('Temperature must be between 95-110'),
    body('oxygenSaturation.value')
        .optional()
        .isFloat({ min: 70, max: 100 })
        .withMessage('Oxygen saturation must be between 70-100'),
    body('notes')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Notes cannot exceed 1000 characters')
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
            'date', 'bloodPressure', 'heartRate', 'bloodSugar', 'weight',
            'height', 'temperature', 'oxygenSaturation', 'respiratoryRate',
            'notes', 'tags', 'location', 'mood', 'symptoms', 'medications'
        ];

        const updates = {};
        Object.keys(req.body).forEach(key => {
            if (allowedUpdates.includes(key)) {
                if (key === 'date') {
                    updates[key] = new Date(req.body[key]);
                } else {
                    updates[key] = req.body[key];
                }
            }
        });

        const vitals = await Vitals.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            updates,
            { new: true, runValidators: true }
        );

        if (!vitals) {
            return res.status(404).json({
                success: false,
                message: 'Vitals not found'
            });
        }

        const alerts = vitals.checkNormalRanges();

        res.json({
            success: true,
            message: 'Vitals updated successfully',
            data: {
                vitals: {
                    ...vitals.toObject(),
                    alerts,
                    bmi: vitals.bmi,
                    bmiCategory: vitals.bmiCategory
                }
            }
        });

    } catch (error) {
        console.error('Update vitals error:', error);
        res.status(500).json({
            success: false,
            message: 'Vitals update failed'
        });
    }
});

// @route   DELETE /api/vitals/:id
// @desc    Delete vitals
// @access  Private
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const vitals = await Vitals.findOneAndDelete({
            _id: req.params.id,
            user: req.user._id
        });

        if (!vitals) {
            return res.status(404).json({
                success: false,
                message: 'Vitals not found'
            });
        }

        res.json({
            success: true,
            message: 'Vitals deleted successfully'
        });

    } catch (error) {
        console.error('Delete vitals error:', error);
        res.status(500).json({
            success: false,
            message: 'Vitals deletion failed'
        });
    }
});

// @route   GET /api/vitals/charts/:type
// @desc    Get vitals data for charts
// @access  Private
router.get('/charts/:type', authenticateToken, async (req, res) => {
    try {
        const { type } = req.params;
        const { startDate, endDate, period = '30' } = req.query;

        const query = { user: req.user._id };

        // Date range filter
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        } else {
            // Default to last N days
            const daysAgo = new Date();
            daysAgo.setDate(daysAgo.getDate() - parseInt(period));
            query.date = { $gte: daysAgo };
        }

        let vitals;
        let chartData = [];

        switch (type) {
            case 'blood-pressure':
                vitals = await Vitals.find(query)
                    .select('date bloodPressure')
                    .sort({ date: 1 });

                chartData = vitals
                    .filter(v => v.bloodPressure && v.bloodPressure.systolic && v.bloodPressure.diastolic)
                    .map(v => ({
                        date: v.date,
                        systolic: v.bloodPressure.systolic,
                        diastolic: v.bloodPressure.diastolic
                    }));
                break;

            case 'blood-sugar':
                vitals = await Vitals.find(query)
                    .select('date bloodSugar')
                    .sort({ date: 1 });

                chartData = vitals
                    .filter(v => v.bloodSugar && (v.bloodSugar.fasting || v.bloodSugar.postPrandial || v.bloodSugar.random))
                    .map(v => ({
                        date: v.date,
                        fasting: v.bloodSugar.fasting,
                        postPrandial: v.bloodSugar.postPrandial,
                        random: v.bloodSugar.random
                    }));
                break;

            case 'weight':
                vitals = await Vitals.find(query)
                    .select('date weight')
                    .sort({ date: 1 });

                chartData = vitals
                    .filter(v => v.weight && v.weight.value)
                    .map(v => ({
                        date: v.date,
                        weight: v.weight.value,
                        unit: v.weight.unit
                    }));
                break;

            case 'heart-rate':
                vitals = await Vitals.find(query)
                    .select('date heartRate')
                    .sort({ date: 1 });

                chartData = vitals
                    .filter(v => v.heartRate && v.heartRate.value)
                    .map(v => ({
                        date: v.date,
                        heartRate: v.heartRate.value,
                        unit: v.heartRate.unit
                    }));
                break;

            default:
                return res.status(400).json({
                    success: false,
                    message: 'Invalid chart type'
                });
        }

        res.json({
            success: true,
            data: {
                type,
                chartData,
                period: parseInt(period)
            }
        });

    } catch (error) {
        console.error('Get chart data error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get chart data'
        });
    }
});

// @route   GET /api/vitals/summary
// @desc    Get vitals summary with AI insights
// @access  Private
router.get('/summary', authenticateToken, async (req, res) => {
    try {
        const { period = '30' } = req.query;

        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(period));

        const vitals = await Vitals.find({
            user: req.user._id,
            date: { $gte: daysAgo }
        }).sort({ date: -1 });

        // Calculate basic statistics
        const stats = {
            totalEntries: vitals.length,
            bloodPressure: {
                latest: vitals.find(v => v.bloodPressure && v.bloodPressure.systolic),
                average: null
            },
            bloodSugar: {
                latest: vitals.find(v => v.bloodSugar && (v.bloodSugar.fasting || v.bloodSugar.postPrandial)),
                average: null
            },
            weight: {
                latest: vitals.find(v => v.weight && v.weight.value),
                average: null,
                trend: null
            }
        };

        // Calculate averages
        const bpReadings = vitals.filter(v => v.bloodPressure && v.bloodPressure.systolic);
        if (bpReadings.length > 0) {
            const avgSystolic = bpReadings.reduce((sum, v) => sum + v.bloodPressure.systolic, 0) / bpReadings.length;
            const avgDiastolic = bpReadings.reduce((sum, v) => sum + v.bloodPressure.diastolic, 0) / bpReadings.length;
            stats.bloodPressure.average = {
                systolic: Math.round(avgSystolic),
                diastolic: Math.round(avgDiastolic)
            };
        }

        const sugarReadings = vitals.filter(v => v.bloodSugar && (v.bloodSugar.fasting || v.bloodSugar.postPrandial));
        if (sugarReadings.length > 0) {
            const fastingValues = sugarReadings.map(v => v.bloodSugar.fasting).filter(v => v);
            const postPrandialValues = sugarReadings.map(v => v.bloodSugar.postPrandial).filter(v => v);

            stats.bloodSugar.average = {
                fasting: fastingValues.length > 0 ? Math.round(fastingValues.reduce((sum, v) => sum + v, 0) / fastingValues.length) : null,
                postPrandial: postPrandialValues.length > 0 ? Math.round(postPrandialValues.reduce((sum, v) => sum + v, 0) / postPrandialValues.length) : null
            };
        }

        const weightReadings = vitals.filter(v => v.weight && v.weight.value);
        if (weightReadings.length > 1) {
            const latest = weightReadings[0].weight.value;
            const earliest = weightReadings[weightReadings.length - 1].weight.value;
            stats.weight.trend = latest > earliest ? 'increasing' : latest < earliest ? 'decreasing' : 'stable';
            stats.weight.average = Math.round(weightReadings.reduce((sum, v) => sum + v.weight.value, 0) / weightReadings.length);
        }

        // Get AI insights if available
        let aiInsights = null;
        try {
            const aiResult = await analyzeVitals(stats);
            if (aiResult.success) {
                aiInsights = aiResult.data;
            }
        } catch (error) {
            console.warn('AI insights failed:', error.message);
        }

        res.json({
            success: true,
            data: {
                stats,
                aiInsights,
                period: parseInt(period)
            }
        });

    } catch (error) {
        console.error('Get vitals summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get vitals summary'
        });
    }
});

module.exports = router;
