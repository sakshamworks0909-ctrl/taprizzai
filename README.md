# Tap to Review (AI version)

Files: index.html (site) and api/generate.js (AI function). Keep this folder structure.

Deploy on Vercel:
1. Upload this folder to a GitHub repo (index.html and the api folder at the top level).
2. Vercel > Add New > Project > import the repo. Framework: Other. No build command.
3. Settings > Environment Variables:
   - ANTHROPIC_API_KEY  (required, from console.anthropic.com)
   - GOOGLE_PLACES_API_KEY  (optional, reads your Google profile category and reviews for tone)
4. Redeploy after adding variables.

If the AI fails, the page falls back to built-in templates automatically.
