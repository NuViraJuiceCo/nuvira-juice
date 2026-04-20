// Address autocomplete using Google Places Autocomplete API
// Biased toward O'Fallon, MO area

Deno.serve(async (req) => {
  try {
    const { query } = await req.json();
    if (!query || query.length < 3) {
      return Response.json({ suggestions: [] });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Google Maps API key not configured' }, { status: 500 });
    }

    // Use Places Autocomplete API, biased to O'Fallon, MO area
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?` +
      `input=${encodeURIComponent(query)}` +
      `&types=address` +
      `&components=country:us` +
      `&location=38.8106,-90.6998` +  // O'Fallon, MO coords
      `&radius=40000` +               // 40km (~25 miles) bias radius
      `&key=${apiKey}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('Places API error:', data.status, data.error_message);
      return Response.json({ suggestions: [] });
    }

    // For each prediction, fetch place details to get structured address components
    const suggestions = await Promise.all(
      (data.predictions || []).slice(0, 5).map(async (prediction) => {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?` +
          `place_id=${prediction.place_id}` +
          `&fields=address_components` +
          `&key=${apiKey}`;

        const detailRes = await fetch(detailUrl);
        const detailData = await detailRes.json();
        const components = detailData.result?.address_components || [];

        const get = (type) => components.find(c => c.types.includes(type))?.long_name || '';
        const getShort = (type) => components.find(c => c.types.includes(type))?.short_name || '';

        const streetNumber = get('street_number');
        const route = get('route');
        const street = [streetNumber, route].filter(Boolean).join(' ');
        const city = get('locality') || get('sublocality') || get('administrative_area_level_3');
        const state = getShort('administrative_area_level_1');
        const zip = get('postal_code');

        return { street, city, state, zip, display: prediction.description };
      })
    );

    return Response.json({ suggestions });
  } catch (error) {
    console.error('Address suggest error:', error);
    return Response.json({ suggestions: [] });
  }
});