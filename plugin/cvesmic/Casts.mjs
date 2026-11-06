// Follows niri's event stream to learn which screen casts niri lists. streams
// holds the listed casts' stream ids, or null until niri has sent its list.

export function follow(streams, line) {
    var event;
    try {
        event = JSON.parse(line);
    } catch (e) {
        return streams;
    }
    if (!event || typeof event !== "object")
        return streams;
    if (event.CastsChanged && Array.isArray(event.CastsChanged.casts))
        return event.CastsChanged.casts.map(function (cast) {
            return cast.stream_id;
        });
    if (streams === null)
        return streams;
    if (event.CastStartedOrChanged && event.CastStartedOrChanged.cast) {
        var id = event.CastStartedOrChanged.cast.stream_id;
        return streams.indexOf(id) >= 0 ? streams : streams.concat([id]);
    }
    if (event.CastStopped)
        return streams.filter(function (id) {
            return id !== event.CastStopped.stream_id;
        });
    return streams;
}

// A cast list not yet known counts as listing a cast.
export function listed(streams) {
    return streams === null || streams.length > 0;
}
