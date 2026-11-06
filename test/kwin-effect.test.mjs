import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// The effect runs inside KWin, which gives it the effect globals. Without them
// it only defines its functions.
const KWinEffect = vm.createContext({});
vm.runInContext(readFileSync(new URL("../plugin/cvesmic/kwin/contents/code/main.js", import.meta.url), "utf8"), KWinEffect);
const critical = { offsetPx: 50, rotationDeg: 0.6, durationMs: 3000 };

test("parseStrength reads the three numbers the watcher writes", () => {
    assert.deepEqual({ ...KWinEffect.parseStrength("50 0.6 3000") }, critical);
    assert.deepEqual({ ...KWinEffect.parseStrength(" 6 0 1000\n") }, { offsetPx: 6, rotationDeg: 0, durationMs: 1000 });
});

test("parseStrength refuses anything else", () => {
    for (const text of ["", "critical", "50 0.6", "50 0.6 3000 1", "0 0 1000", "50 0 0", "x 0 1000", undefined])
        assert.equal(KWinEffect.parseStrength(text), null, JSON.stringify(text));
});

test("the keyframes start and end at rest and fill the shake's duration", () => {
    const frames = KWinEffect.keyframes(critical);
    assert.equal((frames.length - 1) * KWinEffect.frameMs, critical.durationMs);
    assert.deepEqual({ ...frames[0] }, { x: 0, y: 0 });
    assert.deepEqual({ ...frames[frames.length - 1] }, { x: 0, y: 0 });
});

test("the keyframes never reach beyond the strength's offset, and most move", () => {
    const frames = KWinEffect.keyframes(critical);
    const reach = f => Math.hypot(f.x, f.y);
    assert.ok(frames.every(f => reach(f) <= critical.offsetPx + 1e-9));
    assert.ok(frames.filter(f => reach(f) > 1).length > frames.length / 2);
});

test("the shortest shake still has a frame to move through", () => {
    const frames = KWinEffect.keyframes({ offsetPx: 6, rotationDeg: 0, durationMs: 10 });
    assert.equal(frames.length, 3);
});
