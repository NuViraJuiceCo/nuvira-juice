import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const { query } = await req.json();
    if (!query || query.length < 3) {
      return Response.json({ suggestions: [] });
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(query)}&countrycodes=us`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'NuViraJuiceApp/1.0' }
    });
    const data = await res.json();
    const suggestions = data.map(d => d.display_name);
    return Response.json({ suggestions });
  } catch (error) {
    console.error('Address suggest error:', error);
    return Response.json({ suggestions: [] });
  }
});