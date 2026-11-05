import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Services
import qs.Modules.Plugins
import "Feed.js" as Feed

PluginComponent {
    id: root

    readonly property string defaultFeedUrl: "https://pwn.watch/feed.json"
    readonly property string feedUrl: Feed.usableFeedUrl(pluginData.feedUrl || defaultFeedUrl)

    // A frozen frame can show a secret, so it is never shown to a cast or over a lock.
    readonly property bool locked: SessionService.locked || SessionService.lockedHint || IdleService.isShellLocked || IdleService.isSessionLockSecure
    readonly property bool unsafeToShow: locked || NiriService.hasCasts

    readonly property real overscan: 1.05
    readonly property int captureGraceMs: 1000

    property string etag: ""
    property int delayMs: Feed.pollIntervalMs
    property var request: null
    property string lastResult: "no poll yet"

    property var pendingStrength: null
    property var strength: null
    readonly property bool shaking: strength !== null

    function report(result) {
        lastResult = result;
        console.info("cvesmic:", result);
    }

    function poll() {
        pollTimer.stop();
        const url = feedUrl;
        if (!url) {
            finishPoll(false, "no usable feed address");
            return;
        }
        const xhr = new XMLHttpRequest();
        const previous = request;
        request = xhr;
        if (previous)
            previous.abort();
        xhr.onreadystatechange = () => {
            if (request !== xhr)
                return;
            const tooLarge = xhr.responseText.length > Feed.maxFeedChars;
            if (xhr.readyState !== XMLHttpRequest.DONE && !tooLarge)
                return;
            request = null;
            requestTimeout.stop();
            if (tooLarge) {
                xhr.abort();
                finishPoll(false, "the feed is larger than " + Feed.maxFeedChars + " characters");
                return;
            }
            readResponse(url, xhr);
        };
        xhr.open("GET", url);
        if (etag)
            xhr.setRequestHeader("If-None-Match", etag);
        xhr.send();
        requestTimeout.restart();
    }

    function readResponse(url, xhr) {
        if (xhr.status === 304) {
            finishPoll(true, "the feed is unchanged");
            return;
        }
        if (xhr.status !== 200) {
            finishPoll(false, "the feed answered HTTP " + xhr.status);
            return;
        }
        let items;
        try {
            items = Feed.parseFeed(xhr.responseText);
        } catch (e) {
            finishPoll(false, "the feed is unreadable: " + e.message);
            return;
        }
        const outcome = Feed.assess(pluginService.loadPluginState(pluginId, "memory", null), url, items);
        pluginService.savePluginState(pluginId, "memory", outcome.memory);
        etag = Feed.usableEtag(xhr.getResponseHeader("ETag"));
        finishPoll(true, "read " + items.length + " items, " + (outcome.shake ? "a new " + outcome.shake + " item" : "none new"));
        if (outcome.shake)
            shake(outcome.shake);
    }

    function finishPoll(succeeded, result) {
        report(result);
        delayMs = Feed.nextDelayMs(delayMs, succeeded);
        pollTimer.restart();
    }

    function shake(severity) {
        if (shaking || castCheck.running) {
            report("skipped a " + severity + " shake: already shaking");
            return;
        }
        if (unsafeToShow) {
            report("skipped a " + severity + " shake: a cast is listed or the session is locked");
            return;
        }
        pendingStrength = Feed.strengthFor(severity);
        castCheck.running = true;
    }

    function stopShake() {
        shakeEnd.stop();
        strength = null;
    }

    onFeedUrlChanged: {
        etag = "";
        Qt.callLater(poll);
    }

    onUnsafeToShowChanged: {
        if (unsafeToShow && shaking) {
            stopShake();
            report("stopped a shake: a cast started or the session locked");
        }
    }

    Component.onCompleted: Qt.callLater(poll)

    Timer {
        id: pollTimer
        interval: root.delayMs
        onTriggered: root.poll()
    }

    Timer {
        id: requestTimeout
        interval: Feed.requestTimeoutMs
        onTriggered: {
            const xhr = root.request;
            if (!xhr)
                return;
            root.request = null;
            xhr.abort();
            root.finishPoll(false, "the feed did not answer within " + Feed.requestTimeoutMs + " ms");
        }
    }

    Timer {
        id: shakeEnd
        onTriggered: root.stopShake()
    }

    // niri's own list is checked just before each capture, and anything but an
    // empty list refuses the shake.
    Process {
        id: castCheck
        command: ["sh", "-c", "[ \"$(niri msg --json casts)\" = '[]' ]"]
        onExited: exitCode => {
            if (exitCode !== 0 || root.unsafeToShow) {
                root.report("skipped a shake: a cast is listed or the session is locked");
                return;
            }
            root.strength = root.pendingStrength;
            shakeEnd.interval = root.strength.durationMs + root.captureGraceMs;
            shakeEnd.restart();
            root.report("shaking for " + root.strength.durationMs + " ms at " + root.strength.offsetPx + " px");
        }
    }

    IpcHandler {
        target: "cvesmic"

        function poll(): string {
            root.poll();
            return "polling";
        }
        function status(): string {
            return root.lastResult;
        }
    }

    // One overlay per screen lives as long as the plugin. Creating and
    // destroying a fullscreen layer surface per shake crashed Quickshell in
    // QWaylandSurface::surface_enter, so only the capture inside it changes.
    Variants {
        model: Quickshell.screens

        PanelWindow {
            id: overlay

            required property var modelData

            screen: modelData
            color: "transparent"
            anchors {
                top: true
                bottom: true
                left: true
                right: true
            }
            exclusionMode: ExclusionMode.Ignore
            WlrLayershell.layer: WlrLayer.Overlay
            WlrLayershell.namespace: "cvesmic-shake"
            WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
            mask: Region {}

            Rectangle {
                anchors.fill: parent
                color: "black"
                visible: frame.visible
            }

            ScreencopyView {
                id: frame

                property bool finished: false

                width: parent.width
                height: parent.height
                // The frame lives only while shaking. A null source drops it.
                captureSource: root.shaking ? overlay.modelData : null
                live: false
                visible: root.shaking && hasContent && !finished
                scale: root.overscan

                onCaptureSourceChanged: {
                    finished = false;
                    quake.stop();
                    x = 0;
                    y = 0;
                    rotation = 0;
                }
                onHasContentChanged: {
                    if (hasContent && root.shaking) {
                        quake.reset();
                        quake.start();
                    }
                }

                FrameAnimation {
                    id: quake
                    onTriggered: {
                        const strength = root.strength;
                        const t = strength ? elapsedTime * 1000 / strength.durationMs : 1;
                        if (t >= 1) {
                            stop();
                            frame.finished = true;
                            return;
                        }
                        // Sharp onset, then a long decay, like a quake's main shock.
                        const env = Math.min(t / 0.1, 1) * Math.pow(1 - t, 2);
                        const s = elapsedTime;
                        const sway = (f, p) => Math.sin(2 * Math.PI * f * s + p);
                        const jolt = () => Math.random() * 2 - 1;
                        frame.x = strength.offsetPx * env * (0.6 * sway(2.3, 0) + 0.25 * sway(7.1, 1.3) + 0.15 * jolt());
                        frame.y = strength.offsetPx * env * (0.6 * sway(1.7, 2.1) + 0.25 * sway(8.3, 0.4) + 0.15 * jolt());
                        frame.rotation = strength.rotationDeg * env * sway(1.1, 0.7);
                    }
                }
            }
        }
    }
}
