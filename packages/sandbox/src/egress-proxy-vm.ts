import { REFUSED_HEADER, REFUSED_MESSAGE } from "./egress-proxy";

export const VM_EGRESS_PROXY = `import asyncio, ipaddress, socket, sys
from urllib.parse import urlsplit

PORT = int(sys.argv[1])
EXEMPT = {h.strip().lower() for h in (sys.argv[2] if len(sys.argv) > 2 else "").split(",") if h.strip()}
BODY = b"${REFUSED_MESSAGE}"
REFUSED = (
    b"HTTP/1.1 403 Forbidden\\r\\n${REFUSED_HEADER}: private-address\\r\\n"
    b"Content-Type: text/plain\\r\\nContent-Length: " + str(len(BODY)).encode() + b"\\r\\nConnection: close\\r\\n\\r\\n" + BODY
)
BAD = b"HTTP/1.1 400 Bad Request\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n"
FAILED = b"HTTP/1.1 502 Bad Gateway\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n"
NAT64 = bytes([0, 0x64, 0xFF, 0x9B]) + bytes(8)


def private(address):
    ip = ipaddress.ip_address(address.split("%")[0])
    if ip.version == 6:
        raw = ip.packed
        v4 = ip.ipv4_mapped or ip.sixtofour
        if v4 is None and (raw[:12] == bytes(12) or raw[:12] == NAT64 or raw[:12] == bytes(8) + b"\\xff\\xff\\x00\\x00"):
            v4 = ipaddress.IPv4Address(raw[12:])
        if v4 is not None:
            return private(str(v4))
    return not ip.is_global or ip.is_multicast


async def decide(host, port):
    bare = host.lower().strip("[]")
    name = bare.rstrip(".")
    exempt_name = bool({host.lower(), bare, name, "[" + bare + "]"} & EXEMPT)
    try:
        ipaddress.ip_address(bare.split("%")[0])
        addresses = [bare]
    except ValueError:
        try:
            infos = await asyncio.wait_for(
                asyncio.get_running_loop().getaddrinfo(name, port, type=socket.SOCK_STREAM), 5
            )
        except Exception:
            return None, FAILED
        addresses = list(dict.fromkeys(info[4][0] for info in infos))
    if not addresses:
        return None, FAILED
    if not exempt_name and any(private(a) and a not in EXEMPT and "[" + a + "]" not in EXEMPT for a in addresses):
        return None, REFUSED
    return addresses[0], None


async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


def authority(text, default):
    if text.startswith("["):
        end = text.find("]")
        host, rest = text[: end + 1], text[end + 1 :]
    else:
        host, _, rest = text.partition(":")
        rest = ":" + rest if rest else ""
    port = int(rest[1:]) if rest.startswith(":") and rest[1:].isdigit() else default
    if not host or not 0 < port < 65536:
        raise ValueError(text)
    return host, port


async def handle(reader, writer):
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\\r\\n\\r\\n"), 30)
        line, _, rest = head.partition(b"\\r\\n")
        method, target, version = line.decode("latin-1").split(" ")
        if method == "CONNECT":
            host, port = authority(target, 0)
            request = None
        else:
            url = urlsplit(target)
            if url.scheme != "http":
                raise ValueError(target)
            host, port = authority(url.netloc.rpartition("@")[2], 80)
            path = (url.path or "/") + ("?" + url.query if url.query else "")
            kept = [h for h in rest.split(b"\\r\\n") if h and not h.lower().startswith((b"proxy-connection:", b"proxy-authorization:", b"connection:"))]
            request = (method + " " + path + " " + version).encode("latin-1") + b"\\r\\n" + b"\\r\\n".join(kept + [b"Connection: close"]) + b"\\r\\n\\r\\n"
    except Exception:
        writer.write(BAD)
        await writer.drain()
        writer.close()
        return
    address, refusal = await decide(host, port)
    if refusal is not None:
        writer.write(refusal)
        await writer.drain()
        writer.close()
        return
    try:
        up_reader, up_writer = await asyncio.wait_for(asyncio.open_connection(address, port), 15)
    except Exception:
        writer.write(FAILED)
        await writer.drain()
        writer.close()
        return
    if request is None:
        writer.write(b"HTTP/1.1 200 Connection Established\\r\\n\\r\\n")
        await writer.drain()
    else:
        up_writer.write(request)
    await asyncio.gather(pipe(reader, up_writer), pipe(up_reader, writer))


async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", PORT)
    async with server:
        await server.serve_forever()


asyncio.run(main())
`;
