// Simple zip code lookup for delivery zones (O'Fallon, MO based)
// Zone 1: 63366 (O'Fallon), 63368 (Lake St. Louis), 63385 (Wentzville) = 0-10 miles
// Zone 2: 63301-63304 (St. Charles area), 63376 (St. Peters) = ~8-12 miles
// Zone 3: 63101-63199 (St. Louis area) = ~12-15 miles

const STORE_ZIP = '63366';
const ZONE_LOOKUP = {
  '63366': { zone: 'zone1', distance: 0 },   // O'Fallon
  '63368': { zone: 'zone1', distance: 5 },   // Lake St. Louis
  '63385': { zone: 'zone1', distance: 8 },   // Wentzville
  '63386': { zone: 'zone1', distance: 10 },  // Wentzville (alt)
  '63303': { zone: 'zone2', distance: 8 },
  '63304': { zone: 'zone2', distance: 8 },
  '63301': { zone: 'zone2', distance: 8 },
  '63302': { zone: 'zone2', distance: 8 },
  '63376': { zone: 'zone2', distance: 10 },  // St. Peters
  '63367': { zone: 'zone2', distance: 12 },  // Lake St. Louis / Dardenne Prairie
  '63101': { zone: 'zone3', distance: 12 },
  '63102': { zone: 'zone3', distance: 12 },
  '63103': { zone: 'zone3', distance: 12 },
  '63104': { zone: 'zone3', distance: 12 },
  '63105': { zone: 'zone3', distance: 12 },
  '63106': { zone: 'zone3', distance: 12 },
  '63107': { zone: 'zone3', distance: 12 },
  '63108': { zone: 'zone3', distance: 12 },
  '63109': { zone: 'zone3', distance: 12 },
  '63110': { zone: 'zone3', distance: 12 },
  '63111': { zone: 'zone3', distance: 12 },
  '63112': { zone: 'zone3', distance: 12 },
  '63113': { zone: 'zone3', distance: 12 },
  '63114': { zone: 'zone3', distance: 12 },
  '63115': { zone: 'zone3', distance: 12 },
  '63116': { zone: 'zone3', distance: 12 },
  '63117': { zone: 'zone3', distance: 12 },
  '63118': { zone: 'zone3', distance: 12 },
  '63119': { zone: 'zone3', distance: 12 },
  '63120': { zone: 'zone3', distance: 12 },
  '63121': { zone: 'zone3', distance: 12 },
  '63122': { zone: 'zone3', distance: 12 },
  '63123': { zone: 'zone3', distance: 12 },
  '63124': { zone: 'zone3', distance: 12 },
  '63125': { zone: 'zone3', distance: 12 },
  '63126': { zone: 'zone3', distance: 12 },
  '63127': { zone: 'zone3', distance: 12 },
  '63128': { zone: 'zone3', distance: 12 },
  '63129': { zone: 'zone3', distance: 12 },
  '63130': { zone: 'zone3', distance: 12 },
  '63131': { zone: 'zone3', distance: 12 },
  '63132': { zone: 'zone3', distance: 12 },
  '63133': { zone: 'zone3', distance: 12 },
  '63134': { zone: 'zone3', distance: 12 },
  '63135': { zone: 'zone3', distance: 12 },
  '63136': { zone: 'zone3', distance: 12 },
  '63137': { zone: 'zone3', distance: 12 },
  '63138': { zone: 'zone3', distance: 12 },
  '63139': { zone: 'zone3', distance: 12 },
  '63140': { zone: 'zone3', distance: 12 },
};

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { address } = body;

    if (!address) {
      return Response.json({ error: 'Address is required' }, { status: 400 });
    }

    // Extract zip code from address (look for 5-digit number)
    const zipMatch = address.match(/\b\d{5}\b/);
    if (!zipMatch) {
      return Response.json({ error: 'Please include a valid zip code in your address' }, { status: 400 });
    }

    const zip = zipMatch[0];
    const zoneInfo = ZONE_LOOKUP[zip];

    if (!zoneInfo) {
      return Response.json({ error: 'This zip code is outside our delivery range. We currently deliver within Zone 3 (max 15 miles).' }, { status: 400 });
    }

    return Response.json({
      distance: zoneInfo.distance,
      zone: zoneInfo.zone,
      zip_code: zip,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});