import QtQuick
import Quickshell
import Quickshell.Io
import "Feed.mjs" as Feed

// Polls the feed, raises a shake for a new item, and then notifies once for
// each new item. The shell around it supplies the feed address, says when a
// shake could show something private, names the notifier, keeps the memory of
// seen items between runs, and shakes the screen while strength is set.
Scope {
    id: root

    required property string requestedFeedUrl
    readonly property string feedUrl: Feed.usableWebUrl(requestedFeedUrl || Feed.defaultFeedUrl)

    required property bool unsafeToShow

    // A command that takes notify-send's flags and, given an action, prints the
    // chosen action's name when the notification is clicked.
    required property var notifyCommand

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
    // command prints "default", the action a click on the notification chooses.
    // The feed's text travels as arguments, never as script.
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
        const answer = Feed.readAnswer(memory, url, xhr.status, xhr.responseText, xhr.getResponseHeader("ETag"));
        if (answer.memory) {
            memory = answer.memory;
            remembered(answer.memory);
            etag = answer.etag;
        }
        finishPoll(answer.succeeded, answer.result);
        if (!answer.memory)
            return;
        pendingNotices = pendingNotices.concat(answer.notices);
        if (answer.shake)
            shake(answer.shake);
        if (!shaking)
            announce();
    }

    function announce() {
        const notices = pendingNotices;
        pendingNotices = [];
        for (const notice of notices) {
            const notify = notifyCommand.concat(["-a", "CVEsmic"]);
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
}
