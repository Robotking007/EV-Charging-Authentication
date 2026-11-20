const SOURCE = "https://api.openchargemap.io/v3/poi/";
const REFRESH_MS = 10 * 60_000;
const RESULT_LIMIT = 200;

function normalizeStation(place) {
  const address = place.AddressInfo ?? {};
  const connectors = (place.Connections ?? []).map((connector) => ({
    id: connector.ID,
    type: connector.ConnectionType?.Title ?? "Connector type unreported",
    powerKW: connector.PowerKW ?? null,
    quantity: connector.Quantity ?? null
  }));
  return {
    id: place.ID,
    name: address.Title || `Station ${place.ID}`,
    address: [...new Set([address.AddressLine1, address.Town, address.StateOrProvince, address.Postcode].filter(Boolean))].join(", "),
    latitude: address.Latitude,
    longitude: address.Longitude,
    operator: place.OperatorInfo?.Title ?? null,
    status: place.StatusType?.Title ?? "Status unreported",
    operational: place.StatusType?.IsOperational === true,
    access: place.UsageType?.Title ?? null,
    cost: place.UsageCost || null,
    lastVerified: place.DateLastVerified ?? null,
    dataProvider: place.DataProvider?.Title || "Open Charge Map",
    dataLicense: place.DataProvider?.License ?? null,
    connectors
  };
}

function registerOpenChargeMap(app, db) {
  const cache = db?.collection("public_station_directory");
  const inFlight = new Map();
  const apiKey = process.env.OPEN_CHARGE_MAP_API_KEY;

  async function fetchStations(country, previous) {
    const url = new URL(SOURCE);
    url.search = new URLSearchParams({
      output: "json", countrycode: country, maxresults: String(RESULT_LIMIT),
      compact: "false", verbose: "true", opendata: "true"
    }).toString();

    try {
      const response = await fetch(url, {
        headers: { "X-API-Key": apiKey, "User-Agent": "EVChargingTrustStationDirectory/1.0" },
        signal: AbortSignal.timeout(12000),
        redirect: "error"
      });
      if (!response.ok) throw new Error(`Open Charge Map returned HTTP ${response.status}.`);
      const locations = await response.json();
      if (!Array.isArray(locations)) throw new Error("Open Charge Map returned an unexpected response.");
      const stations = locations.filter((place) => Number.isSafeInteger(place?.ID)).map(normalizeStation);
      const value = { country, fetchedAt: Date.now(), limit: RESULT_LIMIT, stations };
      await cache?.replaceOne({ _id: country }, { _id: country, ...value }, { upsert: true });
      return { ...value, stale: false };
    } catch (error) {
      if (!previous) throw error;
      return { ...previous, stale: true };
    }
  }

  async function getStations(country) {
    if (inFlight.has(country)) return inFlight.get(country);
    const task = (async () => {
      const previous = await cache?.findOne({ _id: country }, { projection: { _id: 0 } });
      if (previous && Date.now() - previous.fetchedAt < REFRESH_MS) return { ...previous, stale: false };
      return fetchStations(country, previous);
    })();
    inFlight.set(country, task);
    try {
      return await task;
    } finally {
      inFlight.delete(country);
    }
  }

  app.get("/directory/stations", async (req, res) => {
    const country = req.query.country ?? "IN";
    if (typeof country !== "string" || !/^[a-z]{2}$/i.test(country)) {
      return res.status(400).json({ error: "Enter a two-letter country code such as IN." });
    }
    if (!apiKey) return res.status(503).json({ error: "Open Charge Map is not configured on the server." });
    try {
      res.json(await getStations(country.toUpperCase()));
    } catch {
      res.status(502).json({ error: "Could not load stations from Open Charge Map." });
    }
  });
}

module.exports = { registerOpenChargeMap };
