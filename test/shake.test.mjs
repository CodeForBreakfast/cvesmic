import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const Shake = vm.createContext({});
vm.runInContext(readFileSync(new URL("../plugin/cvesmic/Shake.js", import.meta.url), "utf8"), Shake);
const critical = { offsetPx: 50, rotationDeg: 0.6, durationMs: 3000 };
const screen = { width: 7680, height: 2160 };

test("the frame starts and ends at its true position and size", () => {
    for (const t of [0, 1, 1.5]) {
        const pose = Shake.poseAt(critical, t, t * 3, screen);
        assert.deepEqual({ ...pose }, { x: 0, y: 0, rotation: 0, scale: 1 }, "t=" + t);
    }
});

test("the frame eases back to rest as the shake ends", () => {
    const late = Shake.poseAt(critical, 0.99, 2.97, screen);
    assert.ok(Math.abs(late.x) < 0.1 && Math.abs(late.y) < 0.1, JSON.stringify(late));
    assert.ok(late.scale - 1 < 0.0001, JSON.stringify(late));
});

test("the frame always covers the screen's edges while it moves", () => {
    for (let n = 1; n < 1000; n++) {
        const t = n / 1000;
        const pose = Shake.poseAt(critical, t, t * 3, screen);
        const theta = pose.rotation * Math.PI / 180;
        // Each screen corner, seen from the moved and turned frame, must lie
        // inside the scaled frame.
        for (const [cx, cy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const dx = cx * screen.width / 2 - pose.x;
            const dy = cy * screen.height / 2 - pose.y;
            const u = dx * Math.cos(theta) + dy * Math.sin(theta);
            const v = -dx * Math.sin(theta) + dy * Math.cos(theta);
            const slack = 1e-9;
            assert.ok(Math.abs(u) <= pose.scale * screen.width / 2 + slack, "t=" + t + " " + JSON.stringify(pose));
            assert.ok(Math.abs(v) <= pose.scale * screen.height / 2 + slack, "t=" + t + " " + JSON.stringify(pose));
        }
    }
});
