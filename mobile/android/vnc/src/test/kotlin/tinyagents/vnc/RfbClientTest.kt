package tinyagents.vnc

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.Timeout
import tinyagents.vnc.FakeRfbServer.Companion.extendedDesktopSize
import tinyagents.vnc.FakeRfbServer.Companion.rawRect
import tinyagents.vnc.FakeRfbServer.Companion.rect
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class RfbClientTest {
    @get:Rule
    val timeout: Timeout = Timeout(30, TimeUnit.SECONDS)

    private val servers = mutableListOf<FakeRfbServer>()

    private fun server(chunk: Int = 0, shared: Boolean = true) = FakeRfbServer(chunk, shared).also { servers += it }.start()

    private fun connected(width: Int, height: Int, chunk: Int = 0) = server(chunk).apply { handshake(width, height) }

    @After
    fun closeClients() {
        servers.forEach { it.client.close() }
    }

    @Test
    fun `handshake speaks RFB 3_8 with security None and sets its own pixel format and encodings`() {
        val s = server()
        s.handshake(640, 480, "bot: browser")
        assertEquals(640, s.client.framebuffer.width)
        assertEquals(480, s.client.framebuffer.height)
        assertEquals(640 * 480, s.client.framebuffer.pixels.size)
        assertTrue("the framebuffer starts opaque black", s.client.framebuffer.pixels.all { it == OPAQUE })
        assertEquals(listOf("connected 640x480 bot: browser"), s.listener.all)
    }

    @Test
    fun `ClientInit is exclusive when not shared`() {
        val s = server(shared = false)
        s.send(Msg().text("RFB 003.008\n"))
        s.read(12)
        s.send(Msg().u8(1, 1))
        s.read(1)
        s.send(Msg().s32(0))
        s.expect("ClientInit", Msg().u8(0))
    }

    @Test
    fun `picks None among several security types`() {
        val s = server()
        s.send(Msg().text("RFB 003.008\n"))
        s.read(12)
        s.send(Msg().u8(3, 2, 19, 1))
        s.expect("security type", Msg().u8(1))
        s.send(Msg().s32(0))
        s.afterSecurity(320, 200)
    }

    @Test
    fun `an RFB 3_3 server picks the security type itself and sends no result`() {
        val s = server()
        s.send(Msg().text("RFB 003.003\n"))
        s.expect("ProtocolVersion", Msg().text("RFB 003.003\n"))
        s.send(Msg().s32(1))
        s.afterSecurity(320, 200)
    }

    @Test
    fun `an RFB 3_7 server offers types but sends no result for None`() {
        val s = server()
        s.send(Msg().text("RFB 003.007\n"))
        s.expect("ProtocolVersion", Msg().text("RFB 003.007\n"))
        s.send(Msg().u8(1, 1))
        s.expect("security type", Msg().u8(1))
        s.afterSecurity(320, 200)
    }

    @Test
    fun `a newer server version is answered with 3_8`() {
        val s = server()
        s.send(Msg().text("RFB 004.001\n"))
        s.expect("ProtocolVersion", Msg().text("RFB 003.008\n"))
    }

    @Test
    fun `a server that refuses reports its reason`() {
        val s = server()
        s.send(Msg().text("RFB 003.008\n"))
        s.read(12)
        s.send(Msg().u8(0).s32(18).text("Too many sessions!"))
        assertEquals("Server refused the connection: Too many sessions!", s.listener.awaitDisconnect())
        s.join()
        assertEquals(1, s.listener.all.size)
    }

    @Test
    fun `a server that only offers authentication fails clearly`() {
        val s = server()
        s.send(Msg().text("RFB 003.008\n"))
        s.read(12)
        s.send(Msg().u8(2, 2, 19))
        assertEquals(
            "Server requires authentication (security types 2, 19); only None is supported",
            s.listener.awaitDisconnect(),
        )
        s.join()
        assertEquals("nothing is sent after the version", 1, s.writes.size)
    }

    @Test
    fun `an RFB 3_3 server that demands a password fails clearly`() {
        val s = server()
        s.send(Msg().text("RFB 003.003\n"))
        s.read(12)
        s.send(Msg().s32(2))
        assertEquals(
            "Server requires authentication (security types 2); only None is supported",
            s.listener.awaitDisconnect(),
        )
    }

    @Test
    fun `a failed SecurityResult reports the server's reason`() {
        val s = server()
        s.send(Msg().text("RFB 003.008\n"))
        s.read(12)
        s.send(Msg().u8(1, 1))
        s.read(1)
        s.send(Msg().s32(1).s32(6).text("Banned"))
        assertEquals("Server refused the connection: Banned", s.listener.awaitDisconnect())
    }

    @Test
    fun `something that is not RFB fails clearly`() {
        val s = server()
        s.send(Msg().text("HTTP/1.1 400 Bad Request\r\n"))
        assertEquals("Not an RFB server", s.listener.awaitDisconnect())
        s.join()
        assertTrue("nothing is sent to a non-RFB peer", s.writes.isEmpty())
    }

    @Test
    fun `end of stream during the handshake is an error`() {
        val s = server()
        s.send(Msg().text("RFB 003"))
        s.endOfStream()
        assertEquals("Connection closed during the handshake", s.listener.awaitDisconnect())
    }

    @Test
    fun `end of stream after the handshake is a clean disconnect, reported once`() {
        val s = connected(64, 64)
        s.endOfStream()
        assertNull(s.listener.awaitDisconnect())
        s.join()
        assertEquals(listOf("connected 64x64 test desktop", "disconnected null"), s.listener.all)
        assertTrue(s.outputClosed)
    }

    @Test
    fun `end of stream in the middle of a message is still a clean disconnect`() {
        val s = connected(64, 64)
        s.send(Msg().u8(0, 0).u16(1).u16(0, 0, 4))
        s.endOfStream()
        assertNull(s.listener.awaitDisconnect())
    }

    @Test
    fun `close ends run with a clean disconnect and stops sending`() {
        val s = connected(64, 64)
        s.client.close()
        assertNull(s.listener.awaitDisconnect())
        s.join()
        val sent = s.writes.size
        s.client.sendPointer(1, 1, 0)
        s.client.sendKey(Keysyms.Return, true)
        assertFalse(s.client.requestDesktopSize(100, 100))
        assertEquals(sent, s.writes.size)
        assertEquals(1, s.listener.all.count { it.startsWith("disconnected") })
    }

    @Test
    fun `close before the handshake finished is clean too`() {
        val s = server()
        s.send(Msg().text("RFB 003.008\n"))
        s.read(12)
        s.client.close()
        assertNull(s.listener.awaitDisconnect())
    }

    @Test(expected = IllegalStateException::class)
    fun `run can only be called once`() {
        val s = connected(8, 8)
        s.client.run()
    }

    @Test
    fun `a failing write ends the connection with the reason`() {
        val input = ByteQueueInputStream()
        val listener = RecordingListener()
        val output = object : OutputStream() {
            override fun write(b: Int) = throw IOException("pipe broke")
            override fun write(b: ByteArray, off: Int, len: Int) = throw IOException("pipe broke")
        }
        val client = RfbClient(input, output, listener)
        val thread = Thread { client.run() }.apply { start() }
        input.offer("RFB 003.008\n".toByteArray())
        assertEquals("Could not send: pipe broke", listener.awaitDisconnect())
        thread.join(5000)
        assertFalse(thread.isAlive)
    }

    @Test
    fun `works over plain java streams too`() {
        val session = Msg().text("RFB 003.008\n").u8(1, 1).s32(0)
            .u16(2, 1).pad(16).s32(1).text("x")
            .u8(0, 0).u16(1).bytes(rawRect(1, 0, 1, 1, intArrayOf(opaque(0x123456))))
            .toByteArray()
        val listener = RecordingListener()
        val out = ByteArrayOutputStream()
        val client = RfbClient(ByteArrayInputStream(session), out, listener)
        client.run()
        assertEquals(listOf("connected 2x1 x", "update 1,0 1x1", "disconnected null"), listener.all)
        assertArrayEquals(intArrayOf(OPAQUE, opaque(0x123456)), client.framebuffer.pixels)
    }

    @Test
    fun `raw rectangles land at their position as opaque ARGB`() {
        val s = connected(8, 6)
        val pixels = noise(3 * 2, seed = 1)
        s.update(rawRect(2, 3, 3, 2, pixels))
        s.expectUpdateRequest(incremental = true, 8, 6)
        assertEquals("update 2,3 3x2", s.listener.next())
        assertArrayEquals(pixels, s.region(2, 3, 3, 2))
        assertEquals("outside the rectangle stays black", OPAQUE, s.pixel(1, 3))
        assertEquals(OPAQUE, s.pixel(5, 4))
        s.update(rect(0, 0, 1, 1, 0, Msg().u8(0x11, 0x22, 0x33, 0x00).toByteArray()))
        s.expectUpdateRequest(incremental = true, 8, 6)
        assertEquals(0xFF332211.toInt(), s.pixel(0, 0))
    }

    @Test
    fun `several rectangles in one update each report a dirty rectangle`() {
        val s = connected(8, 8)
        s.update(
            rawRect(0, 0, 2, 2, noise(4, 2)),
            rawRect(6, 6, 2, 2, noise(4, 3)),
            rect(3, 3, 0, 0, 0),
        )
        s.expectUpdateRequest(incremental = true, 8, 8)
        assertEquals("update 0,0 2x2", s.listener.next())
        assertEquals("update 6,6 2x2", s.listener.next())
        assertArrayEquals(noise(4, 3), s.region(6, 6, 2, 2))
        assertEquals("an empty rectangle is not reported", 3, s.listener.all.size)
    }

    @Test
    fun `a large raw rectangle crosses the read buffer`() {
        val s = connected(400, 300)
        val pixels = noise(400 * 300, seed = 4)
        s.update(rawRect(0, 0, 400, 300, pixels))
        s.expectUpdateRequest(incremental = true, 400, 300)
        assertArrayEquals(pixels, s.client.framebuffer.pixels)
    }

    @Test
    fun `copyrect copies within the framebuffer, overlapping in every direction`() {
        for ((dx, dy) in listOf(1 to 0, -1 to 0, 0 to 1, 0 to -1, 2 to 3, -3 to -2, 3 to -1, -2 to 2)) {
            val s = connected(12, 12)
            val before = noise(12 * 12, seed = 5)
            s.update(rawRect(0, 0, 12, 12, before))
            s.expectUpdateRequest(incremental = true, 12, 12)
            s.update(rect(3 + dx, 3 + dy, 6, 6, 1, Msg().u16(3, 3).toByteArray()))
            s.expectUpdateRequest(incremental = true, 12, 12)
            val expected = before.copyOf()
            for (y in 0 until 6) for (x in 0 until 6) expected[(3 + dy + y) * 12 + 3 + dx + x] = before[(3 + y) * 12 + 3 + x]
            assertArrayEquals("copy by $dx,$dy", expected, s.client.framebuffer.pixels)
            assertEquals("update ${3 + dx},${3 + dy} 6x6", s.listener.all.last())
        }
    }

    @Test
    fun `hextile decodes every tile type`() {
        val s = connected(40, 20)
        val a = opaque(0x102030)
        val b = opaque(0xA0B0C0)
        val c = opaque(0x00FF00)
        val d = opaque(0xFF00FF)
        val rawTile = noise(16 * 16, seed = 6)
        val payload = Msg()
            .u8(1).pixel(*rawTile)
            .u8(2).pixel(a)
            .u8(0)
            .u8(2 or 4 or 8).pixel(b).pixel(c)
            .u8(2).u8(0x00, 0x00)
            .u8(0xF1, 0x00)
            .u8(8).u8(1).u8(0x30, 0x41)
            .u8(8 or 16).u8(2)
            .pixel(d).u8(0x00, 0x11)
            .pixel(a).u8(0x21, 0x10)
            .toByteArray()
        s.update(rect(2, 1, 36, 18, 5, payload))
        s.expectUpdateRequest(incremental = true, 40, 20)
        assertEquals("update 2,1 36x18", s.listener.next())

        val expected = IntArray(36 * 18)
        fun fill(x: Int, y: Int, w: Int, h: Int, colour: Int) {
            for (row in y until y + h) for (col in x until x + w) expected[row * 36 + col] = colour
        }
        for (i in rawTile.indices) expected[(i / 16) * 36 + i % 16] = rawTile[i]
        fill(16, 0, 16, 16, a)
        fill(32, 0, 4, 16, a)
        fill(0, 16, 16, 2, b)
        fill(0, 16, 1, 1, c)
        fill(15, 17, 1, 1, c)
        fill(16, 16, 16, 2, b)
        fill(19, 16, 5, 2, c)
        fill(32, 16, 4, 2, b)
        fill(32, 16, 2, 2, d)
        fill(34, 17, 2, 1, a)
        assertArrayEquals(expected, s.region(2, 1, 36, 18))
        assertEquals("the pixel left of the rectangle is untouched", OPAQUE, s.pixel(1, 1))
    }

    @Test
    fun `hextile background and foreground start over with each rectangle`() {
        val s = connected(16, 16)
        val a = opaque(0x445566)
        s.update(rect(0, 0, 16, 16, 5, Msg().u8(2 or 4).pixel(a).pixel(a).toByteArray()))
        s.expectUpdateRequest(incremental = true, 16, 16)
        assertEquals(a, s.pixel(7, 7))
        s.update(rect(0, 0, 16, 16, 5, Msg().u8(8).u8(1).u8(0x00, 0x00).toByteArray()))
        s.expectUpdateRequest(incremental = true, 16, 16)
        assertEquals(OPAQUE, s.pixel(7, 7))
        assertEquals(OPAQUE, s.pixel(0, 0))
    }

    private val zrleWidth = 100
    private val zrleHeight = 70

    private fun zrleRoundTrip(image: IntArray, mode: (Int) -> TileMode, chunk: Int = 0) {
        val s = connected(zrleWidth + 7, zrleHeight + 5, chunk)
        val payload = ZrleEncoder().encode(image, zrleWidth, zrleHeight, mode)
        s.update(rect(7, 5, zrleWidth, zrleHeight, 16, payload))
        s.expectUpdateRequest(incremental = true, zrleWidth + 7, zrleHeight + 5)
        assertEquals("update 7,5 ${zrleWidth}x$zrleHeight", s.listener.next())
        assertArrayEquals(image, s.region(7, 5, zrleWidth, zrleHeight))
        assertTrue("outside the rectangle stays black", s.region(0, 0, zrleWidth + 7, 5).all { it == OPAQUE })
    }

    private fun paletteImage(colours: Int): IntArray {
        val palette = IntArray(colours) { opaque(0x010203 * (it + 1) + 0x400000) }
        return IntArray(zrleWidth * zrleHeight) { i -> palette[(i % zrleWidth * 7 + i / zrleWidth * 3) % colours] }
    }

    private fun runImage(colours: Int): IntArray {
        val palette = IntArray(colours) { opaque(0x030201 * (it + 1) + 0x000080) }
        val image = IntArray(zrleWidth * zrleHeight)
        val runs = intArrayOf(1, 255, 256, 257, 300, 1, 2, 1, 1, 3022)
        var colour = 0
        var index = 0
        for (run in runs) {
            repeat(run) {
                if (index < 64 * 64) image[(index / 64) * zrleWidth + index % 64] = palette[colour % colours]
                index++
            }
            colour++
        }
        for (y in 0 until zrleHeight) {
            for (x in 0 until zrleWidth) {
                if (x >= 64 && y < 64) image[y * zrleWidth + x] = palette[1 % colours]
                if (y >= 64) image[y * zrleWidth + x] = palette[(x / 9 + y) % colours]
            }
        }
        return image
    }

    @Test
    fun `zrle raw tiles`() = zrleRoundTrip(noise(zrleWidth * zrleHeight, seed = 7), { TileMode.Raw })

    @Test
    fun `zrle solid tiles`() {
        val colours = intArrayOf(opaque(0xAA0000), opaque(0x00BB00), opaque(0x0000CC), opaque(0xFFFFFF))
        val image = IntArray(zrleWidth * zrleHeight) { i -> colours[(i % zrleWidth) / 64 + (i / zrleWidth) / 64 * 2] }
        zrleRoundTrip(image, { TileMode.Solid })
    }

    @Test
    fun `zrle packed palette of 2 colours uses 1 bit per pixel`() = zrleRoundTrip(paletteImage(2), { TileMode.Packed(2) })

    @Test
    fun `zrle packed palettes of 3 and 4 colours use 2 bits per pixel`() {
        zrleRoundTrip(paletteImage(3), { TileMode.Packed(3) })
        zrleRoundTrip(paletteImage(4), { TileMode.Packed(4) })
        zrleRoundTrip(paletteImage(2), { TileMode.Packed(4) })
    }

    @Test
    fun `zrle packed palettes of 5 to 16 colours use 4 bits per pixel`() {
        for (size in 5..16) zrleRoundTrip(paletteImage(size), { TileMode.Packed(size) })
        zrleRoundTrip(paletteImage(3), { TileMode.Packed(16) })
    }

    @Test
    fun `zrle plain rle with runs shorter and longer than 255`() {
        zrleRoundTrip(runImage(5), { TileMode.PlainRle })
        zrleRoundTrip(noise(zrleWidth * zrleHeight, seed = 8), { TileMode.PlainRle })
    }

    @Test
    fun `zrle palette rle with single pixels and long runs`() {
        zrleRoundTrip(runImage(2), { TileMode.PaletteRle(2) })
        zrleRoundTrip(runImage(5), { TileMode.PaletteRle(5) })
        zrleRoundTrip(runImage(100), { TileMode.PaletteRle(127) })
        zrleRoundTrip(paletteImage(16), { TileMode.PaletteRle(16) })
    }

    @Test
    fun `zrle mixes tile types within one rectangle`() {
        val modes = listOf(TileMode.PlainRle, TileMode.Solid, TileMode.Packed(5), TileMode.Raw)
        zrleRoundTrip(runImage(5), { modes[it] })
    }

    @Test
    fun `zrle rectangles of one pixel and one column`() {
        val s = connected(3, 130)
        val encoder = ZrleEncoder()
        val column = noise(130, seed = 9)
        s.update(
            rect(2, 0, 1, 130, 16, encoder.encode(column, 1, 130) { TileMode.Raw }),
            rect(0, 129, 1, 1, 16, encoder.encode(intArrayOf(opaque(0xABCDEF)), 1, 1) { TileMode.Solid }),
            rect(1, 0, 0, 0, 16, ZrleEncoder.frame(ByteArray(0))),
        )
        s.expectUpdateRequest(incremental = true, 3, 130)
        assertArrayEquals(column, s.region(2, 0, 1, 130))
        assertEquals(opaque(0xABCDEF), s.pixel(0, 129))
    }

    @Test
    fun `zrle keeps one zlib stream across rectangles and updates`() {
        val s = connected(128, 64)
        val encoder = ZrleEncoder()
        val image = noise(64 * 64, seed = 10)
        val first = encoder.encode(image, 64, 64) { TileMode.Raw }
        val second = encoder.encode(image, 64, 64) { TileMode.Raw }
        val third = encoder.encode(image, 64, 64) { TileMode.Raw }
        assertTrue("first ${first.size} bytes, second ${second.size}", second.size < first.size / 4)

        s.update(rect(0, 0, 64, 64, 16, first), rect(64, 0, 64, 64, 16, second))
        s.expectUpdateRequest(incremental = true, 128, 64)
        assertArrayEquals(image, s.region(0, 0, 64, 64))
        assertArrayEquals(image, s.region(64, 0, 64, 64))

        s.update(rawRect(0, 0, 1, 1, intArrayOf(OPAQUE)))
        s.expectUpdateRequest(incremental = true, 128, 64)
        s.update(rect(0, 0, 64, 64, 16, third))
        s.expectUpdateRequest(incremental = true, 128, 64)
        assertArrayEquals(image, s.region(0, 0, 64, 64))
    }

    @Test
    fun `zrle tolerates a rectangle split over several deflate blocks and trailing empty blocks`() {
        val s = connected(64, 64)
        val encoder = ZrleEncoder()
        val image = noise(64 * 64, seed = 11)
        val raw = Msg().u8(0).cpixel(*image).toByteArray()
        val compressed = encoder.compress(raw.copyOfRange(0, 100)) +
            encoder.compress(raw.copyOfRange(100, 5000)) +
            encoder.compress(raw.copyOfRange(5000, raw.size)) +
            encoder.compress(ByteArray(0))
        s.update(rect(0, 0, 64, 64, 16, ZrleEncoder.frame(compressed)))
        s.expectUpdateRequest(incremental = true, 64, 64)
        assertArrayEquals(image, s.client.framebuffer.pixels)
        val next = noise(64 * 64, seed = 12)
        s.update(rect(0, 0, 64, 64, 16, encoder.encode(next, 64, 64) { TileMode.Raw }))
        s.expectUpdateRequest(incremental = true, 64, 64)
        assertArrayEquals(next, s.client.framebuffer.pixels)
    }

    @Test
    fun `zrle reads a rectangle to its end when the tail holds no pixel data`() {
        val emptyBlock = byteArrayOf(0, 0, 0, 0xFF.toByte(), 0xFF.toByte())
        for (blocks in listOf(1, 900, 1700, 4200, 7000)) {
            val s = connected(64, 64)
            val encoder = ZrleEncoder()
            val image = noise(64 * 64, seed = 30 + blocks)
            val compressed = ByteArrayOutputStream()
            compressed.write(encoder.compress(Msg().u8(0).cpixel(*image).toByteArray()))
            repeat(blocks) { compressed.write(emptyBlock) }
            s.update(rect(0, 0, 64, 64, 16, ZrleEncoder.frame(compressed.toByteArray())), rawRect(0, 0, 1, 1, intArrayOf(opaque(0x0A0B0C))))
            s.expectUpdateRequest(incremental = true, 64, 64)
            assertEquals("with $blocks empty blocks the next rectangle is read in step", opaque(0x0A0B0C), s.pixel(0, 0))
            assertArrayEquals(image.copyOfRange(1, image.size), s.client.framebuffer.pixels.copyOfRange(1, image.size))
            val next = noise(64 * 64, seed = 31 + blocks)
            s.update(rect(0, 0, 64, 64, 16, encoder.encode(next, 64, 64) { TileMode.Raw }))
            s.expectUpdateRequest(incremental = true, 64, 64)
            assertArrayEquals(next, s.client.framebuffer.pixels)
        }
    }

    @Test
    fun `zrle stays in step when a rectangle's tiles end exactly on an inflate buffer boundary`() {
        val a = opaque(0x112233)
        val b = opaque(0x445566)
        val image = IntArray(66 * 64)
        var index = 0
        var colour = a
        repeat(4078) { run ->
            repeat(if (run < 18) 2 else 1) {
                image[(index / 64) * 66 + index % 64] = colour
                index++
            }
            colour = if (colour == a) b else a
        }
        assertEquals(64 * 64, index)
        for (row in 0 until 64) {
            image[row * 66 + 64] = if (row % 3 == 0) a else b
            image[row * 66 + 65] = if (row % 2 == 0) a else b
        }
        val modes = listOf(TileMode.PlainRle, TileMode.Packed(2))
        for (rects in 1..3) {
            val s = connected(66, 64)
            val encoder = ZrleEncoder()
            repeat(rects) {
                s.update(rect(0, 0, 66, 64, 16, encoder.encode(image, 66, 64) { modes[it] }))
                s.expectUpdateRequest(incremental = true, 66, 64)
                assertArrayEquals(image, s.client.framebuffer.pixels)
            }
            val next = noise(66 * 64, seed = 40)
            s.update(rect(0, 0, 66, 64, 16, encoder.encode(next, 66, 64) { TileMode.Raw }))
            s.expectUpdateRequest(incremental = true, 66, 64)
            assertArrayEquals(next, s.client.framebuffer.pixels)
        }
    }

    @Test
    fun `a whole session delivered one byte at a time`() {
        val s = server(chunk = 1)
        s.handshake(100, 70, "byte by byte")
        val encoder = ZrleEncoder()
        val modes = listOf(TileMode.PaletteRle(5), TileMode.Solid, TileMode.Packed(5), TileMode.Raw)
        val image = runImage(5)
        s.update(extendedDesktopSize(0, 0, 100, 70), rect(0, 0, 100, 70, 16, encoder.encode(image, 100, 70) { modes[it] }))
        s.expectUpdateRequest(incremental = true, 100, 70)
        assertArrayEquals(image, s.client.framebuffer.pixels)

        val a = opaque(0x224466)
        s.update(
            rect(0, 0, 20, 16, 5, Msg().u8(2).pixel(a).u8(1).pixel(*noise(4 * 16, 13)).toByteArray()),
            rect(50, 20, 10, 10, 1, Msg().u16(0, 0).toByteArray()),
            rawRect(98, 68, 2, 2, noise(4, 14)),
        )
        s.expectUpdateRequest(incremental = true, 100, 70)
        assertEquals(a, s.pixel(15, 15))
        assertArrayEquals(noise(4 * 16, 13), s.region(16, 0, 4, 16))
        assertEquals(a, s.pixel(59, 29))
        assertArrayEquals(noise(4, 14), s.region(98, 68, 2, 2))

        s.send(Msg().u8(3).pad(3).s32(5).text("hello"))
        s.send(Msg().u8(2))
        s.update(extendedDesktopSize(1, 0, 30, 20))
        s.expectUpdateRequest(incremental = false, 30, 20)
        assertTrue(s.listener.all.containsAll(listOf("clipboard hello", "bell", "resize 30x20")))
    }

    @Test
    fun `zrle decodes the same in chunks of 3 and 4099 bytes`() {
        zrleRoundTrip(runImage(5), { TileMode.PlainRle }, chunk = 3)
        zrleRoundTrip(noise(zrleWidth * zrleHeight, seed = 15), { TileMode.Raw }, chunk = 4099)
    }

    @Test
    fun `bell, clipboard and skipped messages keep the stream in step`() {
        val s = connected(4, 4)
        s.send(Msg().u8(2))
        s.send(Msg().u8(3).pad(3).s32(6).text("café !"))
        s.send(Msg().u8(1, 0).u16(0, 2).pad(12))
        s.send(Msg().u8(3).pad(3).s32(-8).pad(8))
        s.send(Msg().u8(248).pad(3).s32(1).u8(4).pad(4))
        s.send(Msg().u8(150))
        s.send(Msg().u8(250, 0, 1, 0))
        s.send(Msg().u8(3).pad(3).s32(0))
        s.update(rawRect(0, 0, 1, 1, intArrayOf(opaque(0x010101))))
        s.expectUpdateRequest(incremental = true, 4, 4)
        assertEquals(
            listOf("connected 4x4 test desktop", "bell", "clipboard café !", "clipboard ", "update 0,0 1x1"),
            s.listener.all,
        )
    }

    @Test
    fun `a clipboard larger than 1 MB is skipped, not delivered`() {
        val s = connected(4, 4)
        val size = (1 shl 20) + 1
        s.send(Msg().u8(3).pad(3).s32(size).bytes(ByteArray(size) { 'x'.code.toByte() }))
        s.send(Msg().u8(2))
        assertEquals("bell", s.listener.next())
    }

    @Test
    fun `LastRect ends an update of unknown length`() {
        val s = connected(4, 4)
        s.update(
            rawRect(0, 0, 1, 1, intArrayOf(opaque(0x111111))),
            rawRect(1, 0, 1, 1, intArrayOf(opaque(0x222222))),
            rect(0, 0, 0, 0, -224),
            count = 0xFFFF,
        )
        s.expectUpdateRequest(incremental = true, 4, 4)
        assertEquals(opaque(0x222222), s.pixel(1, 0))
        s.send(Msg().u8(2))
        assertTrue(s.listener.all.contains("update 1,0 1x1"))
        while (s.listener.next() != "bell") {}
    }

    @Test
    fun `ExtendedDesktopSize resizes, reallocates and asks for a full update`() {
        val s = connected(800, 600)
        val before = s.client.framebuffer
        s.update(rawRect(0, 0, 1, 1, intArrayOf(opaque(0x778899))))
        s.expectUpdateRequest(incremental = true, 800, 600)

        s.update(extendedDesktopSize(reason = 0, status = 0, 800, 600))
        s.expectUpdateRequest(incremental = true, 800, 600)
        assertSame(before, s.client.framebuffer)

        s.update(extendedDesktopSize(reason = 0, status = 0, 1024, 700), rawRect(1023, 699, 1, 1, intArrayOf(opaque(0x123123))))
        s.expectUpdateRequest(incremental = false, 1024, 700)
        val after = s.client.framebuffer
        assertNotSame(before, after)
        assertEquals(1024, after.width)
        assertEquals(700, after.height)
        assertEquals("the new framebuffer starts black", OPAQUE, s.pixel(0, 0))
        assertEquals("rectangles after the resize use the new size", opaque(0x123123), s.pixel(1023, 699))
        assertEquals(
            listOf("connected 800x600 test desktop", "update 0,0 1x1", "resize 1024x700", "update 1023,699 1x1"),
            s.listener.all,
        )
        s.update(rawRect(0, 0, 1, 1, intArrayOf(opaque(0x010203))))
        s.expectUpdateRequest(incremental = true, 1024, 700)
    }

    @Test
    fun `DesktopSize resizes too`() {
        val s = connected(800, 600)
        s.update(rect(0, 0, 640, 480, -223))
        s.expectUpdateRequest(incremental = false, 640, 480)
        assertEquals("resize 640x480", s.listener.next())
        assertEquals(640 * 480, s.client.framebuffer.pixels.size)
        assertFalse("DesktopSize alone does not allow resize requests", s.client.requestDesktopSize(700, 500))
    }

    @Test
    fun `requestDesktopSize sends SetDesktopSize with the server's screen id and flags`() {
        val s = connected(800, 600)
        s.update(extendedDesktopSize(reason = 0, status = 0, 800, 600, screenId = 0x0A0B0C0D, flags = 0x01020304))
        s.expectUpdateRequest(incremental = true, 800, 600)
        assertTrue(s.client.requestDesktopSize(1024, 700))
        s.expect(
            "SetDesktopSize",
            Msg().u8(251, 0).u16(1024, 700).u8(1, 0)
                .s32(0x0A0B0C0D).u16(0, 0, 1024, 700).s32(0x01020304),
        )
        s.update(extendedDesktopSize(reason = 1, status = 0, 1024, 700, screenId = 0x0A0B0C0D, flags = 0x01020304))
        s.expectUpdateRequest(incremental = false, 1024, 700)
        assertEquals("resize 1024x700", s.listener.next())
    }

    @Test
    fun `a request made before the server announced the extension is sent once it does`() {
        val s = connected(800, 600)
        assertFalse(s.client.requestDesktopSize(500, 400))
        assertFalse("only the latest request is kept", s.client.requestDesktopSize(1024, 700))
        s.update(rawRect(0, 0, 1, 1, intArrayOf(OPAQUE)))
        s.expectUpdateRequest(incremental = true, 800, 600)

        s.update(extendedDesktopSize(reason = 0, status = 0, 800, 600, screenId = 7, flags = 0))
        s.expect("SetDesktopSize", Msg().u8(251, 0).u16(1024, 700).u8(1, 0).s32(7).u16(0, 0, 1024, 700).s32(0))
        s.expectUpdateRequest(incremental = true, 800, 600)

        s.update(extendedDesktopSize(reason = 0, status = 0, 800, 600, screenId = 7, flags = 0))
        s.expectUpdateRequest(incremental = true, 800, 600)
    }

    @Test
    fun `a refused resize of ours changes nothing`() {
        val s = connected(800, 600)
        val before = s.client.framebuffer
        s.update(extendedDesktopSize(reason = 1, status = 1, 1024, 700))
        s.expectUpdateRequest(incremental = true, 800, 600)
        assertSame(before, s.client.framebuffer)
        assertEquals(1, s.listener.all.size)
        assertTrue("the extension is still known", s.client.requestDesktopSize(640, 480))
    }

    @Test
    fun `invalid desktop sizes are not requested`() {
        val s = connected(800, 600)
        s.update(extendedDesktopSize(reason = 0, status = 0, 800, 600))
        s.expectUpdateRequest(incremental = true, 800, 600)
        val sent = s.writes.size
        assertFalse(s.client.requestDesktopSize(0, 600))
        assertFalse(s.client.requestDesktopSize(800, -1))
        assertFalse(s.client.requestDesktopSize(8193, 600))
        assertEquals(sent, s.writes.size)
    }

    @Test
    fun `an ExtendedDesktopSize with several screens keeps the first`() {
        val s = connected(800, 600)
        val payload = Msg().u8(2).pad(3)
            .s32(41).u16(0, 0, 400, 600).s32(9)
            .s32(42).u16(400, 0, 400, 600).s32(8)
        s.update(rect(0, 0, 800, 600, -308, payload.toByteArray()))
        s.expectUpdateRequest(incremental = true, 800, 600)
        assertTrue(s.client.requestDesktopSize(640, 480))
        s.expect("SetDesktopSize", Msg().u8(251, 0).u16(640, 480).u8(1, 0).s32(41).u16(0, 0, 640, 480).s32(9))
    }

    @Test
    fun `pointer, key and clipboard messages on the wire`() {
        val s = connected(800, 600)
        s.client.sendPointer(300, 513, 1)
        s.expect("PointerEvent", Msg().u8(5, 1).u16(300, 513))
        s.client.sendPointer(300, 513, 0)
        s.expect("PointerEvent", Msg().u8(5, 0).u16(300, 513))
        s.client.sendPointer(0, 0, 64)
        s.expect("PointerEvent", Msg().u8(5, 64).u16(0, 0))
        s.client.sendPointer(-5, 9000, 4)
        s.expect("PointerEvent is clamped to the framebuffer", Msg().u8(5, 4).u16(0, 599))

        s.client.sendKey(Keysyms.Return, true)
        s.expect("KeyEvent", Msg().u8(4, 1).pad(2).s32(0xff0d))
        s.client.sendKey(Keysyms.Return, false)
        s.expect("KeyEvent", Msg().u8(4, 0).pad(2).s32(0xff0d))
        s.client.sendKey(Keysyms.fromChar(0x20AC), true)
        s.expect("KeyEvent", Msg().u8(4, 1).pad(2).s32(0x010020AC))

        s.client.sendClipboard("héllo →")
        s.expect("ClientCutText", Msg().u8(6).pad(3).s32(7).text("héllo ?"))
        s.client.sendClipboard("")
        s.expect("ClientCutText", Msg().u8(6).pad(3).s32(0))
    }

    @Test
    fun `nothing is sent before the handshake finished`() {
        val s = server()
        s.client.sendPointer(1, 1, 1)
        s.client.sendKey(Keysyms.Tab, true)
        s.client.sendClipboard("x")
        s.handshake(100, 100)
        assertEquals(6, s.writes.size)
    }

    @Test
    fun `view only drops pointer, key and clipboard but not resize or update requests`() {
        val s = connected(800, 600)
        s.update(extendedDesktopSize(reason = 0, status = 0, 800, 600))
        s.expectUpdateRequest(incremental = true, 800, 600)
        val sent = s.writes.size

        s.client.viewOnly = true
        s.client.sendPointer(10, 10, 1)
        s.client.sendKey(Keysyms.Return, true)
        s.client.sendClipboard("secret")
        assertEquals("nothing was written", sent, s.writes.size)

        assertTrue(s.client.requestDesktopSize(1024, 700))
        assertEquals(251, s.read(24)[0].toInt() and 0xFF)
        s.update(extendedDesktopSize(reason = 1, status = 0, 1024, 700))
        s.expectUpdateRequest(incremental = false, 1024, 700)
        assertEquals(sent + 2, s.writes.size)

        s.client.viewOnly = false
        s.client.sendPointer(10, 10, 1)
        s.expect("PointerEvent", Msg().u8(5, 1).u16(10, 10))
    }

    @Test
    fun `only standard message types are ever sent`() {
        val s = connected(800, 600)
        s.update(extendedDesktopSize(reason = 0, status = 0, 800, 600))
        s.expectUpdateRequest(incremental = true, 800, 600)
        s.client.sendPointer(1, 2, 1)
        s.client.sendKey(65, true)
        s.client.sendClipboard("x")
        s.client.requestDesktopSize(640, 480)
        val types = s.writes.drop(3).map { it[0].toInt() and 0xFF }
        assertEquals(listOf(0, 2, 3, 3, 5, 4, 6, 251), types)
    }

    @Test
    fun `sends from many threads never interleave with update requests`() {
        val s = connected(64, 64)
        val threads = 4
        val perThread = 300
        val go = CountDownLatch(1)
        val senders = List(threads) { t ->
            Thread {
                go.await()
                repeat(perThread) { i ->
                    s.client.sendPointer(t, i % 64, i and 1)
                    s.client.sendKey(0x61 + t, i and 1 == 0)
                }
            }.apply { start() }
        }
        go.countDown()
        repeat(100) { s.update(rawRect(it % 64, 0, 1, 1, intArrayOf(opaque(it)))) }
        senders.forEach { it.join(10_000) }
        while (s.writes.count { it[0].toInt() == 3 } < 101) Thread.sleep(5)

        assertEquals("two threads were writing at once", 0, s.overlappingWrites.get())
        val messages = s.writes.drop(5)
        val sizes = mapOf(3 to 10, 4 to 8, 5 to 6)
        for (message in messages) {
            assertEquals("a write is exactly one message: ${message.hex()}", sizes[message[0].toInt()], message.size)
        }
        assertEquals(threads * perThread, messages.count { it[0].toInt() == 5 })
        assertEquals(threads * perThread, messages.count { it[0].toInt() == 4 })
        assertEquals(101, messages.count { it[0].toInt() == 3 })
    }

    private fun assertFails(expectedReason: String, width: Int = 64, height: Int = 64, script: (FakeRfbServer) -> Unit) {
        val s = connected(width, height)
        script(s)
        val reason = s.listener.awaitDisconnect()
        assertNotNull("expected a failure", reason)
        assertTrue("reason was: $reason", reason!!.contains(expectedReason))
        s.join()
        assertEquals("onDisconnected is called once", 1, s.listener.all.count { it.startsWith("disconnected") })
        assertEquals("and last", "disconnected $reason", s.listener.all.last())
        assertTrue(s.outputClosed)
    }

    @Test
    fun `a framebuffer that is too large fails instead of allocating`() {
        for ((w, h) in listOf(9000 to 100, 100 to 9000, 8192 to 8192, 65535 to 65535)) {
            val s = server()
            s.send(Msg().text("RFB 003.008\n"))
            s.read(12)
            s.send(Msg().u8(1, 1))
            s.read(1)
            s.send(Msg().s32(0))
            s.read(1)
            s.sendServerInit(w, h, "huge")
            assertEquals("Framebuffer of ${w}x$h is too large", s.listener.awaitDisconnect())
            s.join()
            assertEquals(0, s.client.framebuffer.pixels.size)
        }
    }

    @Test
    fun `a desktop name that is too long fails instead of allocating`() {
        val s = server()
        s.send(Msg().text("RFB 003.008\n"))
        s.read(12)
        s.send(Msg().u8(1, 1))
        s.read(1)
        s.send(Msg().s32(0))
        s.read(1)
        s.send(Msg().u16(100, 100).pad(16).s32(0x7FFFFFFF))
        assertEquals("The desktop name is too long (2147483647 bytes)", s.listener.awaitDisconnect())
    }

    @Test
    fun `a refusal reason that is too long fails instead of allocating`() {
        val s = server()
        s.send(Msg().text("RFB 003.008\n"))
        s.read(12)
        s.send(Msg().u8(0).s32(-1))
        assertEquals("The reason is too long (4294967295 bytes)", s.listener.awaitDisconnect())
    }

    @Test
    fun `a resize to a size that is too large fails`() {
        assertFails("Framebuffer of 20000x100 is too large") { it.update(rect(0, 0, 20000, 100, -223)) }
        assertFails("Framebuffer of 5000x5000 is too large") { it.update(extendedDesktopSize(0, 0, 5000, 5000)) }
    }

    @Test
    fun `rectangles outside the framebuffer fail`() {
        assertFails("Rectangle 2x1 at 63,0 is outside the 64x64 framebuffer") { it.update(rect(63, 0, 2, 1, 0)) }
        assertFails("outside the 64x64 framebuffer") { it.update(rect(0, 60, 4, 5, 16)) }
        assertFails("outside the 64x64 framebuffer") { it.update(rect(65535, 65535, 65535, 65535, 5)) }
        assertFails("outside the 64x64 framebuffer") { it.update(rect(0, 0, 65, 1, 1, Msg().u16(0, 0).toByteArray())) }
        assertFails("CopyRect source is outside the framebuffer") { it.update(rect(0, 0, 8, 8, 1, Msg().u16(60, 0).toByteArray())) }
    }

    @Test
    fun `an unknown encoding or message type fails`() {
        assertFails("Unsupported encoding 7") { it.update(rect(0, 0, 4, 4, 7)) }
        assertFails("Unsupported encoding -239") { it.update(rect(0, 0, 4, 4, -239)) }
        assertFails("Unsupported server message type 99") { it.send(Msg().u8(99)) }
    }

    @Test
    fun `invalid hextile fails`() {
        assertFails("Hextile sub-rectangle outside its tile") {
            it.update(rect(0, 0, 16, 16, 5, Msg().u8(2 or 4 or 8).pixel(OPAQUE, OPAQUE).u8(1).u8(0xE0, 0x30).toByteArray()))
        }
        assertFails("Hextile sub-rectangle outside its tile") {
            it.update(rect(0, 0, 4, 2, 5, Msg().u8(8).u8(1).u8(0x00, 0xFF).toByteArray()))
        }
    }

    private fun zrleFailure(reason: String, width: Int = 64, height: Int = 64, tile: Msg) {
        assertFails(reason) {
            it.update(rect(0, 0, width, height, 16, ZrleEncoder.frame(ZrleEncoder().compress(tile.toByteArray()))))
        }
    }

    @Test
    fun `invalid zrle fails`() {
        zrleFailure("ZRLE: invalid tile type 17", tile = Msg().u8(17).pad(64))
        zrleFailure("ZRLE: invalid tile type 127", tile = Msg().u8(127).pad(64))
        zrleFailure("ZRLE: invalid tile type 129", tile = Msg().u8(129).pad(64))
        zrleFailure("ZRLE palette index out of range", tile = Msg().u8(3).cpixel(1, 2, 3).u8(0xFF).pad(2000))
        zrleFailure("ZRLE palette index out of range", tile = Msg().u8(130).cpixel(1, 2).u8(5).pad(100))
        zrleFailure("ZRLE run overflows its tile", tile = Msg().u8(128).cpixel(1).u8(*IntArray(16) { 255 }).u8(16))
        zrleFailure("ZRLE run overflows its tile", tile = Msg().u8(130).cpixel(1, 2).u8(0x80).u8(*IntArray(17) { 255 }).u8(0))
        zrleFailure("ZRLE run overflows its tile", width = 2, height = 2, tile = Msg().u8(128).cpixel(1).u8(4))
        zrleFailure("ZRLE run overflows its tile", tile = Msg().u8(128).cpixel(1).u8(*IntArray(5000) { 255 }))
        zrleFailure("ZRLE rectangle is shorter than its tiles", tile = Msg().u8(0).cpixel(1, 2, 3))
        assertFails("ZRLE rectangle is shorter than its tiles") { it.update(rect(0, 0, 4, 4, 16, ZrleEncoder.frame(ByteArray(0)))) }
    }

    @Test
    fun `corrupt zlib data fails`() {
        assertFails("ZRLE: corrupt zlib data") {
            it.update(rect(0, 0, 4, 4, 16, ZrleEncoder.frame(ByteArray(64) { 0xAB.toByte() })))
        }
    }

    @Test
    fun `a finished zlib stream fails`() {
        val deflater = java.util.zip.Deflater()
        deflater.setInput(Msg().u8(1).cpixel(opaque(0x334455)).toByteArray())
        deflater.finish()
        val buffer = ByteArray(256)
        val finished = buffer.copyOf(deflater.deflate(buffer))
        assertFails("ZRLE") {
            it.update(rect(0, 0, 4, 4, 16, ZrleEncoder.frame(finished)), rect(0, 0, 4, 4, 16, ZrleEncoder.frame(finished)))
        }
    }
}
