// Delivery zone calculator using Google Maps Distance Matrix API
// Origin: 619 N Main St Unit 3, O'Fallon, MO 63366 (not shown to customers)

const ORIGIN_ADDRESS = "619 N Main St Unit 3, O'Fallon, MO 63366";
const MAX_DELIVERY_MILES = 15; // outside this = out of area (show waitlist modal)

function getZoneFromMiles(miles) {
  if (miles <= 10) return 'zone1';
  if (miles <= 15) return 'zone2';
  return null;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { address } = body;

    if (!address) {
      return Response.json({ ok: false, error: 'Address is required', distance: null, zone: null }, { status: 200 });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({ ok: false, error: 'Google Maps API key not configured', distance: null, zone: null }, { status: 200 });
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
      return Response.json({
        ok: false,
        error: 'Could not look up this address. Please check and try again.',
        distance: null,
        zone: null,
      }, { status: 200 });
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') {
      return Response.json({
        ok: false,
        error: 'Address not found or unreachable. Please enter a full street address.',
        distance: null,
        zone: null,
      }, { status: 200 });
    }

    // Distance comes back in meters — convert to miles
    const distanceMeters = element.distance.value;
    const distanceMiles = distanceMeters / 1609.344;
    const distanceMilesRounded = Math.round(distanceMiles * 10) / 10;

    const zone = getZoneFromMiles(distanceMilesRounded);

    if (!zone) {
      console.log(`Out of area: ${distanceMilesRounded} miles for "${address}"`);
      return Response.json({
        ok: false,
        error: `This address is ${distanceMilesRounded} miles away, which is outside our current delivery range (${MAX_DELIVERY_MILES} miles).`,
        distance: distanceMilesRounded,
        zone: null,
      }, { status: 200 });
    }

    console.log(`Delivery zone resolved: ${zone} (${distanceMilesRounded} miles) for "${address}"`);

    return Response.json({
      ok: true,
      distance: distanceMilesRounded,
      zone,
      address_resolved: data.destination_addresses?.[0],
    }, { status: 200 });

  } catch (error) {
    console.error('calculateDeliveryZone error:', error);
    return Response.json({ ok: false, error: error.message, distance: null, zone: null }, { status: 200 });
  }
});