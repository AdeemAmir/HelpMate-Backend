const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const { uploadToCloudinary } = require('../config/cloudinary');

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter
const fileFilter = (req, file, cb) => {
    // Allowed file types
    const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/tiff',
        'image/bmp'
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PDF and image files are allowed.'), false);
    }
};

// Configure multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1 // Single file upload
    }
});

// Process and upload file
const processAndUpload = async (req, res, next) => {
    try {
        console.log('Upload middleware - req.file:', req.file);

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        const file = req.file;
        const fileType = file.mimetype.startsWith('image/') ? 'image' : 'pdf';

        let processedFile = file.buffer;
        let fileName = file.originalname;
        let mimeType = file.mimetype;

        // Process images for optimization
        if (fileType === 'image') {
            try {
                // Optimize image with Sharp
                processedFile = await sharp(file.buffer)
                    .resize(2048, 2048, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .jpeg({ quality: 85 })
                    .toBuffer();

                // Update file info
                fileName = path.parse(file.originalname).name + '.jpg';
                mimeType = 'image/jpeg';
            } catch (sharpError) {
                console.warn('Sharp processing failed, using original file:', sharpError.message);
                // Continue with original file if Sharp fails
            }
        }

        // Upload to Cloudinary
        const uploadResult = await uploadToCloudinary(processedFile, {
            public_id: `healthmate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            folder: `healthmate/${req.user._id}`,
            resource_type: fileType === 'image' ? 'image' : 'raw',
            mimeType: mimeType // Pass the mimeType for proper data URI conversion
        });

        if (!uploadResult.success) {
            return res.status(500).json({
                success: false,
                message: 'File upload failed',
                error: uploadResult.error
            });
        }

        // Attach file info to request
        req.uploadedFile = {
            originalName: file.originalname,
            fileName: fileName,
            filePath: uploadResult.data.public_id,
            fileUrl: uploadResult.data.secure_url,
            fileType: fileType,
            mimeType: mimeType,
            fileSize: uploadResult.data.bytes,
            cloudinaryData: uploadResult.data
        };

        next();
    } catch (error) {
        console.error('File processing error:', error);
        res.status(500).json({
            success: false,
            message: 'File processing failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Error handler for multer
const handleUploadError = (error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File too large. Maximum size is 10MB.'
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                message: 'Too many files. Only one file allowed.'
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                message: 'Unexpected field. Please use the correct field name.'
            });
        }
    }

    if (error.message.includes('Invalid file type')) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    next(error);
};

module.exports = {
    upload,
    processAndUpload,
    handleUploadError
};
