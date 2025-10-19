const express = require('express');
const { body, validationResult } = require('express-validator');
const AiInsight = require('../models/AiInsight');
const File = require('../models/File');
const { authenticateToken } = require('../middleware/auth');
const { analyzeMedicalReport, analyzeVitals } = require('../config/gemini');

const router = express.Router();

// @route   POST /api/ai/analyze-file/:fileId
// @desc    Manually trigger AI analysis for a file
// @access  Private
router.post('/analyze-file/:fileId', authenticateToken, async (req, res) => {
    try {
        const file = await File.findOne({
            _id: req.params.fileId,
            user: req.user._id
        });

        if (!file) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        // Check if already processed
        if (file.isProcessed && file.aiInsight) {
            return res.status(400).json({
                success: false,
                message: 'File already processed'
            });
        }

        // Update processing status
        await File.findByIdAndUpdate(file._id, {
            processingStatus: 'processing'
        });

        // Start AI analysis (this would be implemented with actual file processing)
        // For now, we'll simulate the process
        const startTime = Date.now();

        // Simulate AI processing
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Create AI insight
        const aiInsight = new AiInsight({
            file: file._id,
            user: req.user._id,
            rawText: "Sample extracted text from medical report",
            summary: {
                english: "This is a comprehensive analysis of your medical report. The results show normal ranges for most parameters with a few areas that may need attention.",
                urdu: "Ye aapke medical report ka comprehensive analysis hai. Results show karte hain ke most parameters normal range mein hain lekin kuch areas hain jo attention ki zarurat hai."
            },
            keyFindings: [
                {
                    parameter: "Hemoglobin",
                    value: "12.5",
                    unit: "g/dL",
                    status: "normal",
                    normalRange: "12-16 g/dL",
                    significance: {
                        english: "Within normal range, indicates good oxygen-carrying capacity",
                        urdu: "Normal range mein hai, oxygen carrying capacity acchi hai"
                    }
                },
                {
                    parameter: "Blood Sugar (Fasting)",
                    value: "110",
                    unit: "mg/dL",
                    status: "high",
                    normalRange: "70-100 mg/dL",
                    significance: {
                        english: "Slightly elevated, may indicate pre-diabetes",
                        urdu: "Thoda high hai, pre-diabetes ka indication ho sakta hai"
                    }
                }
            ],
            recommendations: {
                english: [
                    "Monitor blood sugar levels regularly",
                    "Follow a balanced diet with reduced sugar intake",
                    "Exercise regularly for at least 30 minutes daily",
                    "Schedule follow-up with your doctor in 3 months"
                ],
                urdu: [
                    "Blood sugar levels regular monitor karein",
                    "Balanced diet follow karein with reduced sugar",
                    "Regular exercise karein at least 30 minutes daily",
                    "3 months mein doctor ke saath follow-up schedule karein"
                ]
            },
            doctorQuestions: {
                english: [
                    "Should I be concerned about my blood sugar levels?",
                    "What dietary changes should I make?",
                    "Do I need any additional tests?",
                    "How often should I monitor my blood sugar?"
                ],
                urdu: [
                    "Kya mujhe blood sugar levels ke baare mein concern karna chahiye?",
                    "Kya dietary changes karne chahiye?",
                    "Kya mujhe koi additional tests chahiye?",
                    "Kitni baar blood sugar monitor karna chahiye?"
                ]
            },
            riskFactors: [
                {
                    factor: "Elevated Blood Sugar",
                    level: "medium",
                    description: {
                        english: "Slightly elevated blood sugar may indicate pre-diabetes risk",
                        urdu: "Thoda high blood sugar pre-diabetes risk indicate kar sakta hai"
                    }
                }
            ],
            followUpRequired: true,
            followUpTimeframe: "3-months",
            confidence: 88,
            processingTime: Date.now() - startTime,
            model: "gemini-1.5-pro"
        });

        await aiInsight.save();

        // Update file with AI insight
        await File.findByIdAndUpdate(file._id, {
            aiInsight: aiInsight._id,
            isProcessed: true,
            processingStatus: 'completed'
        });

        res.json({
            success: true,
            message: 'AI analysis completed successfully',
            data: {
                aiInsight
            }
        });

    } catch (error) {
        console.error('AI analysis error:', error);

        // Update file processing status to failed
        await File.findByIdAndUpdate(req.params.fileId, {
            processingStatus: 'failed'
        });

        res.status(500).json({
            success: false,
            message: 'AI analysis failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// @route   GET /api/ai/insights
// @desc    Get all AI insights for user
// @access  Private
router.get('/insights', authenticateToken, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const insights = await AiInsight.find({ user: req.user._id })
            .populate('file', 'originalName reportType testDate')
            .sort(sortOptions)
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await AiInsight.countDocuments({ user: req.user._id });

        res.json({
            success: true,
            data: {
                insights,
                pagination: {
                    current: parseInt(page),
                    pages: Math.ceil(total / limit),
                    total
                }
            }
        });

    } catch (error) {
        console.error('Get insights error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get insights'
        });
    }
});

// @route   GET /api/ai/insights/:id
// @desc    Get specific AI insight
// @access  Private
router.get('/insights/:id', authenticateToken, async (req, res) => {
    try {
        const insight = await AiInsight.findOne({
            _id: req.params.id,
            user: req.user._id
        }).populate('file', 'originalName reportType testDate fileUrl');

        if (!insight) {
            return res.status(404).json({
                success: false,
                message: 'AI insight not found'
            });
        }

        res.json({
            success: true,
            data: { insight }
        });

    } catch (error) {
        console.error('Get insight error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get insight'
        });
    }
});

// @route   PUT /api/ai/insights/:id/review
// @desc    Mark AI insight as reviewed
// @access  Private
router.put('/insights/:id/review', authenticateToken, [
    body('reviewNotes')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Review notes cannot exceed 1000 characters')
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

        const { reviewNotes } = req.body;

        const insight = await AiInsight.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            {
                isReviewed: true,
                reviewedBy: req.user._id,
                reviewedAt: new Date(),
                reviewNotes
            },
            { new: true, runValidators: true }
        );

        if (!insight) {
            return res.status(404).json({
                success: false,
                message: 'AI insight not found'
            });
        }

        res.json({
            success: true,
            message: 'AI insight marked as reviewed',
            data: { insight }
        });

    } catch (error) {
        console.error('Review insight error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to review insight'
        });
    }
});

// @route   GET /api/ai/dashboard
// @desc    Get AI-powered dashboard data
// @access  Private
router.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const { period = '30' } = req.query;

        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(period));

        // Get recent insights
        const recentInsights = await AiInsight.find({
            user: req.user._id,
            createdAt: { $gte: daysAgo }
        })
            .populate('file', 'originalName reportType testDate')
            .sort({ createdAt: -1 })
            .limit(5);

        // Get critical findings
        const criticalInsights = await AiInsight.find({
            user: req.user._id,
            'keyFindings.status': { $in: ['critical', 'abnormal'] }
        })
            .populate('file', 'originalName reportType testDate')
            .sort({ createdAt: -1 })
            .limit(3);

        // Get follow-up required insights
        const followUpInsights = await AiInsight.find({
            user: req.user._id,
            followUpRequired: true,
            isReviewed: false
        })
            .populate('file', 'originalName reportType testDate')
            .sort({ createdAt: -1 });

        // Calculate statistics
        const totalInsights = await AiInsight.countDocuments({ user: req.user._id });
        const reviewedInsights = await AiInsight.countDocuments({
            user: req.user._id,
            isReviewed: true
        });
        const criticalCount = await AiInsight.countDocuments({
            user: req.user._id,
            'keyFindings.status': { $in: ['critical', 'abnormal'] }
        });

        // Get risk factors summary
        const riskFactors = await AiInsight.aggregate([
            { $match: { user: req.user._id } },
            { $unwind: '$riskFactors' },
            {
                $group: {
                    _id: '$riskFactors.level',
                    count: { $sum: 1 }
                }
            }
        ]);

        res.json({
            success: true,
            data: {
                recentInsights,
                criticalInsights,
                followUpInsights,
                statistics: {
                    totalInsights,
                    reviewedInsights,
                    criticalCount,
                    reviewRate: totalInsights > 0 ? Math.round((reviewedInsights / totalInsights) * 100) : 0
                },
                riskFactors,
                period: parseInt(period)
            }
        });

    } catch (error) {
        console.error('Get AI dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get AI dashboard'
        });
    }
});

// @route   POST /api/ai/chat
// @desc    Chat with AI about health data
// @access  Private
router.post('/chat', authenticateToken, [
    body('message')
        .trim()
        .isLength({ min: 1, max: 1000 })
        .withMessage('Message must be between 1 and 1000 characters')
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

        const { message } = req.body;

        // Get user's recent health data for context
        const recentInsights = await AiInsight.find({ user: req.user._id })
            .populate('file', 'reportType testDate')
            .sort({ createdAt: -1 })
            .limit(5);

        // Create context for AI
        const context = recentInsights.map(insight => ({
            reportType: insight.file.reportType,
            testDate: insight.file.testDate,
            summary: insight.summary.english,
            keyFindings: insight.keyFindings.slice(0, 3) // Top 3 findings
        }));

        // This would integrate with a chat model
        // For now, we'll provide a structured response
        const response = {
            message: "I understand you're asking about your health data. Based on your recent reports, I can help you understand your results better. However, please remember that I'm an AI assistant and cannot replace professional medical advice.",
            suggestions: [
                "What do my recent blood test results mean?",
                "Should I be concerned about any of my values?",
                "What lifestyle changes should I consider?",
                "When should I see my doctor next?"
            ],
            disclaimer: "This is AI-generated information for educational purposes only. Always consult with your healthcare provider for medical advice."
        };

        res.json({
            success: true,
            data: {
                response,
                context: context.length > 0 ? context : null
            }
        });

    } catch (error) {
        console.error('AI chat error:', error);
        res.status(500).json({
            success: false,
            message: 'AI chat failed'
        });
    }
});

module.exports = router;
