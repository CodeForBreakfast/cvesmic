// Renders docs/shake.gif: the staged desktop in docs/desktop.svg shaken at
// each severity in turn by the plugin's own shake code.
//
//   nix shell nixpkgs#nodejs nixpkgs#imagemagick nixpkgs#gifski -c node docs/render-shake.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Feed from "../plugin/cvesmic/Feed.mjs";
import * as Shake from "../plugin/cvesmic/Shake.mjs";

const screen = { width: 1920, height: 1080 };
const out = { width: 960, height: 540, captionHeight: 64 };
const fps = 25;
const pauseSeconds = 0.8;

const dir = mkdtempSync(join(tmpdir(), "cvesmic-shake-"));
const magick = (...args) => execFileSync("magick", args);

const desktop = join(dir, "desktop.png");
magick(new URL("desktop.svg", import.meta.url).pathname, "-resize", `${screen.width}x${screen.height}!`, desktop);

const captions = new Map();
const caption = (current) => {
    const file = join(dir, `caption-${current}.png`);
    if (captions.has(current))
        return file;
    captions.set(current, file);
    const draws = Feed.severities.flatMap((severity, i) => [
        "-fill", severity === current ? "#f4b37a" : "#55556a",
        "-annotate", `+${90 + i * 220}+42`, severity
    ]);
    magick("-size", `${out.width}x${out.captionHeight}`, "xc:#0d0d16",
        "-font", "DejaVu-Sans-Bold", "-pointsize", "26", ...draws, file);
    return file;
};

const frames = [];
const frame = (pose, severity) => {
    const file = join(dir, `frame-${String(frames.length).padStart(4, "0")}.png`);
    const cx = screen.width / 2;
    const cy = screen.height / 2;
    magick(desktop, "-virtual-pixel", "edge",
        "-distort", "SRT", `${cx},${cy} ${pose.scale} ${pose.rotation} ${cx + pose.x},${cy + pose.y}`,
        "-resize", `${out.width}x${out.height}`, caption(severity), "-append", file);
    frames.push(file);
};

for (const severity of Feed.severities) {
    const strength = Feed.strengths[severity];
    for (let n = 0; n < pauseSeconds * fps; n++)
        frame(Shake.rest, severity);
    const count = Math.round(strength.durationMs / 1000 * fps);
    for (let n = 1; n < count; n++) {
        const seconds = n / fps;
        frame(Shake.poseAt(strength, seconds * 1000 / strength.durationMs, seconds, screen), severity);
    }
}
for (let n = 0; n < pauseSeconds * fps; n++)
    frame(Shake.rest, "none");

execFileSync("gifski", ["--fps", String(fps), "--quality", "80", "--output",
    new URL("shake.gif", import.meta.url).pathname, ...frames]);
rmSync(dir, { recursive: true });
