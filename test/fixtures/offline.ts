import assert from "node:assert/strict";
import { todayLocal } from "../../src/util/time.js";

// All responses are synthetic. Any unrecognized request fails without networking.
export const requests: URL[] = [];
export const date = todayLocal("Asia/Hong_Kong");
const [year, month, day] = date.split("-");
const monthName = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" })
  .format(new Date(`${year}-${month}-15T12:00:00Z`)).toLowerCase();

export function book(tokenId: string) {
  const yes = tokenId === "123";
  return {
    market: `0x${"0".repeat(64)}`, asset_id: tokenId,
    timestamp: "1782753357257", hash: "a".repeat(40),
    bids: [{ price: yes ? "0.08" : "0.88", size: "1000" }],
    asks: [{ price: yes ? "0.10" : "0.90", size: "1000" }],
    min_order_size: "5", tick_size: "0.01", neg_risk: false,
  };
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  assert.equal(request.method, "GET", "Only public GETs are allowed in tests");
  for (const key of request.headers.keys()) {
    assert.doesNotMatch(key, /authorization|poly_(address|signature|api_key|passphrase)|secret/i);
  }
  const url = new URL(request.url);
  requests.push(url);
  if (url.hostname === "gamma-api.polymarket.com" && url.pathname === "/public-search") {
    return Response.json({ events: [{
      id: "event", slug: `highest-temperature-in-hong-kong-on-${monthName}-${Number(day)}-${year}`,
      title: "Highest temperature in Hong Kong", endDate: new Date(Date.now() + 86_400_000).toISOString(),
      markets: [{
        id: "market", conditionId: `0x${"0".repeat(64)}`, question: "Will the highest temperature in Hong Kong be 25°C?",
        slug: "fixture-market", clobTokenIds: '["123","456"]', outcomePrices: '["0.1","0.9"]',
        active: true, closed: false, orderPriceMinTickSize: 0.01,
      }],
    }] });
  }
  if (url.hostname === "clob.polymarket.com" && url.pathname === "/book") {
    return Response.json(book(url.searchParams.get("token_id")!));
  }
  if (url.hostname === "ensemble-api.open-meteo.com") {
    return Response.json({ hourly: { time: [`${date}T12:00`], temperature_2m_member01: [25], temperature_2m_member02: [25] } });
  }
  if (url.hostname === "api.open-meteo.com") {
    return Response.json({ hourly: { time: [], temperature_2m: [] } });
  }
  throw new Error("Unexpected offline request");
};
