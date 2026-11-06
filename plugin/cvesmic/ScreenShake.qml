import QtQuick
import Quickshell
import Quickshell.Wayland
import "Shake.js" as Shake

// Shakes a frozen picture of each screen while the alarm is shaking, on a
// compositor that lets Quickshell capture the screen.
Scope {
    id: root

    required property Alarm alarm

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
                captureSource: root.alarm.shaking ? overlay.modelData : null
                live: false
                visible: root.alarm.shaking && hasContent && !finished

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
                    if (hasContent && root.alarm.shaking) {
                        quake.reset();
                        quake.start();
                    }
                }

                FrameAnimation {
                    id: quake
                    onTriggered: {
                        const strength = root.alarm.strength;
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
