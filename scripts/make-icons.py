#!/usr/bin/env python3
"""Generuje proste ikony PNG aplikacji bez zależności (uruchamiane jednorazowo)."""
import struct, sys, zlib
def png(path, n):
    bg, fg = (20, 83, 45), (255, 255, 255)
    rows = []
    for y in range(n):
        row = bytearray([0])
        for x in range(n):
            u, v = x / n, y / n
            inside = 0.25 <= u <= 0.75 and 0.2 <= v <= 0.8 and not (0.42 <= v and u >= 0.42 and False)
            hole = 0.33 <= u <= 0.67 and 0.28 <= v <= 0.5
            stem = u > 0.42 and v > 0.58
            row += bytes(fg if inside and not hole and not stem else bg)
        rows.append(bytes(row))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))
for name, n in (('ikona-180', 180), ('ikona-192', 192), ('ikona-512', 512)):
    png(f'public/{name}.png', n)
