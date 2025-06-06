// ArtSpotter Backend API - Copy this ENTIRE code into api/index.js

const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Simple painting database (stored in memory for now)
const paintingDatabase = [
  {
    id: 1,
    title: "The Starry Night",
    artist: "Vincent van Gogh",
    year: 1889,
    description: "A swirling night sky over a French village, painted during van Gogh's stay at the Saint-Paul-de-Mausole asylum. The painting features bold, dynamic brushstrokes and a vibrant color palette.",
    museum: "Museum of Modern Art, New York",
    tags: ["Post-Impressionism", "Night scenes", "Swirls", "Blue", "Yellow", "Cypresses"],
    wikiLink: "https://en.wikipedia.org/wiki/The_Starry_Night",
    confidence: 0.92
  },
  {
    id: 2,
    title: "Mona Lisa",
    artist: "Leonardo da Vinci",
    year: 1503,
    description: "The world's most famous portrait, known for the subject's enigmatic smile and da Vinci's revolutionary sfumato technique. Painted on poplar wood.",
    museum: "Louvre Museum, Paris",
    tags: ["Renaissance", "Portrait", "Sfumato", "Enigmatic smile", "Oil painting"],
    wikiLink: "https://en.wikipedia.org/wiki/Mona_Lisa",
    confidence: 0.95
  },
  {
    id: 3,
    title: "The Great Wave off Kanagawa",
    artist: "Katsushika Hokusai",
    year: 1831,
    description: "An iconic Japanese woodblock print depicting a large wave threatening boats off the coast of Kanagawa, with Mount Fuji visible in the background.",
    museum: "Various collections worldwide",
    tags: ["Japanese art", "Ukiyo-e", "Woodblock print", "Wave", "Mount Fuji", "Blue"],
    wikiLink: "https://en.wikipedia.org/wiki/The_Great_Wave_off_Kanagawa",
    confidence: 0.88
  },
  {
    id: 4,
    title: "Girl with a Pearl Earring",
    artist: "Johannes Vermeer",
    year: 1665,
    description: "A captivating portrait known as the 'Mona Lisa of the North', featuring a girl with an exotic turban and a large, luminous pearl earring.",
    museum: "Mauritshuis, The Hague",
    tags: ["Baroque", "Portrait", "Pearl", "Turban", "Dutch Golden Age", "Oil painting"],
    wikiLink: "https://en.wikipedia.org/wiki/Girl_with_a_Pearl_Earring",
    confidence: 0.91
  },
  {
    id: 5,
    title: "The Persistence of Memory",
    artist: "Salvador Dalí",
    year: 1931,
    description: "A surrealist masterpiece featuring melting clocks in a dreamlike landscape, exploring concepts of time and memory.",
    museum: "Museum of Modern Art, New York",
    tags: ["Surrealism", "Melting clocks", "Dream", "Time", "Desert landscape"],
    wikiLink: "https://en.wikipedia.org/wiki/The_Persistence_of_Memory",
    confidence: 0.89
  },
  {
    id: 6,
    title: "American Gothic",
    artist: "Grant Wood",
    year: 1930,
    description: "An iconic American painting depicting a farmer holding a pitchfork alongside his daughter in front of a house with Gothic Revival architecture.",
    museum: "Art Institute of Chicago",
    tags: ["American Regionalism", "Rural life", "Gothic architecture", "Pitchfork", "Portrait"],
    wikiLink: "https://en.wikipedia.org/wiki/American_Gothic",
    confidence: 0.87
  }
];

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    paintings: paintingDatabase.length 
  });
});

// Get database stats
app.get('/api/database-stats', (req, res) => {
  res.json({
    totalPaintings: paintingDatabase.length,
    artists: [...new Set(paintingDatabase.map(p => p.artist))].length,
    museums: [...new Set(paintingDatabase.map(p => p.museum))].length
  });
});

// Simple image recognition (simulated)
app.post('/api/recognize', async (req, res) => {
  try {
    const { image } = req.body;
    
    if (!image) {
      return res.status(400).json({
        success: false,
        message: 'No image provided'
      });
    }
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    
    // Simulate AI recognition by picking a random painting
    // In real version, this would analyze the actual image
    const randomPainting = paintingDatabase[Math.floor(Math.random() * paintingDatabase.length)];
    
    // Add some randomness to confidence
    const confidence = randomPainting.confidence + (Math.random() * 0.1 - 0.05);
    
    if (confidence < 0.3) {
      return res.json({
        success: false,
        message: 'No matching artwork found. Try a clearer image or different angle.',
        confidence: confidence
      });
    }
    
    // Return the match
    res.json({
      success: true,
      result: {
        ...randomPainting,
        confidence: confidence,
        processingTime: Math.round(1000 + Math.random() * 2000)
      }
    });
    
  } catch (error) {
    console.error('Recognition error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during recognition'
    });
  }
});

// Search paintings
app.get('/api/search', (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({
      success: false,
      message: 'Search query required'
    });
  }
  
  const results = paintingDatabase.filter(painting => 
    painting.title.toLowerCase().includes(q.toLowerCase()) ||
    painting.artist.toLowerCase().includes(q.toLowerCase())
  );
  
  res.json({
    success: true,
    results: results
  });
});

// Get all paintings
app.get('/api/paintings', (req, res) => {
  res.json({
    success: true,
    paintings: paintingDatabase
  });
});

// For Vercel deployment
module.exports = app;

// For local development
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🎨 ArtSpotter API running on port ${PORT}`);
    console.log(`📊 Database loaded with ${paintingDatabase.length} paintings`);
  });
}