# CYBERPUNK // RED IDE

A red cyberpunk code editor + terminal that runs in your browser. Near-black
background, neon red glow, scanlines, monospace everywhere.

**Live site:** https://intoxicateddogwalker.github.io/cyberpunk-red-ide/
(enable GitHub Pages on this repo if the link does not load yet:
Settings → Pages → Deploy from a branch → `main` / root.)

## What it is — honestly

- **Editor:** file tree, tabs, syntax highlighting (Python, JS, HTML, CSS,
  JSON, shell, Markdown). Files save in your browser only (localStorage).
  Works on a phone, including iPhone Safari.
- **Terminal:** a built-in shell emulator (`help`, `ls`, `cd`, `pwd`, `cat`,
  `echo`, `touch`, `mkdir`, `rm`, `open`, `new`, `date`, `whoami`, `net`,
  `clear`) running on the same in-browser files. **It is not a real Linux
  system.** It cannot run real programs, install packages, or touch your
  device.
- **Network panel:** shows ONLY what a browser is allowed to show about your
  own connection — online/offline, connection type if the browser exposes it,
  and your public IP on request. **A web page cannot scan Wi-Fi networks or
  see devices near your phone. Browsers block that, and this page does not
  pretend otherwise.** The panel says so on the page itself.

## Real local shell (optional, your own computer only)

`server.py` serves the same pages from your computer and offers a real
interactive shell over a WebSocket at `/shell`, using only the Python
standard library.

```sh
python3 server.py
# open http://127.0.0.1:8765/ and press "Connect real shell"
```

**Warning:** the server binds to localhost only and the shell has no login.
Anyone who can reach it can run commands as you. **Never** bind it to
`0.0.0.0`, never expose it to the internet, never port-forward to it.

## Own-network scanner (optional, your own network only)

`scan_own_network.py` lists the hosts on the local subnet you are already
connected to, using ping plus your own ARP cache. Standard library only.

```sh
python3 scan_own_network.py
```

**Own-network only.** No port scanning, no password cracking, no scanning
networks you are not on, no traffic capture. Run it only on a network you
own or are allowed to check.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page layout |
| `styles.css` | Red cyberpunk theme |
| `app.js` | Editor, terminal emulator, network panel |
| `server.py` | Optional localhost server + real shell over WebSocket |
| `scan_own_network.py` | Optional own-network host lister |

No accounts, no credentials, no tracking, no data leaves your browser
except the public-IP lookup, which you start yourself from the panel.
