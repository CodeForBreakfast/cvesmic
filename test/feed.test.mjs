import { test } from "node:test";
import assert from "node:assert/strict";

import * as Feed from "../plugin/cvesmic/Feed.mjs";

const feedOf = (...items) => JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items });
const item = (id, ...tags) => ({ id, title: id, tags });

test("parseFeed reads each item's id, title, page and strongest severity tag", () => {
    const items = Feed.parseFeed(feedOf(
        { id: "a", title: "First", url: "https://pwn.watch/i/a", tags: ["patch", "high"] },
        { id: "https://pwn.watch/i/b", title: "Second", tags: ["medium", "critical"] },
    ));
    assert.deepEqual(items, [
        { id: "a", title: "First", url: "https://pwn.watch/i/a", severity: "high" },
        { id: "https://pwn.watch/i/b", title: "Second", url: "https://pwn.watch/i/b", severity: "critical" },
    ]);
});

test("parseFeed gives an item no page unless its url or id is a web address", () => {
    const items = Feed.parseFeed(feedOf(
        { id: "a", url: "javascript:alert(1)" },
        { id: "b", url: "https://x/" + "y".repeat(2048) },
        { id: "file:///etc/passwd" },
    ));
    assert.deepEqual(items.map(i => i.url), ["", "", ""]);
});

test("parseFeed keeps a title to one plain line that the notification cannot render as markup", () => {
    const items = Feed.parseFeed(feedOf(
        { id: "a", title: "  <img src=https://track/me> [high]\n  Bad\tbug  " },
        { id: "b", title: "x".repeat(500) },
    ));
    assert.equal(items[0].title, "img src=https://track/me [high] Bad bug");
    assert.equal(items[1].title.length, Feed.maxTitleChars);
});

test("parseFeed names an item by its id when it has no usable title", () => {
    const items = Feed.parseFeed(feedOf({ id: "a" }, { id: "b", title: 7 }, { id: "c", title: " <> " }));
    assert.deepEqual(items.map(i => i.title), ["a", "b", "c"]);
});

test("parseFeed counts an item with no known severity tag as low", () => {
    const items = Feed.parseFeed(feedOf(item("a", "patch"), { id: "b" }, { id: "c", tags: "critical" }));
    assert.deepEqual(items.map(i => i.severity), ["low", "low", "low"]);
});

test("parseFeed rejects text that is not a feed", () => {
    for (const text of ["", "not json", "null", "[]", '{"items": {}}', '"x"'])
        assert.throws(() => Feed.parseFeed(text), undefined, text);
});

test("parseFeed skips items without a usable id", () => {
    const items = Feed.parseFeed(feedOf(null, "x", { id: 7 }, { id: "" }, { id: "x".repeat(2049) }, item("ok")));
    assert.deepEqual(items.map(i => i.id), ["ok"]);
});

test("parseFeed reads at most maxItems items", () => {
    const many = Array.from({ length: Feed.maxItems + 10 }, (_, n) => item("i" + n));
    assert.equal(Feed.parseFeed(feedOf(...many)).length, Feed.maxItems);
});

test("the first poll of a feed records its items and shakes nothing", () => {
    const outcome = Feed.assess(null, "https://feed", [{ id: "a", severity: "critical" }]);
    assert.equal(outcome.shake, null);
    assert.deepEqual(outcome.memory.seenIds, ["a"]);
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
    assert.deepEqual(outcome.memory.seenIds, ["a", "b", "c"]);
});

test("each unseen item gets a notice, in feed order", () => {
    const memory = { feedUrl: "https://feed", seenIds: ["a"] };
    const b = { id: "b", title: "B", url: "", severity: "medium" };
    const c = { id: "c", title: "C", url: "", severity: "high" };
    const outcome = Feed.assess(memory, "https://feed", [{ id: "a", severity: "critical" }, b, c, b]);
    assert.deepEqual(outcome.notices, [b, c]);
});

test("the first poll of a feed gives no notices", () => {
    assert.deepEqual(Feed.assess(null, "https://feed", [{ id: "a", severity: "low" }]).notices, []);
});

test("one poll gives at most maxNotices notices, so a flood stays readable", () => {
    const many = Array.from({ length: Feed.maxNotices + 3 }, (_, n) => ({ id: "n" + n, severity: "low" }));
    const outcome = Feed.assess({ feedUrl: "u", seenIds: [] }, "u", many);
    assert.equal(outcome.notices.length, Feed.maxNotices);
    assert.equal(outcome.notices[0].id, "n0");
    assert.equal(outcome.memory.seenIds.length, many.length);
});

test("a feed with no unseen ids shakes nothing", () => {
    const memory = { feedUrl: "https://feed", seenIds: ["a", "b"] };
    assert.equal(Feed.assess(memory, "https://feed", [{ id: "b", severity: "critical" }]).shake, null);
});

test("a changed feed address counts as a first poll", () => {
    const memory = { feedUrl: "https://old", seenIds: ["a"] };
    const outcome = Feed.assess(memory, "https://new", [{ id: "b", severity: "critical" }]);
    assert.equal(outcome.shake, null);
    assert.deepEqual(outcome.memory.seenIds, ["b"]);
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
    assert.deepEqual(Feed.strengthFor("critical"), { offsetPx: 50, rotationDeg: 0.6, durationMs: 3000 });
});

test("an unknown severity shakes as low", () => {
    assert.deepEqual(Feed.strengthFor("bogus"), Feed.strengthFor("low"));
});

test("usableEtag accepts only a well-formed entity tag", () => {
    assert.equal(Feed.usableEtag('"8958d1306c9d48b5"'), '"8958d1306c9d48b5"');
    assert.equal(Feed.usableEtag('W/"abc"'), 'W/"abc"');
    for (const bad of [null, "", "abc", '"a\r\nX-Evil: 1"', '"' + "a".repeat(300) + '"'])
        assert.equal(Feed.usableEtag(bad), "", String(bad));
});

test("usableWebUrl accepts only http and https addresses", () => {
    assert.equal(Feed.usableWebUrl(" https://pwn.watch/feed.json "), "https://pwn.watch/feed.json");
    assert.equal(Feed.usableWebUrl("http://localhost:8000/feed.json"), "http://localhost:8000/feed.json");
    for (const bad of ["", "file:///etc/passwd", "javascript:1", "ftp://x", undefined])
        assert.equal(Feed.usableWebUrl(bad), "", String(bad));
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

test("readAnswer treats an unchanged feed as a good poll that remembers nothing new", () => {
    const answer = Feed.readAnswer({ feedUrl: "https://feed", seenIds: ["a"] }, "https://feed", 304, "", null);
    assert.deepEqual(answer, { succeeded: true, result: "the feed is unchanged" });
});

test("readAnswer reports any other status, and unreadable text, as a failed poll", () => {
    assert.deepEqual(Feed.readAnswer(null, "https://feed", 503, "", null), { succeeded: false, result: "the feed answered HTTP 503" });
    const answer = Feed.readAnswer(null, "https://feed", 200, "{]", null);
    assert.equal(answer.succeeded, false);
    assert.match(answer.result, /^the feed is unreadable: /);
});

test("readAnswer reads a fresh feed into memory, keeps a usable entity tag and says what is new", () => {
    const memory = { feedUrl: "https://feed", seenIds: ["a"] };
    const answer = Feed.readAnswer(memory, "https://feed", 200, feedOf(item("a", "low"), item("b", "high"), item("c", "medium")), '"v2"');
    assert.equal(answer.succeeded, true);
    assert.equal(answer.result, "read 3 items, a new high item");
    assert.equal(answer.shake, "high");
    assert.deepEqual(answer.notices.map(n => n.id), ["b", "c"]);
    assert.deepEqual(answer.memory.seenIds, ["a", "b", "c"]);
    assert.equal(answer.etag, '"v2"');
    assert.equal(Feed.readAnswer(memory, "https://feed", 200, feedOf(item("a")), "bad tag").etag, "");
});

test("readAnswer says when nothing is new", () => {
    const answer = Feed.readAnswer({ feedUrl: "https://feed", seenIds: ["a"] }, "https://feed", 200, feedOf(item("a")), null);
    assert.equal(answer.result, "read 1 items, none new");
    assert.equal(answer.shake, null);
    assert.deepEqual(answer.notices, []);
});
