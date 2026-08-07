import fs from 'fs';

const code = fs.readFileSync('server.ts', 'utf8');

const newEndpoint = `
// ==========================================
// 4. WORDPRESS STATS ENDPOINT
// ==========================================
app.post('/api/wp/stats', async (req, res) => {
  try {
    const { wpUrl, wpUsername, wpAppPassword } = req.body;
    if (!wpUrl) return res.status(400).json({ success: false, message: 'wpUrl is required' });

    const baseUrl = wpUrl.replace(/\\/$/, '');
    const headers = { 'Content-Type': 'application/json' };
    
    if (wpUsername && wpAppPassword) {
      headers['Authorization'] = 'Basic ' + Buffer.from(\`\${wpUsername}:\${wpAppPassword}\`).toString('base64');
    }

    const fetchStat = async (endpoint) => {
      try {
        const response = await fetch(\`\${baseUrl}/wp-json/wp/v2/\${endpoint}?per_page=1\`, { headers });
        if (response.ok) {
          return response.headers.get('x-wp-total') || '0';
        }
        return 'N/A';
      } catch (err) {
        return 'Err';
      }
    };

    const [totalPosts, totalPages, totalComments, totalMedia] = await Promise.all([
      fetchStat('posts'),
      fetchStat('pages'),
      fetchStat('comments'),
      fetchStat('media')
    ]);

    return res.json({
      success: true,
      stats: {
        totalPosts,
        totalPages,
        totalComments,
        totalMedia
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

`;

if (!code.includes('/api/wp/stats')) {
  const parts = code.split("app.get('/api/export/sql'");
  const newCode = parts[0] + newEndpoint + "app.get('/api/export/sql'" + parts[1];
  fs.writeFileSync('server.ts', newCode);
  console.log('Endpoint added');
} else {
  console.log('Endpoint already exists');
}
