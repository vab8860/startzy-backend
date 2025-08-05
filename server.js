const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
app.use(cors({
  origin: [
    'https://startzy-afd83.web.app',
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    // Option 1: Use JSON file (recommended for development)
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('🔥 Firebase initialized with JSON file');
  } catch (error) {
    // Option 2: Use environment variables (for production/deployment)
    console.log('📝 JSON file not found, using environment variables');
    
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
      console.error('❌ Firebase environment variables missing!');
      console.error('Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
      process.exit(1);
    }
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
    console.log('🔥 Firebase initialized with environment variables');
  }
}

const db = admin.firestore();

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Startzy Backend API is running!',
    timestamp: new Date().toISOString()
  });
});

// Instagram OAuth Routes
app.use('/auth/instagram', require('./routes/instagram'));

// YouTube OAuth Routes  
app.use('/auth/youtube', require('./routes/youtube'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Startzy Backend running on port ${PORT}`);
  console.log(`📱 Frontend: https://startzy-afd83.web.app`);
  console.log(`🔥 Database: Firestore`);
});

module.exports = app;
