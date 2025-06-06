// Real AI-Powered Painting Recognition Backend
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// File upload handling
const upload = multer({ 
  memory: true,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Load pre-trained model for feature extraction
let model;
async function loadModel() {
  try {
    // Using MobileNet for feature extraction (efficient for mobile)
    model = await tf.loadLayersModel('https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json');
    console.log('AI model loaded successfully');
  } catch (error) {
    console.error('Error loading model:', error);
  }
}

// Extract features from an image
async function extractFeatures(imageBuffer) {
  try {
    // Preprocess image: resize to 224x224, normalize
    const processedImage = await sharp(imageBuffer)
      .resize(224, 224)
      .removeAlpha()
      .raw()
      .toBuffer();
    
    // Convert to tensor
    const tensor = tf.tensor3d(new Uint8Array(processedImage), [224, 224, 3])
      .div(255.0)
      .expandDims(0);
    
    // Extract features using the model
    const features = model.predict(tensor);
    const featureArray = await features.data();
    
    // Clean up tensors
    tensor.dispose();
    features.dispose();
    
    return Array.from(featureArray);
  } catch (error) {
    console.error('Feature extraction error:', error);
    throw error;
  }
}

// Calculate similarity between two feature vectors
function calculateSimilarity(features1, features2) {
  if (features1.length !== features2.length) return 0;
  
  // Cosine similarity
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < features1.length; i++) {
    dotProduct += features1[i] * features2[i];
    norm1 += features1[i] * features1[i];
    norm2 += features2[i] * features2[i];
  }
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// Real image recognition endpoint
app.post('/api/recognize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image provided' });
    }

    console.log('Processing image recognition...');
    
    // Extract features from uploaded image
    const uploadedFeatures = await extractFeatures(req.file.buffer);
    
    // Get all paintings with their stored features from database
    const result = await pool.query(`
      SELECT id, title, artist, year, description, museum, wiki_link, features 
      FROM paintings 
      WHERE features IS NOT NULL
    `);
    
    let bestMatch = null;
    let highestSimilarity = 0;
    
    // Compare against all paintings
    for (const painting of result.rows) {
      if (painting.features) {
        const storedFeatures = JSON.parse(painting.features);
        const similarity = calculateSimilarity(uploadedFeatures, storedFeatures);
        
        if (similarity > highestSimilarity) {
          highestSimilarity = similarity;
          bestMatch = painting;
        }
      }
    }
    
    // Set confidence threshold (you can adjust this)
    const confidenceThreshold = 0.6;
    
    if (bestMatch && highestSimilarity > confidenceThreshold) {
      // Log successful recognition
      await pool.query(
        'INSERT INTO recognition_logs (painting_id, confidence_score, success) VALUES ($1, $2, $3)',
        [bestMatch.id, highestSimilarity, true]
      );
      
      // Update view count
      await pool.query('UPDATE paintings SET view_count = view_count + 1 WHERE id = $1', [bestMatch.id]);
      
      res.json({
        success: true,
        painting: {
          id: bestMatch.id,
          title: bestMatch.title,
          artist: bestMatch.artist,
          year: bestMatch.year,
          description: bestMatch.description,
          museum: bestMatch.museum,
          wikiLink: bestMatch.wiki_link
        },
        confidence: highestSimilarity,
        message: 'Painting recognized successfully!'
      });
    } else {
      // Log failed recognition
      await pool.query(
        'INSERT INTO recognition_logs (painting_id, confidence_score, success) VALUES ($1, $2, $3)',
        [null, highestSimilarity, false]
      );
      
      res.json({
        success: false,
        message: 'Painting not recognized. Try adjusting angle or lighting.',
        confidence: highestSimilarity
      });
    }
    
  } catch (error) {
    console.error('Recognition error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Recognition processing failed',
      error: error.message 
    });
  }
});

// Add painting with image processing
app.post('/api/admin/paintings', upload.single('image'), async (req, res) => {
  try {
    const { title, artist, year, description, museum, wikiLink } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image required' });
    }
    
    // Extract features from the reference image
    const features = await extractFeatures(req.file.buffer);
    
    // Store painting with features
    const result = await pool.query(`
      INSERT INTO paintings (title, artist, year, description, museum, wiki_link, features) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING id
    `, [title, artist, year, description, museum, wikiLink, JSON.stringify(features)]);
    
    res.json({
      success: true,
      message: 'Painting added successfully with AI features',
      paintingId: result.rows[0].id
    });
    
  } catch (error) {
    console.error('Add painting error:', error);
    res.status(500).json({ success: false, message: 'Failed to add painting' });
  }
});

// Batch process existing paintings to add features
app.post('/api/admin/process-features', async (req, res) => {
  try {
    // This would process images from URLs or uploaded files
    // to generate features for existing paintings
    
    const paintings = await pool.query('SELECT id, title FROM paintings WHERE features IS NULL');
    
    res.json({
      success: true,
      message: `Found ${paintings.rows.length} paintings that need feature processing`,
      paintingsToProcess: paintings.rows
    });
    
  } catch (error) {
    res.status(500).json({ success: false, message: 'Processing failed' });
  }
});

// Update database schema for features
app.post('/api/admin/update-schema', async (req, res) => {
  try {
    await pool.query(`
      ALTER TABLE paintings 
      ADD COLUMN IF NOT EXISTS features TEXT,
      ADD COLUMN IF NOT EXISTS image_url VARCHAR(500),
      ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) DEFAULT 'pending'
    `);
    
    res.json({ success: true, message: 'Database schema updated for AI features' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Schema update failed' });
  }
});

// Initialize the model when server starts
loadModel();

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM paintings');
    const paintingCount = parseInt(result.rows[0].count);
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      paintings: paintingCount,
      aiModel: model ? 'loaded' : 'loading',
      features: 'Real AI recognition active'
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎨 ArtSpotter AI server running on port ${PORT}`);
  console.log('Real image recognition active!');
});

module.exports = app;