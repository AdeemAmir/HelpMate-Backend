const mongoose = require('mongoose');

const vitalsSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    bloodPressure: {
        systolic: {
            type: Number,
            min: [50, 'Systolic pressure too low'],
            max: [250, 'Systolic pressure too high']
        },
        diastolic: {
            type: Number,
            min: [30, 'Diastolic pressure too low'],
            max: [150, 'Diastolic pressure too high']
        },
        unit: {
            type: String,
            default: 'mmHg'
        }
    },
    heartRate: {
        value: {
            type: Number,
            min: [30, 'Heart rate too low'],
            max: [220, 'Heart rate too high']
        },
        unit: {
            type: String,
            default: 'bpm'
        }
    },
    bloodSugar: {
        fasting: {
            type: Number,
            min: [50, 'Blood sugar too low'],
            max: [500, 'Blood sugar too high']
        },
        postPrandial: {
            type: Number,
            min: [50, 'Blood sugar too low'],
            max: [500, 'Blood sugar too high']
        },
        random: {
            type: Number,
            min: [50, 'Blood sugar too low'],
            max: [500, 'Blood sugar too high']
        },
        unit: {
            type: String,
            default: 'mg/dL'
        }
    },
    weight: {
        value: {
            type: Number,
            min: [20, 'Weight too low'],
            max: [300, 'Weight too high']
        },
        unit: {
            type: String,
            default: 'kg'
        }
    },
    height: {
        value: {
            type: Number,
            min: [100, 'Height too low'],
            max: [250, 'Height too high']
        },
        unit: {
            type: String,
            default: 'cm'
        }
    },
    temperature: {
        value: {
            type: Number,
            min: [95, 'Temperature too low'],
            max: [110, 'Temperature too high']
        },
        unit: {
            type: String,
            default: '°F'
        }
    },
    oxygenSaturation: {
        value: {
            type: Number,
            min: [70, 'Oxygen saturation too low'],
            max: [100, 'Oxygen saturation too high']
        },
        unit: {
            type: String,
            default: '%'
        }
    },
    respiratoryRate: {
        value: {
            type: Number,
            min: [8, 'Respiratory rate too low'],
            max: [40, 'Respiratory rate too high']
        },
        unit: {
            type: String,
            default: 'breaths/min'
        }
    },
    notes: {
        type: String,
        trim: true,
        maxlength: [1000, 'Notes cannot exceed 1000 characters']
    },
    tags: [{
        type: String,
        trim: true
    }],
    isManual: {
        type: Boolean,
        default: true
    },
    source: {
        type: String,
        enum: ['manual', 'device', 'imported'],
        default: 'manual'
    },
    deviceInfo: {
        name: String,
        model: String,
        serialNumber: String
    },
    location: {
        type: String,
        trim: true
    },
    mood: {
        type: String,
        enum: ['excellent', 'good', 'fair', 'poor', 'terrible']
    },
    symptoms: [{
        type: String,
        trim: true
    }],
    medications: [{
        name: String,
        dosage: String,
        frequency: String,
        takenAt: Date
    }]
}, {
    timestamps: true
});

// Index for efficient queries
vitalsSchema.index({ user: 1, date: -1 });
vitalsSchema.index({ user: 1, 'bloodPressure.systolic': 1 });
vitalsSchema.index({ user: 1, 'bloodSugar.fasting': 1 });
vitalsSchema.index({ user: 1, weight: 1 });

// Virtual for BMI calculation
vitalsSchema.virtual('bmi').get(function () {
    if (this.weight && this.height) {
        const heightInMeters = this.height.value / 100;
        return (this.weight.value / (heightInMeters * heightInMeters)).toFixed(1);
    }
    return null;
});

// Virtual for BMI category
vitalsSchema.virtual('bmiCategory').get(function () {
    const bmi = this.bmi;
    if (!bmi) return null;

    if (bmi < 18.5) return 'underweight';
    if (bmi < 25) return 'normal';
    if (bmi < 30) return 'overweight';
    return 'obese';
});

// Method to check if vitals are within normal range
vitalsSchema.methods.checkNormalRanges = function () {
    const alerts = [];

    // Blood Pressure
    if (this.bloodPressure) {
        if (this.bloodPressure.systolic > 140 || this.bloodPressure.diastolic > 90) {
            alerts.push('High blood pressure detected');
        }
        if (this.bloodPressure.systolic < 90 || this.bloodPressure.diastolic < 60) {
            alerts.push('Low blood pressure detected');
        }
    }

    // Blood Sugar
    if (this.bloodSugar) {
        if (this.bloodSugar.fasting > 126) {
            alerts.push('High fasting blood sugar');
        }
        if (this.bloodSugar.postPrandial > 200) {
            alerts.push('High post-meal blood sugar');
        }
    }

    // Heart Rate
    if (this.heartRate && (this.heartRate.value > 100 || this.heartRate.value < 60)) {
        alerts.push('Abnormal heart rate');
    }

    // Temperature
    if (this.temperature && (this.temperature.value > 100.4 || this.temperature.value < 97)) {
        alerts.push('Abnormal body temperature');
    }

    // Oxygen Saturation
    if (this.oxygenSaturation && this.oxygenSaturation.value < 95) {
        alerts.push('Low oxygen saturation');
    }

    return alerts;
};

module.exports = mongoose.model('Vitals', vitalsSchema);
