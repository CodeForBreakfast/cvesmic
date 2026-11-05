import QtQuick
import qs.Modules.Plugins

PluginSettings {
    pluginId: "cvesmic"

    StringSetting {
        settingKey: "feedUrl"
        label: "Feed address"
        description: "The JSON Feed that CVEsmic polls. The address starts with https:// or http://."
        placeholder: "https://pwn.watch/feed.json"
        defaultValue: "https://pwn.watch/feed.json"
    }
}
