#!/usr/bin/env python3
"""List the hosts on YOUR OWN local network only.

OWN-NETWORK ONLY. Run this on your own computer, on a network you own
or are allowed to check. It pings the addresses on the subnet you are
already connected to and reads your own ARP cache to show hostnames
and MAC addresses. It does:

  * NO port scanning
  * NO password cracking or guessing
  * NO scanning of networks you are not connected to
  * NO traffic capture

If that is not what you want, do not run it.

Usage:
    python3 scan_own_network.py            # scan your own /24 subnet
    python3 scan_own_network.py 192.168.1  # scan a specific local prefix

Standard library only. Needs the system `ping` command.
"""

import concurrent.futures
import ipaddress
import platform
import re
import socket
import subprocess
import sys


def own_address():
    """The local IP this machine uses for outbound traffic (no data sent)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return socket.gethostbyname(socket.gethostname())
    finally:
        sock.close()


def ping_host(ip, timeout=1):
    system = platform.system()
    if system == "Windows":
        cmd = ["ping", "-n", "1", "-w", str(timeout * 1000), str(ip)]
    elif system == "Darwin":
        cmd = ["ping", "-c", "1", "-t", str(timeout), str(ip)]
    else:
        cmd = ["ping", "-c", "1", "-W", str(timeout), str(ip)]
    try:
        result = subprocess.run(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout + 2
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def arp_table():
    """IP -> MAC from this machine's own ARP cache. Best effort."""
    table = {}
    commands = []
    if platform.system() == "Windows":
        commands = [["arp", "-a"]]
    elif platform.system() == "Darwin":
        commands = [["arp", "-a"]]
    else:
        commands = [["ip", "neigh", "show"], ["arp", "-a"]]
    mac_re = re.compile(r"([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})")
    ip_re = re.compile(r"(\d+\.\d+\.\d+\.\d+)")
    for cmd in commands:
        try:
            out = subprocess.run(
                cmd, capture_output=True, text=True, timeout=10
            ).stdout
        except (OSError, subprocess.TimeoutExpired):
            continue
        for line in out.splitlines():
            ip_match = ip_re.search(line)
            mac_match = mac_re.search(line)
            if ip_match and mac_match:
                table[ip_match.group(1)] = mac_match.group(1).lower()
        if table:
            break
    return table


def main():
    if len(sys.argv) > 1:
        prefix = sys.argv[1].strip()
        try:
            network = ipaddress.ip_network(prefix + ".0/24", strict=False)
        except ValueError:
            print(f"Bad prefix: {prefix!r}. Use e.g. 192.168.1")
            return 2
    else:
        me = own_address()
        network = ipaddress.ip_network(me + "/24", strict=False)
        print(f"Your address: {me}  —  scanning your own subnet: {network}")

    print("OWN NETWORK ONLY. No ports, no passwords, no other networks.")
    hosts = [str(ip) for ip in network.hosts()]
    live = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=48) as pool:
        results = pool.map(ping_host, hosts)
        for ip, up in zip(hosts, results):
            if up:
                live.append(ip)

    arp = arp_table()
    print(f"\n{len(live)} host(s) answered on {network}:")
    print(f"{'IP':<16} {'MAC (from ARP cache)':<20} {'Name (reverse DNS)':<30}")
    print("-" * 68)
    for ip in live:
        try:
            name = socket.gethostbyaddr(ip)[0]
        except (OSError, socket.herror):
            name = "-"
        print(f"{ip:<16} {arp.get(ip, '- '):<20} {name:<30}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
