// Complete AI-Powered Painting Recognition Backend for Railway
// Updated to use 'painting' table (singular) + Real Claude API
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');
const { Pool } = require('pg');
const axios = require('axios');

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

// ROOT ROUTE
app.get('/', (req, res) => {
  res.json({ 
    message: "🎨 ArtSpotter AI Backend",
    status: "running",
    aiModel: model ? 'loaded' : 'loading',
    claudeAPI: process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured',
    endpoints: {
      health: "/api/health",
      paintings: "/api/paintings", 
      recognize: "/api/recognize (POST)",
      admin: "/api/admin/* (POST)"
    },
    version: "2.1"
  });
});

// HEALTH CHECK
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as total, COUNT(features) as with_features FROM painting');
    const stats = result.rows[0];
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      paintings: parseInt(stats.total),
      paintingsWithAI: parseInt(stats.with_features),
      aiModel: model ? 'loaded' : 'loading',
      claudeAPI: process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing',
      features: 'Real AI recognition active',
      database: 'connected'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: error.message,
      aiModel: model ? 'loaded' : 'loading'
    });
  }
});

// GET ALL PAINTINGS
app.get('/api/paintings', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, artist, year, description, museum, wiki_link, 
             view_count, created_at,
             CASE WHEN features IS NOT NULL THEN true ELSE false END as has_ai_features
      FROM painting 
      ORDER BY id
    `);
    
    const paintings = result.rows.map(painting => ({
      id: painting.id,
      title: painting.title,
      artist: painting.artist,
      year: painting.year,
      description: painting.description,
      museum: painting.museum,
      wikiLink: painting.wiki_link,
      viewCount: painting.view_count || 0,
      hasAiFeatures: painting.has_ai_features,
      createdAt: painting.created_at
    }));
    
    res.json({
      success: true,
      paintings: paintings,
      count: paintings.length
    });
    
  } catch (error) {
    console.error('Get paintings error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch paintings',
      error: error.message 
    });
  }
});

// REAL IMAGE RECOGNITION
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
      FROM painting 
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
      // Update view count
      await pool.query('UPDATE painting SET view_count = view_count + 1 WHERE id = $1', [bestMatch.id]);
      
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

// ADD FEATURES TO EXISTING PAINTING
app.post('/api/admin/add-features', upload.single('image'), async (req, res) => {
  try {
    const { paintingId } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image required' });
    }
    
    if (!paintingId) {
      return res.status(400).json({ success: false, message: 'Painting ID required' });
    }
    
    console.log(`Processing features for painting ID: ${paintingId}`);
    
    // Extract features from the reference image
    const features = await extractFeatures(req.file.buffer);
    
    // Update painting with features
    const result = await pool.query(`
      UPDATE painting 
      SET features = $1, processing_status = 'completed' 
      WHERE id = $2 
      RETURNING title, artist
    `, [JSON.stringify(features), paintingId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Painting not found' });
    }
    
    const painting = result.rows[0];
    
    res.json({
      success: true,
      message: `AI features extracted for "${painting.title}" by ${painting.artist}`,
      paintingId: paintingId,
      featureCount: features.length
    });
    
  } catch (error) {
    console.error('Add features error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process features',
      error: error.message 
    });
  }
});

// UPDATE DATABASE SCHEMA
app.post('/api/admin/update-schema', async (req, res) => {
  try {
    await pool.query(`
      ALTER TABLE painting 
      ADD COLUMN IF NOT EXISTS features TEXT,
      ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) DEFAULT 'pending'
    `);
    
    res.json({ success: true, message: 'Database schema updated for AI features' });
  } catch (error) {
    console.error('Schema update error:', error);
    res.status(500).json({ success: false, message: 'Schema update failed', error: error.message });
  }
});

// AI DESCRIPTION GENERATION ENDPOINT
app.post('/api/admin/generate-description', async (req, res) => {
    try {
        const { title, artist, year, museum } = req.body;
        
        if (!title || !artist) {
            return res.status(400).json({
                success: false,
                message: 'Title and artist are required'
            });
        }

        console.log(`🤖 Generating description for: "${title}" by ${artist}`);

        const description = await generateArtworkDescription(title, artist, year, museum);
        
        res.json({
            success: true,
            description: description
        });

    } catch (error) {
        console.error('Description generation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate description',
            error: error.message
        });
    }
});

// DESCRIPTION IMPROVEMENT ENDPOINT  
app.post('/api/admin/improve-description', async (req, res) => {
    try {
        const { currentDescription, title, artist } = req.body;
        
        if (!currentDescription) {
            return res.status(400).json({
                success: false,
                message: 'Current description is required'
            });
        }

        console.log(`✨ Improving description for: "${title}" by ${artist}`);

        const improvedDescription = await improveArtworkDescription(currentDescription, title, artist);
        
        res.json({
            success: true,
            description: improvedDescription
        });

    } catch (error) {
        console.error('Description improvement error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to improve description',
            error: error.message
        });
    }
});

// ADD NEW PAINTING ENDPOINT
app.post('/api/admin/add-painting', async (req, res) => {
    try {
        const { title, artist, year, description, museum, wikiLink } = req.body;
        
        if (!title || !artist) {
            return res.status(400).json({
                success: false,
                message: 'Title and artist are required'
            });
        }
        
        const insertQuery = `
            INSERT INTO painting (
                title, artist, year, description, museum, wiki_link,
                view_count, processing_status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 0, 'pending', NOW())
            RETURNING *
        `;
        
        const result = await pool.query(insertQuery, [
            title,
            artist,
            year || null,
            description || null,
            museum || 'National Gallery, London',
            wikiLink || null
        ]);
        
        const painting = result.rows[0];
        
        console.log(`✅ Added painting: "${title}" by ${artist} (ID: ${painting.id})`);
        
        res.json({
            success: true,
            painting: painting,
            message: 'Painting added successfully'
        });

    } catch (error) {
        console.error('Add painting error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add painting',
            error: error.message
        });
    }
});

// AI DESCRIPTION GENERATION FUNCTIONS
async function generateArtworkDescription(title, artist, year, museum) {
    // Try Claude API first, fallback to templates
    if (process.env.ANTHROPIC_API_KEY) {
        try {
            return await generateWithClaude(title, artist, year, museum);
        } catch (error) {
            console.error('Claude API error, falling back to templates:', error);
            return generateTemplateDescription(title, artist, year, museum);
        }
    } else {
        console.log('No Claude API key, using templates');
        return generateTemplateDescription(title, artist, year, museum);
    }
}

async function generateWithClaude(title, artist, year, museum) {
    try {
        const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-3-haiku-20240307',
            max_tokens: 200,
            messages: [{
                role: 'user',
                content: `Write a concise, engaging 2-3 sentence description for the painting "${title}" by ${artist}${year ? ` (${year})` : ''} housed in ${museum}. Focus on the artistic style, subject matter, and historical significance. Make it informative but accessible to museum visitors.`
            }]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            }
        });

        return response.data.content[0].text.trim();

    } catch (error) {
        console.error('Claude API error:', error.response?.data || error.message);
        throw new Error('Claude API request failed');
    }
}

function generateTemplateDescription(title, artist, year, museum) {
    // Smart templates based on famous artists (fallback)
    const artistTemplates = {
        'turner': `"${title}" by J.M.W. Turner${year ? ` (${year})` : ''} exemplifies the artist's mastery of light and atmospheric effects. This ${museum} masterpiece demonstrates Turner's innovative approach to landscape painting, with its luminous palette and dynamic brushwork capturing the sublime power of nature.`,
        
        'constable': `"${title}" by John Constable${year ? ` (${year})` : ''} represents the pinnacle of English landscape painting. Housed in ${museum}, this work showcases Constable's revolutionary plein air technique and his deep emotional connection to the English countryside, influencing generations of artists.`,
        
        'van gogh': `"${title}" by Vincent van Gogh${year ? ` (${year})` : ''} displays the artist's distinctive post-impressionist style with bold colors and expressive brushstrokes. This ${museum} treasure captures van Gogh's unique vision and emotional intensity that would influence modern art profoundly.`,
        
        'default': `"${title}" by ${artist}${year ? ` (${year})` : ''} is a significant work housed in ${museum}. This painting demonstrates ${artist}'s distinctive artistic style and represents an important contribution to the museum's collection, continuing to inspire and educate visitors about the evolution of art.`
    };

    // Find matching template based on artist name
    const artistKey = Object.keys(artistTemplates).find(key => 
        artist.toLowerCase().includes(key)
    ) || 'default';

    return artistTemplates[artistKey];
}

async function improveArtworkDescription(currentDescription, title, artist) {
    // Try Claude API first for improvements
    if (process.env.ANTHROPIC_API_KEY) {
        try {
            const response = await axios.post('https://api.anthropic.com/v1/messages', {
                model: 'claude-3-haiku-20240307',
                max_tokens: 200,
                messages: [{
                    role: 'user',
                    content: `Please improve this art description for "${title}" by ${artist}:\n\n"${currentDescription}"\n\nMake it more engaging, accurate, and informative while keeping it concise (2-3 sentences). Focus on artistic technique, historical context, or visual elements.`
                }]
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                }
            });

            return response.data.content[0].text.trim();

        } catch (error) {
            console.error('Claude improvement error:', error);
            // Fall back to simple improvements
            return enhanceDescriptionText(currentDescription);
        }
    } else {
        return enhanceDescriptionText(currentDescription);
    }
}

function enhanceDescriptionText(description) {
    // Simple text improvements (fallback)
    let improved = description;
    improved = improved.replace(/painting/g, 'masterpiece');
    improved = improved.replace(/shows/g, 'depicts');
    improved = improved.replace(/made/g, 'created');
    improved = improved.replace(/work/g, 'artistic achievement');
    improved = improved.charAt(0).toUpperCase() + improved.slice(1);
    return improved;
}

// Initialize the model when server starts
loadModel();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎨 ArtSpotter AI server running on port ${PORT}`);
  console.log('Real image recognition active!');
  console.log('Claude API:', process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured');
});

module.exports = app;,
            description: improvedDescription
        });

    } catch (error) {
        console.error('Description improvement error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to improve description',
            error: error.message
        });
    }
});

// ADD NEW PAINTING ENDPOINT
app.post('/api/admin/add-painting', async (req, res) => {
    try {
        const { title, artist, year, description, museum, wikiLink } = req.body;
        
        if (!title || !artist) {
            return res.status(400).json({
                success: false,
                message: 'Title and artist are required'
            });
        }
        
        const insertQuery = `
            INSERT INTO painting (
                title, artist, year, description, museum, wiki_link,
                view_count, processing_status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 0, 'pending', NOW())
            RETURNING *
        `;
        
        const result = await pool.query(insertQuery, [
            title,
            artist,
            year || null,
            description || null,
            museum || 'National Gallery, London',
            wikiLink || null
        ]);
        
        const painting = result.rows[0];
        
        console.log(`✅ Added painting: "${title}" by ${artist} (ID: ${painting.id})`);
        
        res.json({
            success: true,
            painting: painting,
            message: 'Painting added successfully'
        });

    } catch (error) {
        console.error('Add painting error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add painting',
            error: error.message
        });
    }
});

// AI DESCRIPTION GENERATION FUNCTIONS
async function generateArtworkDescription(title, artist, year, museum) {
    // Try Claude API first, fallback to templates
    if (process.env.ANTHROPIC_API_KEY) {
        try {
            return await generateWithClaude(title, artist, year, museum);
        } catch (error) {
            console.error('Claude API error, falling back to templates:', error);
            return generateTemplateDescription(title, artist, year, museum);
        }
    } else {
        console.log('No Claude API key, using templates');
        return generateTemplateDescription(title, artist, year, museum);
    }
}

async function generateWithClaude(title, artist, year, museum) {
    try {
        const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-3-haiku-20240307',
            max_tokens: 200,
            messages: [{
                role: 'user',
                content: `Write a concise, engaging 2-3 sentence description for the painting "${title}" by ${artist}${year ? ` (${year})` : ''} housed in ${museum}. Focus on the artistic style, subject matter, and historical significance. Make it informative but accessible to museum visitors.`
            }]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            }
        });

        return response.data.content[0].text.trim();

    } catch (error) {
        console.error('Claude API error:', error.response?.data || error.message);
        throw new Error('Claude API request failed');
    }
}

function generateTemplateDescription(title, artist, year, museum) {
    // Smart templates based on famous artists (fallback)
    const artistTemplates = {
        'turner': `"${title}" by J.M.W. Turner${year ? ` (${year})` : ''} exemplifies the artist's mastery of light and atmospheric effects. This ${museum} masterpiece demonstrates Turner's innovative approach to landscape painting, with its luminous palette and dynamic brushwork capturing the sublime power of nature.`,
        
        'constable': `"${title}" by John Constable${year ? ` (${year})` : ''} represents the pinnacle of English landscape painting. Housed in ${museum}, this work showcases Constable's revolutionary plein air technique and his deep emotional connection to the English countryside, influencing generations of artists.`,
        
        'van gogh': `"${title}" by Vincent van Gogh${year ? ` (${year})` : ''} displays the artist's distinctive post-impressionist style with bold colors and expressive brushstrokes. This ${museum} treasure captures van Gogh's unique vision and emotional intensity that would influence modern art profoundly.`,
        
        'default': `"${title}" by ${artist}${year ? ` (${year})` : ''} is a significant work housed in ${museum}. This painting demonstrates ${artist}'s distinctive artistic style and represents an important contribution to the museum's collection, continuing to inspire and educate visitors about the evolution of art.`
    };

    // Find matching template based on artist name
    const artistKey = Object.keys(artistTemplates).find(key => 
        artist.toLowerCase().includes(key)
    ) || 'default';

    return artistTemplates[artistKey];
}

async function improveArtworkDescription(currentDescription, title, artist) {
    // Try Claude API first for improvements
    if (process.env.ANTHROPIC_API_KEY) {
        try {
            const response = await axios.post('https://api.anthropic.com/v1/messages', {
                model: 'claude-3-haiku-20240307',
                max_tokens: 200,
                messages: [{
                    role: 'user',
                    content: `Please improve this art description for "${title}" by ${artist}:\n\n"${currentDescription}"\n\nMake it more engaging, accurate, and informative while keeping it concise (2-3 sentences). Focus on artistic technique, historical context, or visual elements.`
                }]
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                }
            });

            return response.data.content[0].text.trim();

        } catch (error) {
            console.error('Claude improvement error:', error);
            // Fall back to simple improvements
            return enhanceDescriptionText(currentDescription);
        }
    } else {
        return enhanceDescriptionText(currentDescription);
    }
}

function enhanceDescriptionText(description) {
    // Simple text improvements (fallback)
    let improved = description;
    improved = improved.replace(/painting/g, 'masterpiece');
    improved = improved.replace(/shows/g, 'depicts');
    improved = improved.replace(/made/g, 'created');
    improved = improved.replace(/work/g, 'artistic achievement');
    improved = improved.charAt(0).toUpperCase() + improved.slice(1);
    return improved;
}

// Initialize the model when server starts
loadModel();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎨 ArtSpotter AI server running on port ${PORT}`);
  console.log('Real image recognition active!');
  console.log('Claude API:', process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured');
});

module.exports = app;