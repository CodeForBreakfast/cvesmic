# CVEsmic

CVEsmic is a Wayland desktop app that shakes the screen when a new vulnerability
appears. The severity of the vulnerability sets the strength of the shake. The
vulnerabilities come from the pwn.watch feed.

## What CVEsmic owns

- **Spotting new vulnerabilities:** how it reads the pwn.watch feed and decides
  which entries are new.
- **The strength of the shake:** how each severity maps to a strength.
- **The shake:** how the effect appears on a Wayland desktop.

## What it does not own

- **The vulnerability data:** the feed's entries and their severities belong to
  pwn.watch.
- **The desktop:** the compositor and the shell belong to their own upstream
  projects.
- **The response to a vulnerability:** triage and patching belong to whoever runs
  the affected system.
- **A user's deployment, configuration and data:** these live with that user.
