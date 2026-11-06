// A KWin effect that jolts every window by the same path, so the whole
// screen appears to shake. CVEsmic's watcher writes the strength to this
// effect's config and asks KWin to reconfigure it, which starts a shake.
//
// A scripted effect has no timers and cannot import a file, so the path is a
// list of keyframes scheduled up front, each a short animation with a delay.
// The envelope is the one in Shake.js: a sharp onset, then a long decay.

var frameMs = 50;

function envelope(t) {
    return Math.min(t / 0.1, 1) * Math.pow(1 - t, 2);
}

// The frame's offset at each keyframe, starting and ending at rest.
function keyframes(strength) {
    var count = Math.max(2, Math.round(strength.durationMs / frameMs));
    var frames = [];
    for (var k = 0; k <= count; k++) {
        var t = k / count;
        var reach = k === count ? 0 : strength.offsetPx * envelope(t);
        var angle = Math.random() * 2 * Math.PI;
        frames.push(reach > 0 ? { x: reach * Math.cos(angle), y: reach * Math.sin(angle) } : { x: 0, y: 0 });
    }
    return frames;
}

// "50 0.6 3000" is offsetPx, rotationDeg and durationMs. Rotation is unused:
// a window turning about its own centre does not look like the screen tilting.
function parseStrength(text) {
    var parts = String(text).trim().split(/\s+/).map(Number);
    if (parts.length !== 3 || !parts.every(isFinite) || parts[0] <= 0 || parts[2] <= 0)
        return null;
    return { offsetPx: parts[0], rotationDeg: parts[1], durationMs: parts[2] };
}

function shakes(w) {
    return w.visible && !w.deleted && !w.lockScreen;
}

function shake(strength) {
    var frames = keyframes(strength);
    var windows = effects.stackingOrder.filter(shakes);
    for (var i = 0; i < windows.length; i++) {
        for (var k = 0; k + 1 < frames.length; k++) {
            effect.animate({
                window: windows[i],
                duration: frameMs,
                delay: k * frameMs,
                keepAlive: false,
                animations: [{
                    type: Effect.Translation,
                    curve: QEasingCurve.InOutSine,
                    from: { value1: frames[k].x, value2: frames[k].y },
                    to: { value1: frames[k + 1].x, value2: frames[k + 1].y }
                }]
            });
        }
    }
    console.info("cvesmic: shaking " + windows.length + " windows for " + strength.durationMs + " ms at " + strength.offsetPx + " px");
}

if (typeof effect !== "undefined") {
    effect.configChanged.connect(function () {
        var strength = parseStrength(effect.readConfig("Shake", ""));
        if (strength)
            shake(strength);
    });
}
