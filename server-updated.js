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
    'https://startzy-backend.onrender.com',
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Firebase Admin
if (!admin.apps.length) {
  // For production deployment, use environment variables
  if (process.env.NODE_ENV === 'production' || !require('fs').existsSync('./serviceAccountKey.json')) {
    console.log('📝 Using environment variables for Firebase');
    
    // Debug environment variables
    console.log('🔍 Environment variables check:');
    console.log('- FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? '✅ Set' : '❌ Missing');
    console.log('- FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? '✅ Set' : '❌ Missing');
    console.log('- FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? '✅ Set (length: ' + process.env.FIREBASE_PRIVATE_KEY.length + ')' : '❌ Missing');
    
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
      console.error('❌ Firebase environment variables missing!');
      console.error('Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
      process.exit(1);
    }
    
    // Clean and format the private key
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    
    console.log('🔍 Raw private key length:', privateKey ? privateKey.length : 'undefined');
    console.log('🔍 Private key starts with:', privateKey ? privateKey.substring(0, 30) + '...' : 'undefined');
    console.log('🔍 Private key ends with:', privateKey ? '...' + privateKey.substring(privateKey.length - 30) : 'undefined');
    
    // Handle different line break formats
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
      console.log('🔧 Converted \\n to \n');
    }
    
    // Remove any extra quotes that might be added by deployment platforms
    privateKey = privateKey.replace(/^"|"$/g, '');
    
    // Ensure proper line breaks around headers/footers
    privateKey = privateKey.replace(/-----BEGIN PRIVATE KEY-----\s*/g, '-----BEGIN PRIVATE KEY-----\n');
    privateKey = privateKey.replace(/\s*-----END PRIVATE KEY-----/g, '\n-----END PRIVATE KEY-----');
    
    // Clean up any double line breaks
    privateKey = privateKey.replace(/\n\n+/g, '\n');
    
    console.log('🔍 After processing - starts with:', privateKey.substring(0, 30) + '...');
    console.log('🔍 After processing - ends with:', '...' + privateKey.substring(privateKey.length - 30));
    
    // Ensure proper PEM format
    if (!privateKey.startsWith('-----BEGIN PRIVATE KEY-----')) {
      console.error('❌ Private key does not start with proper PEM header');
      console.error('Key should start with: -----BEGIN PRIVATE KEY-----');
      console.error('Current start:', privateKey.substring(0, 50));
      process.exit(1);
    }
    
    if (!privateKey.endsWith('-----END PRIVATE KEY-----')) {
      console.error('❌ Private key does not end with proper PEM footer');
      console.error('Key should end with: -----END PRIVATE KEY-----');
      console.error('Current end:', privateKey.substring(privateKey.length - 50));
      
      // Try to fix common issues
      if (privateKey.includes('-----END PRIVATE KEY-----')) {
        console.log('🔧 Found END marker in middle, attempting to fix...');
        const parts = privateKey.split('-----END PRIVATE KEY-----');
        privateKey = parts[0] + '-----END PRIVATE KEY-----';
        console.log('🔧 Fixed private key ending');
      } else {
        console.error('❌ No END marker found at all');
        process.exit(1);
      }
    }
    
    console.log('🔑 Private key format looks correct');
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey
      })
    });
    console.log('🔥 Firebase initialized with environment variables');
  } else {
    // For local development, use JSON file
    try {
      const serviceAccount = require('./serviceAccountKey.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('🔥 Firebase initialized with JSON file');
    } catch (error) {
      console.error('❌ Failed to initialize Firebase:', error.message);
      process.exit(1);
    }
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

// Force CORS headers on all /auth routes
app.use('/auth', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://startzy-afd83.web.app');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
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
