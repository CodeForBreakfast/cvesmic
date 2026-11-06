// Reads the feed and decides when to shake. Everything the feed sends is
// untrusted, so each value is checked before it is used.

var defaultFeedUrl = "https://pwn.watch/feed.json";
var pollIntervalMs =5 * 60 * 1000;
var maxBackoffMs = 60 * 60 * 1000;
var requestTimeoutMs = 30 * 1000;
var maxFeedChars = 4 * 1024 * 1024;
var maxItems = 500;
var maxIdChars = 2048;
var maxSeenIds = 1000;
var maxEtagChars = 256;
var maxTitleChars = 200;
var maxNotices = 5;

var severities = ["low", "medium", "high", "critical"];

var strengths = {
    low: { offsetPx: 6, rotationDeg: 0, durationMs: 1000 },
    medium: { offsetPx: 15, rotationDeg: 0.15, durationMs: 1500 },
    high: { offsetPx: 30, rotationDeg: 0.35, durationMs: 2200 },
    critical: { offsetPx: 50, rotationDeg: 0.6, durationMs: 3000 }
};

function rank(severity) {
    return Math.max(0, severities.indexOf(severity));
}

function severityOf(tags) {
    if (!Array.isArray(tags))
        return "low";
    var best = "low";
    for (var i = 0; i < tags.length; i++) {
        if (severities.indexOf(tags[i]) > rank(best))
            best = tags[i];
    }
    return best;
}

// The shell renders a notification's text as rich text whenever it holds a
// tag, and rich text can load remote images, so a title loses its angle
// brackets.
function plainTitle(value) {
    if (typeof value !== "string")
        return "";
    return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, maxTitleChars);
}

// Returns [{ id, title, url, severity }] for each usable item, and throws on
// text that is not a JSON Feed. url is the item's web page, or "" if it has
// none.
function parseFeed(text) {
    var feed = JSON.parse(text);
    if (!feed || typeof feed !== "object" || !Array.isArray(feed.items))
        throw new Error("not a JSON Feed: no items array");
    var items = [];
    for (var i = 0; i < feed.items.length && items.length < maxItems; i++) {
        var entry = feed.items[i];
        if (!entry || typeof entry.id !== "string" || entry.id.length === 0 || entry.id.length > maxIdChars)
            continue;
        items.push({
            id: entry.id,
            title: plainTitle(entry.title) || plainTitle(entry.id),
            url: usableWebUrl(entry.url) || usableWebUrl(entry.id),
            severity: severityOf(entry.tags)
        });
    }
    return items;
}

// memory is what the last poll returned, or null before the first poll. The
// first poll of a feed address records its items and shakes nothing. notices
// holds the unseen items, in feed order, for one notification each.
function assess(memory, feedUrl, items) {
    var known = memory && memory.feedUrl === feedUrl && Array.isArray(memory.seenIds);
    var seenIds = known ? memory.seenIds.slice() : [];
    var seen = {};
    for (var i = 0; i < seenIds.length; i++)
        seen[seenIds[i]] = true;

    var shake = null;
    var notices = [];
    for (var j = 0; j < items.length; j++) {
        if (seen[items[j].id])
            continue;
        seen[items[j].id] = true;
        seenIds.push(items[j].id);
        if (!known)
            continue;
        if (shake === null || rank(items[j].severity) > rank(shake))
            shake = items[j].severity;
        if (notices.length < maxNotices)
            notices.push(items[j]);
    }

    return {
        shake: shake,
        notices: notices,
        memory: { feedUrl: feedUrl, seenIds: seenIds.slice(-maxSeenIds) }
    };
}

function strengthFor(severity) {
    return strengths[severities[rank(severity)]];
}

// An entity tag goes back to the server in a request header, so anything that
// could break the header is refused.
function usableEtag(value) {
    if (typeof value !== "string" || value.length > maxEtagChars)
        return "";
    return /^(W\/)?"[\x21\x23-\x7e]*"$/.test(value) ? value : "";
}

function usableWebUrl(value) {
    if (typeof value !== "string")
        return "";
    var url = value.trim();
    return url.length <= maxIdChars && /^https?:\/\/[^\s]+$/i.test(url) ? url : "";
}

function nextDelayMs(currentMs, succeeded) {
    if (succeeded)
        return pollIntervalMs;
    return Math.min(Math.max(currentMs, pollIntervalMs) * 2, maxBackoffMs);
}
