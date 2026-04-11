import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { address } = body;

    if (!address) {
      return Response.json({ error: 'Address is required' }, { status: 400 });
    }

    // Store location (O'Fallon, MO)
    const storeCoords = { lat: 38.6783, lng: -90.7367 };

    // Geocode customer address using Google Geocoding API
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${Deno.env.get('GOOGLE_MAPS_API_KEY')}`;
    const geocodeRes = await fetch(geocodeUrl);
    const geocodeData = await geocodeRes.json();

    if (!geocodeData.results || geocodeData.results.length === 0) {
      return Response.json({ error: 'Address not found' }, { status: 400 });
    }

    const customerCoords = geocodeData.results[0].geometry.location;

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
      formatted_address: geocodeData.results[0].formatted_address,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});