import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Modules.Plugins

PluginComponent {
    id: root

    readonly property int shakeMs: 3000
    readonly property real peakOffsetPx: 50
    readonly property real peakRotationDeg: 0.6
    readonly property real overscan: 1.05

    property bool busy: false
    property bool showFrame: false
    property string lastResult: "none yet"

    function start(show) {
        if (busy)
            return "busy";
        busy = true;
        showFrame = show;
        gate.running = true;
        return "started";
    }

    function finish(result) {
        lastResult = result;
        console.info("cvesmicShakeProbe:", result);
        overlay.active = false;
        busy = false;
    }

    IpcHandler {
        target: "cvesmicShakeProbe"

        function shake(): string {
            return root.start(true);
        }
        function time(): string {
            return root.start(false);
        }
        function last(): string {
            return root.lastResult;
        }
    }

    // A frozen frame could show a secret, so never capture while the screen is cast or locked.
    Process {
        id: gate
        command: ["sh", "-c", "[ \"$(niri msg --json casts)\" = '[]' ] && [ \"$(dms ipc call lock isLocked)\" = false ]"]
        onExited: exitCode => {
            if (exitCode === 0)
                overlay.active = true;
            else
                root.finish("refused: a cast is running or the session is locked");
        }
    }

    Loader {
        id: overlay
        active: false

        sourceComponent: PanelWindow {
            screen: Quickshell.screens[0]
            color: "transparent"
            anchors { top: true; bottom: true; left: true; right: true }
            exclusionMode: ExclusionMode.Ignore
            WlrLayershell.layer: WlrLayer.Overlay
            WlrLayershell.namespace: "cvesmic-shake"
            WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
            mask: Region {}

            Rectangle {
                anchors.fill: parent
                color: "black"
                visible: frame.hasContent && root.showFrame
            }

            ScreencopyView {
                id: frame

                property double requestedAt: 0
                property real envelope: 0

                width: parent.width
                height: parent.height
                captureSource: Quickshell.screens[0]
                live: false
                opacity: hasContent && root.showFrame ? 1 : 0
                scale: root.overscan

                Component.onCompleted: requestedAt = Date.now()
                onHasContentChanged: {
                    if (!hasContent)
                        return;
                    const ms = Date.now() - requestedAt;
                    const result = "captured " + sourceSize.width + "x" + sourceSize.height + " in " + ms + " ms";
                    if (root.showFrame) {
                        root.lastResult = result;
                        quake.start();
                    } else {
                        root.finish(result);
                    }
                }

                FrameAnimation {
                    id: quake
                    onTriggered: {
                        const t = elapsedTime * 1000 / root.shakeMs;
                        if (t >= 1) {
                            stop();
                            root.finish(root.lastResult + ", shook for " + root.shakeMs + " ms");
                            return;
                        }
                        // Sharp onset, then a long decay, like a quake's main shock.
                        const env = Math.min(t / 0.1, 1) * Math.pow(1 - t, 2);
                        const s = elapsedTime;
                        const sway = (f, p) => Math.sin(2 * Math.PI * f * s + p);
                        const jolt = () => Math.random() * 2 - 1;
                        frame.x = root.peakOffsetPx * env * (0.6 * sway(2.3, 0) + 0.25 * sway(7.1, 1.3) + 0.15 * jolt());
                        frame.y = root.peakOffsetPx * env * (0.6 * sway(1.7, 2.1) + 0.25 * sway(8.3, 0.4) + 0.15 * jolt());
                        frame.rotation = root.peakRotationDeg * env * sway(1.1, 0.7);
                    }
                }
            }
        }
    }
}
