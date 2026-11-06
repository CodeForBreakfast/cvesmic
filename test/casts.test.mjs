import { test } from "node:test";
import assert from "node:assert/strict";

import * as Casts from "../plugin/cvesmic/Casts.mjs";

const follow = (...events) => events.reduce((streams, event) => Casts.follow(streams, JSON.stringify(event)), null);

test("the cast list is unknown, and counts as listed, until niri sends it", () => {
    assert.equal(follow(), null);
    assert.equal(Casts.listed(null), true);
    assert.equal(follow({ CastStartedOrChanged: { cast: { stream_id: 1 } } }), null);
});

test("an empty cast list from niri lists no cast", () => {
    const streams = follow({ CastsChanged: { casts: [] } });
    assert.deepEqual(streams, []);
    assert.equal(Casts.listed(streams), false);
});

test("niri's cast list replaces what was known", () => {
    const streams = follow({ CastsChanged: { casts: [{ stream_id: 1 }] } }, { CastsChanged: { casts: [{ stream_id: 2 }, { stream_id: 3 }] } });
    assert.deepEqual(streams, [2, 3]);
    assert.equal(Casts.listed(streams), true);
});

test("a cast that starts is listed once, however often it changes", () => {
    const streams = follow(
        { CastsChanged: { casts: [] } },
        { CastStartedOrChanged: { cast: { stream_id: 7 } } },
        { CastStartedOrChanged: { cast: { stream_id: 7 } } }
    );
    assert.deepEqual(streams, [7]);
});

test("a cast that stops is no longer listed", () => {
    const streams = follow(
        { CastsChanged: { casts: [{ stream_id: 1 }, { stream_id: 2 }] } },
        { CastStopped: { stream_id: 1 } },
        { CastStopped: { stream_id: 2 } }
    );
    assert.deepEqual(streams, []);
    assert.equal(Casts.listed(streams), false);
});

test("other events and unreadable lines change nothing", () => {
    const streams = follow({ CastsChanged: { casts: [{ stream_id: 1 }] } }, { WorkspaceActivated: { id: 3 } }, { CastsChanged: {} });
    assert.deepEqual(Casts.follow(streams, "not json"), [1]);
    assert.deepEqual(Casts.follow(streams, "null"), [1]);
    assert.deepEqual(streams, [1]);
});
