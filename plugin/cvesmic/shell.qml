// CVEsmic on Quickshell alone, without a shell around it.

import QtQuick
import Quickshell
import Quickshell.Io
import "Casts.mjs" as Casts

ShellRoot {
    id: root

    // KWin offers Quickshell no way to capture the screen, so on Plasma the
    // CVEsmic KWin effect jolts the live windows instead of a frozen frame.
    readonly property bool onKWin: (Quickshell.env("XDG_CURRENT_DESKTOP") || "").split(":").indexOf("KDE") >= 0

    // The compositor shows only the lock surfaces while the session is
    // locked, so the frozen frame never appears over a lock. Other
    // compositors black out of a capture whatever they black out of a cast.
    // niri can hide a window from casts but not from captures, so while niri
    // lists a cast the frame is not shown.
    readonly property bool onNiri: Quickshell.env("NIRI_SOCKET") !== null
    property var niriCasts: null

    Alarm {
        id: watcher
        requestedFeedUrl: Quickshell.env("CVESMIC_FEED_URL") || ""
        unsafeToShow: root.onNiri && Casts.listed(root.niriCasts)
        notifyCommand: ["notify-send"]
        memory: {
            try {
                return JSON.parse(memoryFile.text());
            } catch (e) {
                return null;
            }
        }
        onRemembered: memory => memoryFile.setText(JSON.stringify(memory))
    }

    Loader {
        active: !root.onKWin
        sourceComponent: ScreenShake {
            alarm: watcher
        }
    }

    Loader {
        active: root.onKWin
        sourceComponent: KWinShake {
            alarm: watcher
        }
    }

    FileView {
        id: memoryFile
        path: Quickshell.statePath("memory.json")
        blockLoading: true
        printErrors: false
    }

    Process {
        command: ["niri", "msg", "--json", "event-stream"]
        running: root.onNiri
        stdout: SplitParser {
            onRead: line => root.niriCasts = Casts.follow(root.niriCasts, line)
        }
        // Without the stream, niri's casts are unknown, so nothing shakes.
        onRunningChanged: {
            if (!running)
                root.niriCasts = null;
        }
    }
}
