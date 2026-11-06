// CVEsmic as a GNOME Shell extension. It polls the feed, shakes the whole
// desktop for a new item, and then notifies once for each new item. GNOME
// Shell disables it while the screen is locked, so it never shakes a lock.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Feed from './Feed.mjs';
import * as Shake from './Shake.mjs';

Gio._promisify(Soup.Session.prototype, 'send_async');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');

const readChunkBytes = 64 * 1024;

const ControlInterface = `
<node>
  <interface name="co.codeforbreakfast.CVEsmic">
    <method name="Poll"><arg type="s" direction="out"/></method>
    <method name="Status"><arg type="s" direction="out"/></method>
  </interface>
</node>`;

export default class CVEsmicExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._session = new Soup.Session({timeout: Feed.requestTimeoutMs / 1000});
        this._memoryPath = GLib.build_filenamev([GLib.get_user_state_dir(), 'cvesmic', 'memory.json']);
        this._memory = this._recall();
        this._etag = '';
        this._delayMs = Feed.pollIntervalMs;
        this._lastResult = 'no poll yet';
        this._pendingNotices ??= [];
        this._strength = null;

        // Mutter announces each screen cast and remote desktop session that
        // starts from now on, so one already running stays unknown.
        this._shares = new Map();
        this._shareController = global.backend.get_remote_access_controller();
        this._newShareId = this._shareController?.connect('new-handle', (_controller, share) => this._onNewShare(share));

        this._feedUrlChangedId = this._settings.connect('changed::feed-url', () => {
            this._etag = '';
            this.poll();
        });

        this._control = Gio.DBusExportedObject.wrapJSObject(ControlInterface, this);
        this._control.export(Gio.DBus.session, '/co/codeforbreakfast/CVEsmic');

        this._announce();
        this.poll();
    }

    disable() {
        this._control.unexport();
        this._control = null;
        this._settings.disconnect(this._feedUrlChangedId);
        this._settings = null;
        if (this._newShareId)
            this._shareController.disconnect(this._newShareId);
        this._shareController = null;
        for (const [share, stoppedId] of this._shares)
            share.disconnect(stoppedId);
        this._shares = null;
        this._stopPollTimer();
        this._request?.cancel();
        this._request = null;
        this._session.abort();
        this._session = null;
        if (this._strength)
            this._endShake();
        this._source?.destroy();
        this._source = null;
    }

    Poll() {
        this.poll();
        return 'polling';
    }

    Status() {
        return this._lastResult;
    }

    _report(result) {
        this._lastResult = result;
    }

    _feedUrl() {
        return Feed.usableWebUrl(this._settings.get_string('feed-url') || Feed.defaultFeedUrl);
    }

    async poll() {
        this._stopPollTimer();
        this._request?.cancel();
        const url = this._feedUrl();
        if (!url) {
            this._finishPoll(false, 'no usable feed address');
            return;
        }
        const request = this._request = new Gio.Cancellable();
        const message = Soup.Message.new('GET', url);
        if (this._etag)
            message.get_request_headers().append('If-None-Match', this._etag);
        let text;
        try {
            const body = await this._session.send_async(message, GLib.PRIORITY_DEFAULT, request);
            try {
                text = await this._readUpTo(body, Feed.maxFeedChars, request);
            } finally {
                // An open body keeps its connection out of the session's pool.
                body.close(null);
            }
        } catch (e) {
            if (request.is_cancelled())
                return;
            this._request = null;
            this._finishPoll(false, `the feed did not answer: ${e.message}`);
            return;
        }
        if (request.is_cancelled())
            return;
        this._request = null;
        if (text === null) {
            this._finishPoll(false, `the feed is larger than ${Feed.maxFeedChars} bytes`);
            return;
        }
        const answer = Feed.readAnswer(this._memory, url, message.get_status(), text, message.get_response_headers().get_one('ETag'));
        if (answer.memory) {
            this._memory = answer.memory;
            this._remember(answer.memory);
            this._etag = answer.etag;
        }
        this._finishPoll(answer.succeeded, answer.result);
        if (!answer.memory)
            return;
        this._pendingNotices.push(...answer.notices);
        if (answer.shake)
            this._shake(answer.shake);
        if (!this._strength)
            this._announce();
    }

    // The body as text, or null once it exceeds maxBytes.
    async _readUpTo(stream, maxBytes, cancellable) {
        const chunks = [];
        let size = 0;
        for (;;) {
            const bytes = await stream.read_bytes_async(readChunkBytes, GLib.PRIORITY_DEFAULT, cancellable);
            if (bytes.get_size() === 0)
                break;
            size += bytes.get_size();
            if (size > maxBytes)
                return null;
            chunks.push(bytes.toArray());
        }
        const all = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            all.set(chunk, offset);
            offset += chunk.length;
        }
        return new TextDecoder().decode(all);
    }

    _finishPoll(succeeded, result) {
        this._report(result);
        this._delayMs = Feed.nextDelayMs(this._delayMs, succeeded);
        this._stopPollTimer();
        this._pollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._delayMs, () => {
            this._pollTimer = 0;
            this.poll();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopPollTimer() {
        if (this._pollTimer)
            GLib.source_remove(this._pollTimer);
        this._pollTimer = 0;
    }

    _recall() {
        try {
            const [, bytes] = GLib.file_get_contents(this._memoryPath);
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            return null;
        }
    }

    _remember(memory) {
        GLib.mkdir_with_parents(GLib.path_get_dirname(this._memoryPath), 0o700);
        GLib.file_set_contents(this._memoryPath, JSON.stringify(memory));
    }

    _onNewShare(share) {
        this._shares.set(share, share.connect('stopped', () => this._shares.delete(share)));
        if (this._strength) {
            this._endShake();
            this._announce();
            this._report('stopped a shake: a screen cast or share started');
        }
    }

    _shake(severity) {
        if (this._strength) {
            this._report(`skipped a ${severity} shake: already shaking`);
            return;
        }
        if (this._shares.size > 0 || Main.sessionMode.isLocked) {
            this._report(`skipped a ${severity} shake: a screen cast or share is running or the session is locked`);
            return;
        }
        const strength = this._strength = Feed.strengthFor(severity);
        const desktop = Main.layoutManager.uiGroup;
        desktop.set_pivot_point(0.5, 0.5);
        this._quake = new Clutter.Timeline({actor: desktop, duration: strength.durationMs});
        this._quake.connect('new-frame', (_timeline, ms) => {
            this._place(Shake.poseAt(strength, ms / strength.durationMs, ms / 1000, desktop));
        });
        this._quake.connect('completed', () => {
            this._endShake();
            this._announce();
        });
        this._quake.start();
        this._report(`shaking for ${strength.durationMs} ms at ${strength.offsetPx} px`);
    }

    _place(pose) {
        const desktop = Main.layoutManager.uiGroup;
        desktop.translation_x = pose.x;
        desktop.translation_y = pose.y;
        desktop.rotation_angle_z = pose.rotation;
        desktop.scale_x = pose.scale;
        desktop.scale_y = pose.scale;
    }

    _endShake() {
        this._quake?.stop();
        this._quake = null;
        this._strength = null;
        this._place(Shake.rest);
        Main.layoutManager.uiGroup.set_pivot_point(0, 0);
    }

    _announce() {
        const notices = this._pendingNotices;
        this._pendingNotices = [];
        for (const notice of notices) {
            const notification = new MessageTray.Notification({
                source: this._notificationSource(),
                title: notice.title,
                body: `Severity: ${notice.severity}`,
            });
            if (notice.url) {
                const open = () => this._openPage(notice.url);
                notification.addAction('Open', open);
                notification.connect('activated', open);
            }
            this._notificationSource().addNotification(notification);
        }
    }

    _notificationSource() {
        if (!this._source) {
            this._source = new MessageTray.Source({title: 'CVEsmic', iconName: 'dialog-warning-symbolic'});
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
        return this._source;
    }

    _openPage(url) {
        try {
            Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1));
        } catch (e) {
            console.warn('cvesmic: could not open', url, e.message);
        }
    }
}
