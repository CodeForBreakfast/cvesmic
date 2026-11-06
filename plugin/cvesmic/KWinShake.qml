import QtQuick
import Quickshell
import Quickshell.Io

// Shakes the screen through the CVEsmic KWin effect, which jolts the live
// windows. The strength goes to the effect through its config in kwinrc, and
// a reconfigure tells the effect to read it and shake.
Scope {
    id: root

    required property Alarm alarm

    readonly property var strength: alarm.strength
    onStrengthChanged: {
        if (!strength)
            return;
        writeStrength.command = ["kwriteconfig6", "--file", "kwinrc", "--group", "Effect-cvesmic", "--key", "Shake",
            strength.offsetPx + " " + strength.rotationDeg + " " + strength.durationMs];
        writeStrength.running = true;
    }

    Process {
        id: writeStrength
        onExited: loadEffect.running = true
    }

    // Loading an effect that is already loaded does nothing. KWin acts on the
    // call only when dbus-send waits for the reply.
    Process {
        id: loadEffect
        command: ["dbus-send", "--session", "--print-reply", "--dest=org.kde.KWin", "/Effects", "org.kde.kwin.Effects.loadEffect", "string:cvesmic"]
        onExited: reconfigureEffect.running = true
    }

    Process {
        id: reconfigureEffect
        command: ["dbus-send", "--session", "--print-reply", "--dest=org.kde.KWin", "/Effects", "org.kde.kwin.Effects.reconfigureEffect", "string:cvesmic"]
        onExited: (code, status) => {
            if (code !== 0)
                root.alarm.report("the KWin effect did not answer; is it installed?");
        }
    }
}
