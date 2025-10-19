const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    originalName: {
        type: String,
        required: true,
        trim: true
    },
    fileName: {
        type: String,
        required: true
    },
    filePath: {
        type: String,
        required: true
    },
    fileUrl: {
        type: String,
        required: true
    },
    fileType: {
        type: String,
        required: true,
        enum: ['pdf', 'image', 'document']
    },
    mimeType: {
        type: String,
        required: true
    },
    fileSize: {
        type: Number,
        required: true
    },
    reportType: {
        type: String,
        required: true,
        enum: [
            'blood-test',
            'urine-test',
            'x-ray',
            'ct-scan',
            'mri',
            'ultrasound',
            'ecg',
            'prescription',
            'discharge-summary',
            'consultation',
            'other'
        ]
    },
    testDate: {
        type: Date,
        required: true
    },
    labName: {
        type: String,
        trim: true
    },
    doctorName: {
        type: String,
        trim: true
    },
    description: {
        type: String,
        trim: true,
        maxlength: [500, 'Description cannot exceed 500 characters']
    },
    tags: [{
        type: String,
        trim: true
    }],
    isProcessed: {
        type: Boolean,
        default: false
    },
    processingStatus: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    },
    aiInsight: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiInsight'
    },
    isPublic: {
        type: Boolean,
        default: false
    },
    sharedWith: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        permission: {
            type: String,
            enum: ['view', 'download'],
            default: 'view'
        },
        sharedAt: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true
});

// Index for efficient queries
fileSchema.index({ user: 1, testDate: -1 });
fileSchema.index({ user: 1, reportType: 1 });
fileSchema.index({ user: 1, tags: 1 });

// Virtual for file age
fileSchema.virtual('ageInDays').get(function () {
    return Math.floor((Date.now() - this.testDate) / (1000 * 60 * 60 * 24));
});

// Method to check if file is recent (within 30 days)
fileSchema.methods.isRecent = function () {
    return this.ageInDays <= 30;
};

// Method to get file extension
fileSchema.methods.getExtension = function () {
    return this.originalName.split('.').pop().toLowerCase();
};

module.exports = mongoose.model('File', fileSchema);
