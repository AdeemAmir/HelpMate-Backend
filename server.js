const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const fileRoutes = require('./routes/files');
const vitalRoutes = require('./routes/vitals');
const aiRoutes = require('./routes/ai');

const app = express();

// ✅ Trust proxy (important for Vercel + rate-limit)
app.set('trust proxy', 1);

// ✅ Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// ✅ Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// ✅ Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ Database connection (only once)
const mongoURI = process.env.MONGODB_URI;
if (!mongoURI) {
  console.error('❌ Missing MONGODB_URI in environment variables.');
  process.exit(1);
}

mongoose.connect(mongoURI)
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ✅ Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/vitals', vitalRoutes);
app.use('/api/ai', aiRoutes);

// ✅ Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'HealthMate API is running',
    timestamp: new Date().toISOString()
  });
});

// ✅ Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ✅ 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// ✅ Conditional listener — Vercel vs Local
if (process.env.VERCEL) {
  // On Vercel, just export the app (no listen)
  module.exports = app;
} else {
  // Local or Render, start the server
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 HealthMate server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}
