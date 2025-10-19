const express = require('express');
const { body, validationResult } = require('express-validator');
const File = require('../models/File');
const AiInsight = require('../models/AiInsight');
const { authenticateToken } = require('../middleware/auth');
const { upload, processAndUpload, handleUploadError } = require('../middleware/upload');
const { analyzeMedicalReport } = require('../config/gemini');
const { deleteFromCloudinary } = require('../config/cloudinary');

const router = express.Router();

// @route   POST /api/files/upload
// @desc    Upload medical report
// @access  Private
router.post('/upload',
    authenticateToken,
    upload.single('file'), // Single file upload
    handleUploadError,
    processAndUpload,
    [
        body('reportType')
            .isIn(['blood-test', 'urine-test', 'x-ray', 'ct-scan', 'mri', 'ultrasound', 'ecg', 'prescription', 'discharge-summary', 'consultation', 'other'])
            .withMessage('Invalid report type'),
        body('testDate')
            .isISO8601()
            .withMessage('Invalid test date'),
        body('labName')
            .optional()
            .trim()
            .isLength({ max: 100 })
            .withMessage('Lab name too long'),
        body('doctorName')
            .optional()
            .trim()
            .isLength({ max: 100 })
            .withMessage('Doctor name too long'),
        body('description')
            .optional()
            .trim()
            .isLength({ max: 500 })
            .withMessage('Description too long')
    ],
    async (req, res) => {
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

            const { reportType, testDate, labName, doctorName, description, tags } = req.body;

            // Create file record
            const file = new File({
                user: req.user._id,
                originalName: req.uploadedFile.originalName,
                fileName: req.uploadedFile.fileName,
                filePath: req.uploadedFile.filePath,
                fileUrl: req.uploadedFile.fileUrl,
                fileType: req.uploadedFile.fileType,
                mimeType: req.uploadedFile.mimeType,
                fileSize: req.uploadedFile.fileSize,
                reportType,
                testDate: new Date(testDate),
                labName,
                doctorName,
                description,
                tags: tags ? tags.split(',').map(tag => tag.trim()) : []
            });

            await file.save();

            // Start AI processing in background
            processAIInsight(file._id, req.uploadedFile.filePath, req.uploadedFile.fileType, reportType, req.user._id);

            res.status(201).json({
                success: true,
                message: 'File uploaded successfully',
                data: {
                    file: {
                        id: file._id,
                        originalName: file.originalName,
                        fileName: file.fileName,
                        fileUrl: file.fileUrl,
                        fileType: file.fileType,
                        reportType: file.reportType,
                        testDate: file.testDate,
                        labName: file.labName,
                        doctorName: file.doctorName,
                        description: file.description,
                        tags: file.tags,
                        isProcessed: file.isProcessed,
                        processingStatus: file.processingStatus,
                        createdAt: file.createdAt
                    }
                }
            });

        } catch (error) {
            console.error('File upload error:', error);
            res.status(500).json({
                success: false,
                message: 'File upload failed',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// @route   GET /api/files
// @desc    Get user's files
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            reportType,
            sortBy = 'testDate',
            sortOrder = 'desc',
            search
        } = req.query;

        const query = { user: req.user._id };

        // Filter by report type
        if (reportType) {
            query.reportType = reportType;
        }

        // Search in original name, lab name, doctor name, or description
        if (search) {
            query.$or = [
                { originalName: { $regex: search, $options: 'i' } },
                { labName: { $regex: search, $options: 'i' } },
                { doctorName: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const files = await File.find(query)
            .populate('aiInsight', 'summary keyFindings recommendations confidence')
            .sort(sortOptions)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .select('-filePath'); // Don't expose internal file path

        // Transform files to match frontend expectations
        const transformedFiles = files.map(file => {
            const fileData = file.toObject();
            if (fileData.aiInsight) {
                fileData.aiInsights = fileData.aiInsight;
                delete fileData.aiInsight;
            }
            return fileData;
        });

        const total = await File.countDocuments(query);

        res.json({
            success: true,
            data: {
                files: transformedFiles,
                pagination: {
                    current: parseInt(page),
                    pages: Math.ceil(total / limit),
                    total
                }
            }
        });

    } catch (error) {
        console.error('Get files error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get files'
        });
    }
});

// @route   GET /api/files/:id
// @desc    Get specific file
// @access  Private
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const file = await File.findOne({
            _id: req.params.id,
            user: req.user._id
        })
            .populate('aiInsight');

        if (!file) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        // Transform the data to match frontend expectations
        const fileData = file.toObject();
        if (fileData.aiInsight) {
            fileData.aiInsights = fileData.aiInsight;
            delete fileData.aiInsight;
        }

        res.json({
            success: true,
            data: { file: fileData }
        });

    } catch (error) {
        console.error('Get file error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get file'
        });
    }
});

// @route   PUT /api/files/:id
// @desc    Update file details
// @access  Private
router.put('/:id', authenticateToken, [
    body('reportType')
        .optional()
        .isIn(['blood-test', 'urine-test', 'x-ray', 'ct-scan', 'mri', 'ultrasound', 'ecg', 'prescription', 'discharge-summary', 'consultation', 'other'])
        .withMessage('Invalid report type'),
    body('testDate')
        .optional()
        .isISO8601()
        .withMessage('Invalid test date'),
    body('labName')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Lab name too long'),
    body('doctorName')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Doctor name too long'),
    body('description')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Description too long')
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

        const allowedUpdates = ['reportType', 'testDate', 'labName', 'doctorName', 'description', 'tags'];
        const updates = {};

        Object.keys(req.body).forEach(key => {
            if (allowedUpdates.includes(key)) {
                if (key === 'testDate') {
                    updates[key] = new Date(req.body[key]);
                } else if (key === 'tags') {
                    updates[key] = req.body[key].split(',').map(tag => tag.trim());
                } else {
                    updates[key] = req.body[key];
                }
            }
        });

        const file = await File.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            updates,
            { new: true, runValidators: true }
        );

        if (!file) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        res.json({
            success: true,
            message: 'File updated successfully',
            data: { file }
        });

    } catch (error) {
        console.error('Update file error:', error);
        res.status(500).json({
            success: false,
            message: 'File update failed'
        });
    }
});

// @route   DELETE /api/files/:id
// @desc    Delete file
// @access  Private
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const file = await File.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!file) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        // Delete from Cloudinary
        const deleteResult = await deleteFromCloudinary(file.filePath);
        if (!deleteResult.success) {
            console.warn('Failed to delete from Cloudinary:', deleteResult.error);
        }

        // Delete AI insight if exists
        if (file.aiInsight) {
            await AiInsight.findByIdAndDelete(file.aiInsight);
        }

        // Delete file record
        await File.findByIdAndDelete(file._id);

        res.json({
            success: true,
            message: 'File deleted successfully'
        });

    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({
            success: false,
            message: 'File deletion failed'
        });
    }
});

// @route   GET /api/files/timeline
// @desc    Get files timeline
// @access  Private
router.get('/timeline', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate, reportType } = req.query;

        const query = { user: req.user._id };

        if (startDate || endDate) {
            query.testDate = {};
            if (startDate) query.testDate.$gte = new Date(startDate);
            if (endDate) query.testDate.$lte = new Date(endDate);
        }

        if (reportType) {
            query.reportType = reportType;
        }

        const files = await File.find(query)
            .populate('aiInsight', 'summary keyFindings confidence')
            .sort({ testDate: -1 })
            .select('-filePath');

        // Group by month
        const timeline = files.reduce((acc, file) => {
            const month = file.testDate.toISOString().substring(0, 7); // YYYY-MM
            if (!acc[month]) {
                acc[month] = [];
            }
            acc[month].push(file);
            return acc;
        }, {});

        res.json({
            success: true,
            data: { timeline }
        });

    } catch (error) {
        console.error('Get timeline error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get timeline'
        });
    }
});

// Background AI processing function
const processAIInsight = async (fileId, filePath, fileType, reportType, userId) => {
    try {
        // Update file processing status
        await File.findByIdAndUpdate(fileId, {
            processingStatus: 'processing'
        });

        // Import Gemini analysis function
        const { analyzeMedicalReport } = require('../config/gemini');

        // Get file data from Cloudinary
        const file = await File.findById(fileId);
        if (!file) {
            throw new Error('File not found');
        }

        // Prepare data for Gemini analysis
        let fileData;
        if (file.fileType === 'image') {
            try {
                // For images, we need to download from Cloudinary and convert to base64
                const https = require('https');
                const url = require('url');

                console.log(`Downloading image from: ${file.fileUrl}`);

                const fileBuffer = await new Promise((resolve, reject) => {
                    const parsedUrl = url.parse(file.fileUrl);
                    const options = {
                        hostname: parsedUrl.hostname,
                        port: parsedUrl.port || 443,
                        path: parsedUrl.path,
                        method: 'GET',
                        headers: {
                            'User-Agent': 'HealthMate/1.0'
                        }
                    };

                    const req = https.request(options, (response) => {
                        if (response.statusCode !== 200) {
                            reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                            return;
                        }

                        const chunks = [];
                        response.on('data', chunk => chunks.push(chunk));
                        response.on('end', () => {
                            const buffer = Buffer.concat(chunks);
                            console.log(`Downloaded image: ${buffer.length} bytes`);
                            resolve(buffer);
                        });
                        response.on('error', reject);
                    });

                    req.on('error', reject);
                    req.setTimeout(30000, () => {
                        req.destroy();
                        reject(new Error('Download timeout'));
                    });
                    req.end();
                });

                fileData = fileBuffer;
            } catch (downloadError) {
                console.error('Failed to download image:', downloadError);
                // Fallback to metadata analysis
                fileData = `Medical Report Analysis Request:
                File: ${file.originalName}
                Type: ${fileType}
                Report Type: ${reportType}
                Lab: ${file.labName || 'Not specified'}
                Doctor: ${file.doctorName || 'Not specified'}
                Date: ${file.testDate}
                
                Note: Could not download image for analysis. Please analyze based on metadata.
                
                Please analyze this medical report and provide insights.`;
            }
        } else {
            // For text-based files, use metadata
            fileData = `Medical Report Analysis Request:
            File: ${file.originalName}
            Type: ${fileType}
            Report Type: ${reportType}
            Lab: ${file.labName || 'Not specified'}
            Doctor: ${file.doctorName || 'Not specified'}
            Date: ${file.testDate}
            
            Please analyze this medical report and provide insights.`;
        }

        // Call Gemini for analysis
        console.log(`Starting Gemini analysis for file ${fileId}...`);
        console.log(`File data type: ${typeof fileData}, is Buffer: ${Buffer.isBuffer(fileData)}`);

        const geminiResult = await analyzeMedicalReport(fileData, fileType, reportType);
        console.log('Gemini result:', geminiResult);

        if (!geminiResult.success) {
            console.error('Gemini analysis failed:', geminiResult.error);
            // Don't throw error, use fallback response instead
            console.log('Using fallback response due to Gemini failure');
        }

        const analysis = geminiResult.data;

        // Create AI insight with Gemini results
        const aiInsight = new AiInsight({
            file: fileId,
            user: userId,
            rawText: Buffer.isBuffer(fileData) ? `Image file: ${file.originalName}` : fileData,
            summary: {
                english: analysis.summary?.english || analysis.summary || 'Analysis completed',
                urdu: analysis.summary?.urdu || 'Roman Urdu summary not available'
            },
            keyFindings: analysis.keyFindings || [],
            recommendations: analysis.recommendations || { english: [], urdu: [] },
            doctorQuestions: analysis.doctorQuestions || { english: [], urdu: [] },
            riskFactors: analysis.riskFactors || [],
            followUpRequired: analysis.followUpRequired || false,
            followUpTimeframe: analysis.followUpTimeframe || "1-month",
            confidence: analysis.confidence || 60,
            processingTime: geminiResult.processingTime || 0,
            model: "gemini-1.0-pro"
        });

        await aiInsight.save();

        // Update file with AI insight
        await File.findByIdAndUpdate(fileId, {
            aiInsight: aiInsight._id,
            isProcessed: true,
            processingStatus: 'completed'
        });

        console.log(`AI processing completed for file ${fileId}`);

    } catch (error) {
        console.error('AI processing error:', error);

        // Update file processing status to failed
        await File.findByIdAndUpdate(fileId, {
            processingStatus: 'failed'
        });
    }
};

module.exports = router;
