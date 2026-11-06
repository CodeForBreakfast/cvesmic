// Where the frozen frame sits at each moment of a shake.

export const rest = {x: 0, y: 0, rotation: 0, scale: 1};

// t runs from 0 to 1 over the shake, and seconds is the time since it began.
// The frame is scaled just enough to cover the screen's edges, so it starts
// and ends at its true size and position.
export function poseAt(strength, t, seconds, size) {
    if (!(t > 0 && t < 1))
        return rest;
    // Sharp onset, then a long decay, like a quake's main shock.
    const env = Math.min(t / 0.1, 1) * Math.pow(1 - t, 2);
    const sway = (f, p) => Math.sin(2 * Math.PI * f * seconds + p);
    const jolt = () => Math.random() * 2 - 1;
    const x = strength.offsetPx * env * (0.6 * sway(2.3, 0) + 0.25 * sway(7.1, 1.3) + 0.15 * jolt());
    const y = strength.offsetPx * env * (0.6 * sway(1.7, 2.1) + 0.25 * sway(8.3, 0.4) + 0.15 * jolt());
    const rotation = strength.rotationDeg * env * sway(1.1, 0.7);
    return {x, y, rotation, scale: coveringScale(x, y, rotation, size)};
}

// The smallest scale at which the moved and turned frame still covers every
// corner of the screen.
export function coveringScale(x, y, rotation, size) {
    const theta = rotation * Math.PI / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    let scale = 1;
    for (const [cx, cy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const dx = cx * size.width / 2 - x;
        const dy = cy * size.height / 2 - y;
        scale = Math.max(scale, Math.abs(dx * cos + dy * sin) / (size.width / 2), Math.abs(-dx * sin + dy * cos) / (size.height / 2));
    }
    return scale;
}
