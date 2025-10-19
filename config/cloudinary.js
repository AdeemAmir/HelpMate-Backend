const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

// Upload file to Cloudinary
const uploadToCloudinary = async (file, options = {}) => {
    try {
        const defaultOptions = {
            resource_type: 'auto',
            folder: 'healthmate',
            use_filename: true,
            unique_filename: true,
            overwrite: false
        };

        const uploadOptions = { ...defaultOptions, ...options };

        // Handle Buffer uploads by converting to data URI
        let uploadData = file;
        if (Buffer.isBuffer(file)) {
            // Convert buffer to data URI
            const mimeType = options.mimeType || 'image/jpeg';
            uploadData = `data:${mimeType};base64,${file.toString('base64')}`;
        }

        const result = await cloudinary.uploader.upload(uploadData, uploadOptions);

        return {
            success: true,
            data: {
                public_id: result.public_id,
                secure_url: result.secure_url,
                format: result.format,
                resource_type: result.resource_type,
                bytes: result.bytes,
                width: result.width,
                height: result.height,
                created_at: result.created_at
            }
        };
    } catch (error) {
        console.error('Cloudinary upload error:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// Delete file from Cloudinary
const deleteFromCloudinary = async (publicId) => {
    try {
        const result = await cloudinary.uploader.destroy(publicId);
        return {
            success: result.result === 'ok',
            data: result
        };
    } catch (error) {
        console.error('Cloudinary delete error:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// Generate signed URL for secure access
const generateSignedUrl = (publicId, options = {}) => {
    try {
        const defaultOptions = {
            secure: true,
            sign_url: true,
            expires_at: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
        };

        const urlOptions = { ...defaultOptions, ...options };
        return cloudinary.url(publicId, urlOptions);
    } catch (error) {
        console.error('Signed URL generation error:', error);
        return null;
    }
};

// Transform image for thumbnails
const generateThumbnail = (publicId, options = {}) => {
    try {
        const defaultOptions = {
            width: 300,
            height: 300,
            crop: 'fill',
            quality: 'auto',
            format: 'auto'
        };

        const transformOptions = { ...defaultOptions, ...options };
        return cloudinary.url(publicId, transformOptions);
    } catch (error) {
        console.error('Thumbnail generation error:', error);
        return null;
    }
};

module.exports = {
    cloudinary,
    uploadToCloudinary,
    deleteFromCloudinary,
    generateSignedUrl,
    generateThumbnail
};
