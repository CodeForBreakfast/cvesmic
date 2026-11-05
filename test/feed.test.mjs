import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Feed.js is a QML JavaScript resource, so it has no exports. Its top-level
// functions land on the context it runs in.
const Feed = vm.createContext({});
vm.runInContext(readFileSync(new URL("../plugin/cvesmic/Feed.js", import.meta.url), "utf8"), Feed);

// Values made inside the context have its own prototypes, so compare copies.
const plain = value => JSON.parse(JSON.stringify(value));

const feedOf = (...items) => JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items });
const item = (id, ...tags) => ({ id, title: id, tags });

test("parseFeed reads each item's id and strongest severity tag", () => {
    const items = Feed.parseFeed(feedOf(item("a", "patch", "high"), item("b", "medium", "critical")));
    assert.deepEqual(plain(items), [
        { id: "a", severity: "high" },
        { id: "b", severity: "critical" },
    ]);
});

test("parseFeed counts an item with no known severity tag as low", () => {
    const items = Feed.parseFeed(feedOf(item("a", "patch"), { id: "b" }, { id: "c", tags: "critical" }));
    assert.deepEqual(plain(items.map(i => i.severity)), ["low", "low", "low"]);
});

test("parseFeed rejects text that is not a feed", () => {
    for (const text of ["", "not json", "null", "[]", '{"items": {}}', '"x"'])
        assert.throws(() => Feed.parseFeed(text), undefined, text);
});

test("parseFeed skips items without a usable id", () => {
    const items = Feed.parseFeed(feedOf(null, "x", { id: 7 }, { id: "" }, { id: "x".repeat(2049) }, item("ok")));
    assert.deepEqual(plain(items.map(i => i.id)), ["ok"]);
});

test("parseFeed reads at most maxItems items", () => {
    const many = Array.from({ length: Feed.maxItems + 10 }, (_, n) => item("i" + n));
    assert.equal(Feed.parseFeed(feedOf(...many)).length, Feed.maxItems);
});

test("the first poll of a feed records its items and shakes nothing", () => {
    const outcome = Feed.assess(null, "https://feed", [{ id: "a", severity: "critical" }]);
    assert.equal(outcome.shake, null);
    assert.deepEqual(plain(outcome.memory.seenIds), ["a"]);
    assert.equal(outcome.memory.feedUrl, "https://feed");
});

test("an unseen id shakes at the strongest severity among the unseen items", () => {
    const memory = { feedUrl: "https://feed", seenIds: ["a"] };
    const outcome = Feed.assess(memory, "https://feed", [
        { id: "a", severity: "critical" },
        { id: "b", severity: "medium" },
        { id: "c", severity: "high" },
    ]);
    assert.equal(outcome.shake, "high");
    assert.deepEqual(plain(outcome.memory.seenIds), ["a", "b", "c"]);
});

test("a feed with no unseen ids shakes nothing", () => {
    const memory = { feedUrl: "https://feed", seenIds: ["a", "b"] };
    assert.equal(Feed.assess(memory, "https://feed", [{ id: "b", severity: "critical" }]).shake, null);
});

test("a changed feed address counts as a first poll", () => {
    const memory = { feedUrl: "https://old", seenIds: ["a"] };
    const outcome = Feed.assess(memory, "https://new", [{ id: "b", severity: "critical" }]);
    assert.equal(outcome.shake, null);
    assert.deepEqual(plain(outcome.memory.seenIds), ["b"]);
});

test("unreadable memory counts as a first poll", () => {
    for (const memory of [{}, { feedUrl: "https://feed", seenIds: "a" }, "junk"])
        assert.equal(Feed.assess(memory, "https://feed", [{ id: "b", severity: "critical" }]).shake, null);
});

test("memory keeps only the most recent maxSeenIds ids", () => {
    const old = Array.from({ length: Feed.maxSeenIds }, (_, n) => "old" + n);
    const outcome = Feed.assess({ feedUrl: "u", seenIds: old }, "u", [{ id: "new", severity: "low" }]);
    assert.equal(outcome.memory.seenIds.length, Feed.maxSeenIds);
    assert.equal(outcome.memory.seenIds[0], "old1");
    assert.equal(outcome.memory.seenIds.at(-1), "new");
});

test("stronger severities shake harder and longer", () => {
    const order = ["low", "medium", "high", "critical"].map(Feed.strengthFor);
    for (let n = 1; n < order.length; n++) {
        assert.ok(order[n].offsetPx > order[n - 1].offsetPx);
        assert.ok(order[n].durationMs > order[n - 1].durationMs);
    }
    assert.deepEqual(plain(Feed.strengthFor("critical")), { offsetPx: 50, rotationDeg: 0.6, durationMs: 3000 });
});

test("an unknown severity shakes as low", () => {
    assert.deepEqual(plain(Feed.strengthFor("bogus")), plain(Feed.strengthFor("low")));
});

test("usableEtag accepts only a well-formed entity tag", () => {
    assert.equal(Feed.usableEtag('"8958d1306c9d48b5"'), '"8958d1306c9d48b5"');
    assert.equal(Feed.usableEtag('W/"abc"'), 'W/"abc"');
    for (const bad of [null, "", "abc", '"a\r\nX-Evil: 1"', '"' + "a".repeat(300) + '"'])
        assert.equal(Feed.usableEtag(bad), "", String(bad));
});

test("usableFeedUrl accepts only http and https addresses", () => {
    assert.equal(Feed.usableFeedUrl(" https://pwn.watch/feed.json "), "https://pwn.watch/feed.json");
    assert.equal(Feed.usableFeedUrl("http://localhost:8000/feed.json"), "http://localhost:8000/feed.json");
    for (const bad of ["", "file:///etc/passwd", "javascript:1", "ftp://x", undefined])
        assert.equal(Feed.usableFeedUrl(bad), "", String(bad));
});

test("the poll delay doubles on each failure up to a ceiling and resets on success", () => {
    let delay = Feed.pollIntervalMs;
    delay = Feed.nextDelayMs(delay, false);
    assert.equal(delay, Feed.pollIntervalMs * 2);
    for (let n = 0; n < 20; n++)
        delay = Feed.nextDelayMs(delay, false);
    assert.equal(delay, Feed.maxBackoffMs);
    assert.equal(Feed.nextDelayMs(delay, true), Feed.pollIntervalMs);
});
