// Delivery zone calculator using Google Maps Distance Matrix API
// Origin: 619 N Main St Unit 3, O'Fallon, MO 63366 (not shown to customers)

const ORIGIN_ADDRESS = '619 N Main St Unit 3, O\'Fallon, MO 63366';
const MAX_DELIVERY_MILES = 20; // outside this = no delivery

function getZoneFromMiles(miles) {
  if (miles <= 10) return 'zone1';
  if (miles <= 15) return 'zone2';
  if (miles <= 20) return 'zone3';
  return null;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { address } = body;

    if (!address) {
      return Response.json({ error: 'Address is required' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Google Maps API key not configured' }, { status: 500 });
    }

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?` +
      `origins=${encodeURIComponent(ORIGIN_ADDRESS)}` +
      `&destinations=${encodeURIComponent(address)}` +
      `&units=imperial` +
      `&key=${apiKey}`;

    const res = await fetch(url);
    const data = await res.json();

    console.log('Google Maps response:', JSON.stringify(data));

    if (data.status !== 'OK') {
      return Response.json({ error: 'Could not look up this address. Please check and try again.' }, { status: 400 });
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') {
      return Response.json({ error: 'Address not found or unreachable. Please enter a full street address.' }, { status: 400 });
    }

    // Distance comes back in meters — convert to miles
    const distanceMeters = element.distance.value;
    const distanceMiles = distanceMeters / 1609.344;
    const distanceMilesRounded = Math.round(distanceMiles * 10) / 10;

    const zone = getZoneFromMiles(distanceMilesRounded);

    if (!zone) {
      return Response.json({
        error: `This address is ${distanceMilesRounded} miles away, which is outside our current delivery range (${MAX_DELIVERY_MILES} miles).`,
        distance: distanceMilesRounded,
        zone: null,
      }, { status: 400 });
    }

    console.log(`Delivery zone resolved: ${zone} (${distanceMilesRounded} miles) for "${address}"`);

    return Response.json({
      distance: distanceMilesRounded,
      zone,
      address_resolved: data.destination_addresses?.[0],
    });
  } catch (error) {
    console.error('calculateDeliveryZone error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});