package tinyagents.vnc

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.Deflater

internal class RecordingListener : RfbListener {
    val all = CopyOnWriteArrayList<String>()
    private val queue = LinkedBlockingQueue<String>()

    private fun add(event: String) {
        all += event
        queue += event
    }

    fun next(): String = queue.poll(5, TimeUnit.SECONDS) ?: error("no listener event within 5s, saw $all")

    fun awaitDisconnect(): String? {
        while (true) {
            val event = queue.poll(5, TimeUnit.SECONDS) ?: error("no disconnect within 5s, saw $all")
            if (event.startsWith("disconnected ")) return event.removePrefix("disconnected ").takeIf { it != "null" }
        }
    }

    override fun onConnected(width: Int, height: Int, name: String) = add("connected ${width}x$height $name")
    override fun onFramebufferUpdate(x: Int, y: Int, width: Int, height: Int) = add("update $x,$y ${width}x$height")
    override fun onResize(width: Int, height: Int) = add("resize ${width}x$height")
    override fun onBell() = add("bell")
    override fun onServerClipboard(text: String) = add("clipboard $text")
    override fun onDisconnected(reason: String?) = add("disconnected $reason")
}

internal class Msg {
    private val out = ByteArrayOutputStream()

    fun u8(vararg values: Int) = apply { values.forEach { out.write(it) } }
    fun u16(vararg values: Int) = apply { values.forEach { out.write(it shr 8); out.write(it) } }
    fun s32(vararg values: Int) = apply { values.forEach { v -> out.write(v shr 24); out.write(v shr 16); out.write(v shr 8); out.write(v) } }
    fun bytes(value: ByteArray) = apply { out.write(value) }
    fun text(value: String) = bytes(value.toByteArray(Charsets.ISO_8859_1))
    fun pad(count: Int) = apply { repeat(count) { out.write(0) } }

    fun pixel(vararg argb: Int) = apply { argb.forEach { c -> out.write(c); out.write(c shr 8); out.write(c shr 16); out.write(0x5A) } }

    fun cpixel(vararg argb: Int) = apply { argb.forEach { c -> out.write(c); out.write(c shr 8); out.write(c shr 16) } }

    fun toByteArray(): ByteArray = out.toByteArray()
}

internal class FakeRfbServer(
    private val chunk: Int = 0,
    shared: Boolean = true,
    factory: (InputStream, OutputStream, RfbListener) -> RfbClient = { input, output, listener ->
        RfbClient(input, output, listener, shared)
    },
) {
    private val toClient = ByteQueueInputStream()
    private val fromClientQueue = ByteQueueInputStream()

    val writes = CopyOnWriteArrayList<ByteArray>()

    val overlappingWrites = AtomicInteger(0)
    var outputClosed = false
        private set
    private val writers = AtomicInteger(0)
    private var flushed = true

    val fromClient = DataInputStream(fromClientQueue)
    val listener = RecordingListener()
    val client = factory(
        toClient,
        object : OutputStream() {
            override fun write(b: Int) = error("the client must write whole messages, not single bytes")

            override fun write(b: ByteArray, off: Int, len: Int) {
                if (writers.incrementAndGet() > 1) overlappingWrites.incrementAndGet()
                check(flushed) { "write without a flush after the previous message" }
                flushed = false
                val copy = b.copyOfRange(off, off + len)
                writes += copy
                Thread.yield()
                fromClientQueue.offer(copy)
                writers.decrementAndGet()
            }

            override fun flush() {
                if (writers.incrementAndGet() > 1) overlappingWrites.incrementAndGet()
                flushed = true
                writers.decrementAndGet()
            }

            override fun close() {
                outputClosed = true
                fromClientQueue.endOfStream()
            }
        },
        listener,
    )
    val thread = Thread({ client.run() }, "rfb-client").apply { isDaemon = true }

    fun start() = apply { thread.start() }

    fun send(bytes: ByteArray) {
        if (chunk <= 0) {
            toClient.offer(bytes)
        } else {
            var offset = 0
            while (offset < bytes.size) {
                val end = minOf(bytes.size, offset + chunk)
                toClient.offer(bytes.copyOfRange(offset, end))
                offset = end
            }
        }
    }

    fun send(message: Msg) = send(message.toByteArray())

    fun endOfStream() = toClient.endOfStream()

    fun read(count: Int): ByteArray {
        val deadline = System.nanoTime() + 10_000_000_000L
        while (fromClientQueue.available() < count) {
            if (System.nanoTime() > deadline) {
                throw AssertionError("expected $count bytes from the client, got ${read(fromClientQueue.available()).hex()}")
            }
            Thread.sleep(1)
        }
        return ByteArray(count).also { fromClient.readFully(it) }
    }

    fun expect(what: String, expected: ByteArray) {
        val actual = read(expected.size)
        assertArrayEquals("$what: expected ${expected.hex()} but the client sent ${actual.hex()}", expected, actual)
    }

    fun expect(what: String, expected: Msg) = expect(what, expected.toByteArray())

    fun expectUpdateRequest(incremental: Boolean, width: Int, height: Int) {
        expect(
            "FramebufferUpdateRequest",
            Msg().u8(3, if (incremental) 1 else 0).u16(0, 0, width, height),
        )
    }

    fun handshake(width: Int, height: Int, name: String = "test desktop") {
        send(Msg().text("RFB 003.008\n"))
        expect("ProtocolVersion", Msg().text("RFB 003.008\n"))
        send(Msg().u8(1, 1))
        expect("security type", Msg().u8(1))
        send(Msg().s32(0))
        afterSecurity(width, height, name)
    }

    fun afterSecurity(width: Int, height: Int, name: String = "test desktop") {
        expect("ClientInit", Msg().u8(1))
        sendServerInit(width, height, name)
        expect("SetPixelFormat", SET_PIXEL_FORMAT)
        expect("SetEncodings", SET_ENCODINGS)
        expectUpdateRequest(incremental = false, width, height)
        assertEquals("connected ${width}x$height $name", listener.next())
    }

    fun sendServerInit(width: Int, height: Int, name: String) {
        val nameBytes = name.toByteArray(Charsets.UTF_8)
        send(
            Msg().u16(width, height)
                .u8(16, 16, 1, 1).u16(31, 63, 31).u8(11, 5, 0).pad(3)
                .s32(nameBytes.size).bytes(nameBytes),
        )
    }

    fun update(vararg rects: ByteArray, count: Int = rects.size) {
        val message = Msg().u8(0, 0).u16(count)
        rects.forEach { message.bytes(it) }
        send(message)
    }

    fun pixel(x: Int, y: Int): Int {
        val fb = client.framebuffer
        return fb.pixels[y * fb.width + x]
    }

    fun region(x: Int, y: Int, width: Int, height: Int): IntArray {
        val fb = client.framebuffer
        return IntArray(width * height) { i -> fb.pixels[(y + i / width) * fb.width + x + i % width] }
    }

    fun join() {
        thread.join(5000)
        check(!thread.isAlive) { "the client thread did not finish" }
    }

    companion object {
        val SET_PIXEL_FORMAT: ByteArray = Msg().u8(0, 0, 0, 0)
            .u8(32, 24, 0, 1).u16(255, 255, 255).u8(16, 8, 0).pad(3).toByteArray()

        val SET_ENCODINGS: ByteArray = Msg().u8(2, 0).u16(7).s32(16, 5, 1, 0, -223, -308, -224).toByteArray()

        fun rect(x: Int, y: Int, width: Int, height: Int, encoding: Int, payload: ByteArray = ByteArray(0)): ByteArray =
            Msg().u16(x, y, width, height).s32(encoding).bytes(payload).toByteArray()

        fun rawRect(x: Int, y: Int, width: Int, height: Int, pixels: IntArray): ByteArray =
            rect(x, y, width, height, 0, Msg().pixel(*pixels).toByteArray())

        fun extendedDesktopSize(
            reason: Int,
            status: Int,
            width: Int,
            height: Int,
            screenId: Int = 0x11223344,
            flags: Int = 0x55667788,
        ): ByteArray = rect(
            reason, status, width, height, -308,
            Msg().u8(1).pad(3).s32(screenId).u16(0, 0, width, height).s32(flags).toByteArray(),
        )
    }
}

internal fun ByteArray.hex(): String = joinToString(" ") { "%02x".format(it) }

internal fun noise(count: Int, seed: Int): IntArray {
    val random = java.util.Random(seed.toLong())
    return IntArray(count) { OPAQUE or random.nextInt(0x1000000) }
}

internal fun opaque(rgb: Int): Int = OPAQUE or rgb

internal sealed interface TileMode {
    data object Raw : TileMode
    data object Solid : TileMode

    data class Packed(val size: Int) : TileMode
    data object PlainRle : TileMode

    data class PaletteRle(val size: Int) : TileMode
}

internal class ZrleEncoder {
    private val deflater = Deflater()

    fun encode(image: IntArray, width: Int, height: Int, mode: (tile: Int) -> TileMode): ByteArray {
        val raw = Msg()
        var index = 0
        for (ty in 0 until height step 64) {
            for (tx in 0 until width step 64) {
                val tw = minOf(64, width - tx)
                val th = minOf(64, height - ty)
                val tile = IntArray(tw * th) { i -> image[(ty + i / tw) * width + tx + i % tw] }
                encodeTile(raw, tile, tw, th, mode(index++))
            }
        }
        return frame(compress(raw.toByteArray()))
    }

    fun compress(data: ByteArray): ByteArray {
        deflater.setInput(data)
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        do {
            val n = deflater.deflate(buffer, 0, buffer.size, Deflater.SYNC_FLUSH)
            out.write(buffer, 0, n)
        } while (n == buffer.size)
        return out.toByteArray()
    }

    private fun encodeTile(out: Msg, tile: IntArray, tw: Int, th: Int, mode: TileMode) {
        when (mode) {
            TileMode.Raw -> out.u8(0).cpixel(*tile)
            TileMode.Solid -> {
                require(tile.all { it == tile[0] }) { "a solid tile needs one colour" }
                out.u8(1).cpixel(tile[0])
            }
            is TileMode.Packed -> {
                val palette = palette(tile, mode.size)
                out.u8(mode.size).cpixel(*palette)
                val bits = if (mode.size == 2) 1 else if (mode.size <= 4) 2 else 4
                for (row in 0 until th) {
                    var byte = 0
                    var used = 0
                    for (col in 0 until tw) {
                        byte = (byte shl bits) or palette.indexOf(tile[row * tw + col])
                        used += bits
                        if (used == 8) {
                            out.u8(byte)
                            byte = 0
                            used = 0
                        }
                    }
                    if (used > 0) out.u8(byte shl (8 - used))
                }
            }
            TileMode.PlainRle -> {
                out.u8(128)
                forEachRun(tile) { colour, length ->
                    out.cpixel(colour)
                    runLength(out, length)
                }
            }
            is TileMode.PaletteRle -> {
                val palette = palette(tile, mode.size)
                out.u8(128 + mode.size).cpixel(*palette)
                forEachRun(tile) { colour, length ->
                    val index = palette.indexOf(colour)
                    if (length == 1) {
                        out.u8(index)
                    } else {
                        out.u8(index or 0x80)
                        runLength(out, length)
                    }
                }
            }
        }
    }

    private fun palette(tile: IntArray, size: Int): IntArray {
        val colours = tile.distinct()
        require(colours.size <= size) { "the tile has ${colours.size} colours, more than $size" }
        return IntArray(size) { i -> if (i < colours.size) colours[i] else opaque(0xF0F000 + i) }
    }

    private fun forEachRun(tile: IntArray, run: (colour: Int, length: Int) -> Unit) {
        var start = 0
        while (start < tile.size) {
            var end = start
            while (end < tile.size && tile[end] == tile[start]) end++
            run(tile[start], end - start)
            start = end
        }
    }

    private fun runLength(out: Msg, length: Int) {
        var left = length - 1
        while (left >= 255) {
            out.u8(255)
            left -= 255
        }
        out.u8(left)
    }

    companion object {
        fun frame(compressed: ByteArray): ByteArray = Msg().s32(compressed.size).bytes(compressed).toByteArray()
    }
}
