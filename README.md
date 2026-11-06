# CVEsmic

![A desktop shaking four times, gently for a low-severity vulnerability and hardest for a critical one](docs/shake.gif)

**Your screen shakes when the internet catches fire.**

CVEsmic watches the [pwn.watch](https://pwn.watch/) feed. When a new vulnerability lands, your whole desktop gives a little jolt. A low-severity item gets a nudge, and a critical one gets a three-second quake. You feel it before you read about it.

When the shaking stops, the news follows, the way people post after an earthquake. A notification names each new item and its severity, and a click on it opens the item on pwn.watch.

It is an alarm bell, not an encyclopaedia. It follows one feed, pwn.watch's "Patch now" feed by default, which holds the 50 most recently updated incidents. It won't tell you whether an item affects you. For that, read the item on pwn.watch, or point a proper vulnerability scanner at the software you run.

## What you need

- On GNOME, GNOME Shell 48, 49 or 50 under Wayland. CVEsmic is a shell extension there and needs nothing else.
- Anywhere else, [Quickshell](https://quickshell.org/), on a Wayland compositor that lets it capture the screen, such as niri, Hyprland or Sway, or on KDE Plasma, where CVEsmic's own KWin effect does the shaking. CVEsmic runs as a plugin of [Dux Modular Shell](https://github.com/duxlabs-dev/dux-shell) (`dms`), or on Quickshell alone.
- On Quickshell alone, `notify-send` from libnotify and a notification daemon, for the notifications. Dux Modular Shell brings its own.
- Under Quickshell, `xdg-open`, to open an item's page from its notification.

## Installing

On GNOME, pack the extension together with the code it shares with the Quickshell build, and install the pack. Then log out and back in, because GNOME Shell reads new extensions at login, and switch it on:

```sh
gnome-extensions pack gnome/cvesmic@codeforbreakfast.co --extra-source=../../plugin/cvesmic/Feed.mjs --extra-source=../../plugin/cvesmic/Shake.mjs
gnome-extensions install cvesmic@codeforbreakfast.co.shell-extension.zip
gnome-extensions enable cvesmic@codeforbreakfast.co
```

With Dux Modular Shell, copy `plugin/cvesmic` into the shell's plugins folder, then switch it on:

```sh
cp -r plugin/cvesmic ~/.config/dms/plugins/cvesmic
dms ipc call plugins enable cvesmic
```

On Quickshell alone, copy the same folder into Quickshell's config folder and start it:

```sh
cp -r plugin/cvesmic ~/.config/quickshell/cvesmic
qs -c cvesmic
```

To start it with your session, have your compositor run `qs -c cvesmic` at startup.

On KDE Plasma, copy the folder the same way, install the KWin effect as well, and let Plasma start `qs` with your session:

```sh
kpackagetool6 --type KWin/Effect --install plugin/cvesmic/kwin
cat > ~/.config/autostart/cvesmic.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=CVEsmic
Exec=qs -c cvesmic
EOF
```

The effect appears as CVEsmic under System Settings, Desktop Effects. CVEsmic loads it when it needs it, so it does not have to be switched on there.

Then wait for the next bad day on the internet. It is rarely a long wait.

## How it behaves

- **It checks every five minutes.** It sends the feed's entity tag back, so an unchanged feed costs one short answer. After a failure it waits twice as long before the next try, up to an hour.
- **It doesn't panic on day one.** The first poll of a feed records the items already in it and shakes nothing. After that, any item whose id it has not seen makes the screen shake. Several new items in one poll give one shake, at the strongest severity among them.
- **Severity sets the strength.** It reads the item's tags. An item tagged `critical` shakes hardest, then `high`, `medium` and `low`. An item without one of those tags shakes as `low`.
- **The news follows the shake.** When a shake ends, each new item gets its own notification, with its title and severity. A click on the notification opens the item's page. One poll notifies about five items at most, so a flood of new items stays readable. An item whose shake was skipped, because the screen was locked or a cast was listed, still gets its notification.
- **Your work carries on.** On GNOME, the shake moves the desktop itself, and your apps keep running as it moves. Under Quickshell, the shake freezes a picture of the screen and shakes the picture. Your apps keep running underneath, and clicks pass through to them.
- **The picture doesn't linger.** Under Quickshell, it stays in memory and is dropped when the shake ends. GNOME takes no picture.
- **It never shakes a locked screen.** On GNOME, the shell switches extensions off while the screen is locked, so a lock also ends a shake in progress. Under Quickshell, the frozen picture could show something private. Under Dux Modular Shell, it skips a shake while the session is locked, and a lock that starts during a shake stops it. On Quickshell alone, the compositor shows only the lock screen while the session is locked, so the picture never appears over a lock.
- **It stays still while you share your screen on GNOME.** CVEsmic does not shake while a screen cast or a remote desktop session runs, and one that starts during a shake stops it. GNOME tells it only about casts that start after the extension is switched on, so a cast already running at that moment goes unseen.
- **It respects what you hide from screen casts under Quickshell.** During a cast, the frozen picture hides whatever the compositor hides from the cast, such as a password manager you have blocked from screen sharing. Most compositors hide the same windows from every screen capture, so the picture matches the cast.
- **KDE Plasma shakes the windows themselves.** KWin gives Quickshell no screen capture, so CVEsmic's KWin effect jolts every window along the same path instead. Nothing is frozen and no picture is kept, so a screen share sees only your windows moving, and a locked screen shows nothing to shake. The windows move but don't tilt.
- **niri is the exception.** A window rule with `block-out-from "screencast"` hides a window from casts but not from other screen captures, so the frozen picture would show it. On niri, CVEsmic does not shake while niri lists a screen cast, and a cast that starts during a shake stops it. On Quickshell alone, it also does not shake until it has read niri's list of casts.

## Settings

There is one setting, the feed address. Any JSON Feed whose items carry an `id` and severity tags will work. Changing the address counts as a first poll of the new feed.

On GNOME, the extension's settings hold the address. The schema lives with the extension, so tell `gsettings` where to find it:

```sh
GSETTINGS_SCHEMA_DIR=~/.local/share/gnome-shell/extensions/cvesmic@codeforbreakfast.co/schemas \
  gsettings set org.gnome.shell.extensions.cvesmic feed-url https://example.org/feed.json
```

Under Dux Modular Shell, the plugin's settings page holds the address. On Quickshell alone, set `CVESMIC_FEED_URL` in the environment that starts `qs`.

Two calls help when you want to check it works without waiting for a disaster. On GNOME they go over D-Bus:

```sh
gdbus call --session --dest org.gnome.Shell --object-path /co/codeforbreakfast/CVEsmic --method co.codeforbreakfast.CVEsmic.Poll     # poll the feed now
gdbus call --session --dest org.gnome.Shell --object-path /co/codeforbreakfast/CVEsmic --method co.codeforbreakfast.CVEsmic.Status   # what the last poll or shake did
```

Under Dux Modular Shell, the same calls go through `dms`:

```sh
dms ipc call cvesmic poll
dms ipc call cvesmic status
```

On Quickshell alone, through `qs`:

```sh
qs -c cvesmic ipc call cvesmic poll
qs -c cvesmic ipc call cvesmic status
```

## Developing

The feed logic lives in `plugin/cvesmic/Feed.mjs` and the shake's motion in `plugin/cvesmic/Shake.mjs`. Both the Quickshell build and the GNOME extension in `gnome/` import them. The tracking of niri's screen casts lives in `plugin/cvesmic/Casts.mjs`, and the KWin effect in `plugin/cvesmic/kwin`. Their tests run with Node:

```sh
node --test
```

The animation at the top is rendered, not recorded. A script shakes a staged desktop with the plugin's own shake code at each severity. Run it again after changing the shake or the strengths:

```sh
nix shell nixpkgs#nodejs nixpkgs#imagemagick nixpkgs#gifski -c node docs/render-shake.mjs
```

## Security

To report a vulnerability in CVEsmic privately, see [SECURITY.md](SECURITY.md).

## Licence

CVEsmic is released under the [MIT licence](LICENSE).
