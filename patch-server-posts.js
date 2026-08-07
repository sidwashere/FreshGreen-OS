import fs from 'fs';

const code = fs.readFileSync('server.ts', 'utf8');

const newEndpoint = `
// ==========================================
// 5. WORDPRESS POSTS ENDPOINT
// ==========================================
app.post('/api/wp/posts', async (req, res) => {
  try {
    const { wpUrl, wpUsername, wpAppPassword, per_page = 5 } = req.body;
    if (!wpUrl) return res.status(400).json({ success: false, message: 'wpUrl is required' });

    const baseUrl = wpUrl.replace(/\\/$/, '');
    const headers = { 'Content-Type': 'application/json' };
    
    if (wpUsername && wpAppPassword) {
      headers['Authorization'] = 'Basic ' + Buffer.from(\`\${wpUsername}:\${wpAppPassword}\`).toString('base64');
    }

    const response = await fetch(\`\${baseUrl}/wp-json/wp/v2/posts?per_page=\${per_page}&_embed=1\`, { headers });
    if (response.ok) {
      const posts = await response.json();
      return res.json({ success: true, posts });
    } else {
      return res.status(response.status).json({ success: false, message: 'Failed to fetch posts from WordPress' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

`;

if (!code.includes('/api/wp/posts')) {
  const parts = code.split("app.get('/api/export/sql'");
  const newCode = parts[0] + newEndpoint + "app.get('/api/export/sql'" + parts[1];
  fs.writeFileSync('server.ts', newCode);
  console.log('Posts endpoint added');
} else {
  console.log('Posts endpoint already exists');
}
