import assert from "node:assert/strict";
import { locatePassage } from "../src/lib/evidence-passage";

const source = "Contents\n5B Extra-territorial operation of Act ... 3\n\n5B Extra-territorial operation of Act\n(1) The Act applies outside Australia.\nSection 5B\n";
const quote = "The Act applies outside Australia.";
const at = source.indexOf(quote);
assert.deepEqual(locatePassage(source, { quote, quoteStart: at, quoteEnd: at + quote.length }), { start: at, end: at + quote.length, kind: "quote" });
assert.equal(locatePassage(source, { quote, quoteStart: 0, quoteEnd: quote.length })?.start, at, "stale offsets must relocate by text");
assert.equal(locatePassage(source, { quoteStart: 0, quoteEnd: 25 }), null, "unverified bare offsets must not highlight text");
assert.equal(locatePassage(source, { quote: "missing" }), null);
assert.equal(locatePassage("repeated repeated", { quote: "repeated" }), null, "ambiguous quotes do not choose arbitrary occurrences");
assert.equal(locatePassage("repeated repeated", { quote: "repeated", quoteStart: 9, quoteEnd: 17 })?.start, 9, "valid stored offsets disambiguate repeated quotes");
assert.equal(locatePassage(source, { sectionRef: "ss 5B(1A), 5B(2)–(3)" })?.start, source.indexOf("5B Extra", source.indexOf("5B Extra") + 1));
assert.equal(locatePassage("5B First body heading\n5B Another body heading", { sectionRef: "s 5B" }), null);
assert.equal(locatePassage("6C Organisations\nText", { sectionRef: "s 6" }), null, "section prefixes must not collide");
assert.equal(locatePassage("## Schedule 2—Privacy\nText", { sectionRef: "Schedule 2, clause 7" })?.kind, "section");
assert.equal(locatePassage("unrelated", { quote: "bad", quoteStart: -2, quoteEnd: 99 }), null);
console.log("11 evidence passage checks passed");
