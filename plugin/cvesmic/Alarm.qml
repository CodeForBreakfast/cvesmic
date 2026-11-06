import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "Feed.js" as Feed
import "Shake.js" as Shake

// Polls the feed and shakes every screen for a new item. The shell around it
// supplies the feed address, says when the frozen frame could show something
// private, and keeps the memory of seen items between runs.
Scope {
    id: root

    required property string requestedFeedUrl
    readonly property string feedUrl: Feed.usableFeedUrl(requestedFeedUrl || Feed.defaultFeedUrl)

    required property bool unsafeToShow

    // What the last poll remembered, or null before the first poll.
    required property var memory
    signal remembered(var memory)

    readonly property int captureGraceMs: 1000

    property string etag: ""
    property int delayMs: Feed.pollIntervalMs
    property var request: null
    property string lastResult: "no poll yet"

    property var strength: null
    readonly property bool shaking: strength !== null

    property var pendingNotices: []

    // Runs the command after the page address, and opens the page if the
    // command prints "default", which dms notify does when the notification is
    // clicked. The feed's text travels as arguments, never as script.
    readonly property string openPageOnClick: 'page=$1; shift; [ "$("$@")" = default ] && exec xdg-open "$page"'

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
        const outcome = Feed.assess(memory, url, items);
        memory = outcome.memory;
        remembered(outcome.memory);
        etag = Feed.usableEtag(xhr.getResponseHeader("ETag"));
        finishPoll(true, "read " + items.length + " items, " + (outcome.shake ? "a new " + outcome.shake + " item" : "none new"));
        pendingNotices = pendingNotices.concat(outcome.notices);
        if (outcome.shake)
            shake(outcome.shake);
        if (!shaking)
            announce();
    }

    function announce() {
        const notices = pendingNotices;
        pendingNotices = [];
        for (const notice of notices) {
            const notify = ["dms", "notify", "-a", "CVEsmic"];
            const text = ["--", notice.title, "Severity: " + notice.severity];
            if (notice.url)
                Quickshell.execDetached(["sh", "-c", openPageOnClick, "sh", notice.url].concat(notify, ["-A", "default=Open"], text));
            else
                Quickshell.execDetached(notify.concat(text));
        }
    }

    function finishPoll(succeeded, result) {
        report(result);
        delayMs = Feed.nextDelayMs(delayMs, succeeded);
        pollTimer.restart();
    }

    function shake(severity) {
        if (shaking) {
            report("skipped a " + severity + " shake: already shaking");
            return;
        }
        if (unsafeToShow) {
            report("skipped a " + severity + " shake: a cast is listed or the session is locked");
            return;
        }
        strength = Feed.strengthFor(severity);
        shakeEnd.interval = strength.durationMs + captureGraceMs;
        shakeEnd.restart();
        report("shaking for " + strength.durationMs + " ms at " + strength.offsetPx + " px");
    }

    function stopShake() {
        shakeEnd.stop();
        strength = null;
        announce();
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

                onCaptureSourceChanged: {
                    finished = false;
                    quake.stop();
                    place(Shake.rest);
                }
                function place(pose) {
                    x = pose.x;
                    y = pose.y;
                    rotation = pose.rotation;
                    scale = pose.scale;
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
                        frame.place(strength ? Shake.poseAt(strength, t, elapsedTime, frame) : Shake.rest);
                        if (t >= 1) {
                            stop();
                            frame.finished = true;
                        }
                    }
                }
            }
        }
    }
}
