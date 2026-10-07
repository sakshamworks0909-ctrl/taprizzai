// Vercel serverless function: generates 3 review suggestions with Claude.
// Env vars: GEMINI_API_KEY (free tier) OR ANTHROPIC_API_KEY (paid). Optional: GOOGLE_PLACES_API_KEY, MODEL
const cache = new Map();
const clip = (s, n) => String(s || '').slice(0, n);

async function lookupPlace(name, area) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !area) return '';
  const q = `${name} ${area}`;
  if (cache.has(q)) return cache.get(q);
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.rating,places.primaryTypeDisplayName,places.reviews'
      },
      body: JSON.stringify({ textQuery: q, maxResultCount: 1 })
    });
    const p = (await r.json()).places?.[0];
    if (!p) return '';
    const snippets = (p.reviews || []).slice(0, 5).map(v => '- ' + clip(v.text?.text, 160)).join('\n');
    const ctx = `Google profile: category "${p.primaryTypeDisplayName?.text || ''}", rating ${p.rating || 'n/a'}.\nExisting reviews (for tone only, never copy):\n${snippets}`;
    cache.set(q, ctx);
    return ctx;
  } catch { return ''; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const gKey = process.env.GEMINI_API_KEY, aKey = process.env.ANTHROPIC_API_KEY;
  if (!gKey && !aKey) return res.status(500).json({ error: 'API key missing' });

  const b = req.body || {};
  const name = clip(b.b, 80), cat = clip(b.c, 60), area = clip(b.p, 80);
  const services = (Array.isArray(b.s) ? b.s : []).slice(0, 10).map(x => clip(x, 50));
  const tags = (Array.isArray(b.t) ? b.t : []).slice(0, 6).map(x => clip(x, 30));
  const rating = Math.min(5, Math.max(1, parseInt(b.r) || 5));
  const lang = { hinglish: 'Hinglish (Hindi written in English letters, natural everyday style)', hi: 'Hindi (Devanagari)' }[b.l] || 'English';
  if (!name) return res.status(400).json({ error: 'missing business' });

  const place = await lookupPlace(name, area);
  const system = 'You help real customers phrase their own feedback. Output only a JSON array of strings, no markdown.';
  const prompt = `Business: ${name}${cat ? ` (${cat})` : ''}${area ? `, ${area}` : ''}
Services/products: ${services.join(', ') || 'not given'}
Customer rating: ${rating} out of 5
${tags.length ? `Customer says these stood out / need work: ${tags.join(', ')}` : ''}
${place}

Write 3 different review drafts in ${lang}, in first person, as the customer.
Rules:
- Tone must match ${rating} stars. For 1-3 stars be polite, specific to the selected topics, and honest; do not be abusive.
- Draft 1: 1 sentence. Draft 2: 2 sentences. Draft 3: 3-4 sentences.
- Only mention services or topics listed above. Do not invent names, prices, dates, staff names or offers.
- Each draft must sound different, natural, human. No hashtags, at most one emoji.
Return exactly: ["draft1","draft2","draft3"]`;

  try {
    let text = '';
    if (gKey) {
      const model = process.env.MODEL || 'gemini-2.5-flash';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': gKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 1, maxOutputTokens: 1500, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
        })
      });
      const d = await r.json();
      text = (d.candidates?.[0]?.content?.parts || []).map(c => c.text || '').join('');
    } else {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': aKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: process.env.MODEL || 'claude-haiku-4-5-20251001',
          max_tokens: 700, temperature: 1, system,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const d = await r.json();
      text = (d.content || []).map(c => c.text || '').join('');
    }
    text = text.replace(/```json|```/g, '').trim();
    const reviews = JSON.parse(text).filter(x => typeof x === 'string').slice(0, 3);
    if (!reviews.length) throw new Error('empty');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ reviews });
  } catch (e) {
    return res.status(502).json({ error: 'generation failed' });
  }
}
