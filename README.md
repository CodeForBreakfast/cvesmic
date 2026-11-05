# CVEsmic

CVEsmic shakes your screen when a new item appears in the [pwn.watch](https://pwn.watch/) feed. A more severe item gives a harder and longer shake.

CVEsmic is an alert, not a vulnerability source. It follows a single feed, pwn.watch's "Patch now" feed by default, which holds the 50 most recently updated incidents. It does not show what the item was or tell you whether it affects you. For that, read the item on pwn.watch or use a proper vulnerability scanner for the software you run.

## What it needs

- A Wayland desktop running [Dux Shell](https://github.com/duxlabs-dev/dux-shell) on Quickshell, on a compositor that lets Quickshell capture the screen.

## Installing

Copy `plugin/cvesmic` into the shell's plugins folder, then enable it:

```sh
cp -r plugin/cvesmic ~/.config/dms/plugins/cvesmic
dms ipc call plugins enable cvesmic
```

## How it behaves

- It polls the feed every five minutes. It sends the feed's entity tag back, so an unchanged feed costs one short answer. After a failure it waits twice as long before the next try, up to an hour.
- The first poll of a feed records the items already in it and shakes nothing. After that, any item whose id it has not seen makes the screen shake. Several new items in one poll give one shake at the strongest severity among them.
- Severity comes from the item's tags. An item tagged `critical` shakes hardest, then `high`, `medium` and `low`. An item without one of those tags shakes as `low`.
- The shake freezes a picture of the screen and shakes the picture. Your apps keep running underneath, and clicks pass through to them.
- The picture stays in memory and is dropped when the shake ends.
- It never shakes while the session is locked, because the frozen picture could show something private. A lock that starts during a shake stops it.
- During a screen cast, the frozen picture hides whatever the compositor hides from the cast, such as a password manager you have blocked from screen sharing. Most compositors hide the same windows from every screen capture, so the picture is the same as the cast.
- niri is the exception. A window rule with `block-out-from "screencast"` hides a window from casts but not from other screen captures, so the frozen picture would show it. On niri, CVEsmic does not shake while niri lists a screen cast, and a cast that starts during a shake stops it.

## Settings

The plugin's settings page has one setting, the feed address. Any JSON Feed whose items carry an `id` and severity tags will work. Changing the address counts as a first poll of the new feed.

Two IPC calls help when you are checking it works:

```sh
dms ipc call cvesmic poll     # poll the feed now
dms ipc call cvesmic status   # what the last poll or shake did
```

## Developing

The feed logic lives in `plugin/cvesmic/Feed.js`, and its tests run with Node:

```sh
node --test
```
