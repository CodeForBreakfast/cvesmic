# CVEsmic

![A desktop shaking four times, gently for a low-severity vulnerability and hardest for a critical one](docs/shake.gif)

**Your screen shakes when the internet catches fire.**

CVEsmic watches the [pwn.watch](https://pwn.watch/) feed. When a new vulnerability lands, your whole desktop gives a little jolt. A low-severity item gets a nudge, and a critical one gets a three-second quake. You feel it before you read about it.

It is an alarm bell, not an encyclopaedia. It follows one feed, pwn.watch's "Patch now" feed by default, which holds the 50 most recently updated incidents. It won't tell you what the item was or whether it affects you. For that, read the item on pwn.watch, or point a proper vulnerability scanner at the software you run.

## What you need

- A Wayland desktop running [Dux Modular Shell](https://github.com/duxlabs-dev/dux-shell) (`dms`) on Quickshell, on a compositor that lets Quickshell capture the screen.

## Installing

Copy `plugin/cvesmic` into the shell's plugins folder, then switch it on:

```sh
cp -r plugin/cvesmic ~/.config/dms/plugins/cvesmic
dms ipc call plugins enable cvesmic
```

Then wait for the next bad day on the internet. It is rarely a long wait.

## How it behaves

- **It checks every five minutes.** It sends the feed's entity tag back, so an unchanged feed costs one short answer. After a failure it waits twice as long before the next try, up to an hour.
- **It doesn't panic on day one.** The first poll of a feed records the items already in it and shakes nothing. After that, any item whose id it has not seen makes the screen shake. Several new items in one poll give one shake, at the strongest severity among them.
- **Severity sets the strength.** It reads the item's tags. An item tagged `critical` shakes hardest, then `high`, `medium` and `low`. An item without one of those tags shakes as `low`.
- **Your work carries on.** The shake freezes a picture of the screen and shakes the picture. Your apps keep running underneath, and clicks pass through to them.
- **The picture doesn't linger.** It stays in memory and is dropped when the shake ends.
- **It never shakes a locked screen**, because the frozen picture could show something private. A lock that starts during a shake stops it.
- **It respects what you hide from screen casts.** During a cast, the frozen picture hides whatever the compositor hides from the cast, such as a password manager you have blocked from screen sharing. Most compositors hide the same windows from every screen capture, so the picture matches the cast.
- **niri is the exception.** A window rule with `block-out-from "screencast"` hides a window from casts but not from other screen captures, so the frozen picture would show it. On niri, CVEsmic does not shake while niri lists a screen cast, and a cast that starts during a shake stops it.

## Settings

The plugin's settings page has one setting, the feed address. Any JSON Feed whose items carry an `id` and severity tags will work. Changing the address counts as a first poll of the new feed.

Two IPC calls help when you want to check it works without waiting for a disaster:

```sh
dms ipc call cvesmic poll     # poll the feed now
dms ipc call cvesmic status   # what the last poll or shake did
```

## Developing

The feed logic lives in `plugin/cvesmic/Feed.js`, and its tests run with Node:

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
