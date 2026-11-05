import { expect, it } from "vitest";
import { readerWording } from "@/lib/dailysnow/wording";

it.each([
  ["Earlier observations. [storm-recap]", "Earlier observations."],
  ["LCC forecast: [nws-snow-lcc]", "LCC forecast:"],
  ["BCC forecast [nws-snow-bcc].", "BCC forecast."],
  ["Snow levels [nws-snow-level] fall tonight.", "Snow levels fall tonight."],
  ["Guidance: [plume-snow-cln] [plume-slr-pkcu1]", "Guidance:"],
  ["Reports [resort-totals], then stakes [stake-alta].", "Reports, then stakes."],
  ["The discussion expects snow. [nws-snow-lcc]", "The NWS expects snow."],
  ["[storm-recap] The discussion expects snow.", "The NWS expects snow."],
  ["Snow [at higher elevations] continues.", "Snow [at higher elevations] continues."],
])("removes internal figure markers from %s", (input, expected) => {
  expect(readerWording(input)).toBe(expected);
});
