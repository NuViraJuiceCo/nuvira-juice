Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { address } = body;

    if (!address) {
      return Response.json({ error: 'Address is required' }, { status: 400 });
    }

    // Store location (O'Fallon, MO)
    const storeCoords = { lat: 38.6783, lng: -90.7367 };

    // Geocode customer address using free Nominatim API (OpenStreetMap)
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const geocodeRes = await fetch(geocodeUrl, {
      headers: { 'User-Agent': 'NuVira-Juice-App' }
    });
    const geocodeData = await geocodeRes.json();

    if (!geocodeData || geocodeData.length === 0) {
      return Response.json({ error: 'Address not found' }, { status: 400 });
    }

    const customerCoords = { lat: parseFloat(geocodeData[0].lat), lng: parseFloat(geocodeData[0].lon) };

    // Calculate distance using haversine formula
    const R = 3959; // Earth's radius in miles
    const dLat = (customerCoords.lat - storeCoords.lat) * Math.PI / 180;
    const dLng = (customerCoords.lng - storeCoords.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(storeCoords.lat * Math.PI / 180) * Math.cos(customerCoords.lat * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    // Determine zone based on distance
    let zone = null;
    if (distance <= 5) {
      zone = 'zone1';
    } else if (distance <= 10) {
      zone = 'zone2';
    } else if (distance <= 15) {
      zone = 'zone3';
    } else {
      return Response.json({ error: 'Address is outside delivery range (max 15 miles)' }, { status: 400 });
    }

    return Response.json({
      distance,
      zone,
      formatted_address: geocodeData[0].display_name,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});