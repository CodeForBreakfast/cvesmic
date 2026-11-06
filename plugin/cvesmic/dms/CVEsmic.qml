import QtQuick
import qs.Services
import qs.Modules.Plugins
import ".."

PluginComponent {
    id: root

    Alarm {
        id: watcher
        requestedFeedUrl: root.pluginData.feedUrl || ""

        // A frozen frame can show a secret, so it is never shown over a lock.
        // Other compositors black out of a capture whatever they black out of
        // a cast. niri can hide a window from casts but not from captures, so
        // while niri lists a cast the frame is not shown. NiriService lists no
        // casts anywhere else.
        unsafeToShow: SessionService.locked || SessionService.lockedHint || IdleService.isShellLocked || IdleService.isSessionLockSecure || NiriService.hasCasts

        notifyCommand: ["dms", "notify"]

        memory: null
        Component.onCompleted: memory = root.pluginService.loadPluginState(root.pluginId, "memory", null)
        onRemembered: memory => root.pluginService.savePluginState(root.pluginId, "memory", memory)
    }

    ScreenShake {
        alarm: watcher
    }
}
