const mongoose = require('mongoose');

const aiInsightSchema = new mongoose.Schema({
    file: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File',
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    rawText: {
        type: String,
        required: true
    },
    summary: {
        english: {
            type: String,
            required: true
        },
        urdu: {
            type: String,
            required: true
        }
    },
    keyFindings: [{
        parameter: {
            type: String,
            required: true
        },
        value: {
            type: String,
            required: true
        },
        unit: String,
        status: {
            type: String,
            enum: ['normal', 'high', 'low', 'abnormal', 'critical'],
            required: true
        },
        normalRange: String,
        significance: {
            english: String,
            urdu: String
        }
    }],
    recommendations: {
        english: [String],
        urdu: [String]
    },
    doctorQuestions: {
        english: [String],
        urdu: [String]
    },
    riskFactors: [{
        factor: String,
        level: {
            type: String,
            enum: ['low', 'medium', 'high'],
            required: true
        },
        description: {
            english: String,
            urdu: String
        }
    }],
    followUpRequired: {
        type: Boolean,
        default: false
    },
    followUpTimeframe: {
        type: String,
        enum: ['1-week', '2-weeks', '1-month', '3-months', '6-months', '1-year']
    },
    confidence: {
        type: Number,
        min: 0,
        max: 100,
        required: true
    },
    processingTime: {
        type: Number, // in milliseconds
        required: true
    },
    model: {
        type: String,
        default: 'gemini-2.0-flash'
    },
    version: {
        type: String,
        default: '1.0'
    },
    isReviewed: {
        type: Boolean,
        default: false
    },
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reviewedAt: Date,
    reviewNotes: String
}, {
    timestamps: true
});

// Index for efficient queries
aiInsightSchema.index({ user: 1, createdAt: -1 });
aiInsightSchema.index({ file: 1 });
aiInsightSchema.index({ 'keyFindings.status': 1 });

// Virtual for risk level
aiInsightSchema.virtual('overallRiskLevel').get(function () {
    const highRiskCount = this.riskFactors.filter(rf => rf.level === 'high').length;
    const mediumRiskCount = this.riskFactors.filter(rf => rf.level === 'medium').length;

    if (highRiskCount > 0) return 'high';
    if (mediumRiskCount > 2) return 'medium';
    return 'low';
});

// Method to get critical findings
aiInsightSchema.methods.getCriticalFindings = function () {
    return this.keyFindings.filter(finding =>
        finding.status === 'critical' || finding.status === 'abnormal'
    );
};

// Method to get normal findings
aiInsightSchema.methods.getNormalFindings = function () {
    return this.keyFindings.filter(finding => finding.status === 'normal');
};

module.exports = mongoose.model('AiInsight', aiInsightSchema);
