package tinyagents.vnc

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.Timeout
import java.awt.image.BufferedImage
import java.io.File
import java.io.FilterInputStream
import java.io.InputStream
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import javax.imageio.ImageIO

/**
 * [RfbClient] against a real Xtigervnc over TCP. Skipped unless `VNC_TEST_PORT` names the RFB
 * port of a server started like the product starts it:
 *
 *     Xtigervnc :77 -geometry 800x600 -depth 24 -rfbport 5977 -localhost -SecurityTypes None -AlwaysShared
 *
 * `VNC_TEST_DISPLAY` (":77") is the same server's X display, which the tests draw on with
 * xsetroot and xterm and read back with xdotool and xev (packages x11-xserver-utils, xterm,
 * xdotool, x11-utils). Screenshots and a log of what was seen go to `build/vnc-it/`.
 */
class RealServerTest {
    @get:Rule
    val timeout: Timeout = Timeout(120, TimeUnit.SECONDS)

    private val port = System.getenv("VNC_TEST_PORT")?.toIntOrNull()
    private val display = System.getenv("VNC_TEST_DISPLAY")
    private val outDir = File("build/vnc-it")
    private val sessions = mutableListOf<Session>()
    private val processes = mutableListOf<Process>()

    /** One client connection to the real server. */
    private inner class Session(
        encodings: IntArray? = null,
        wrap: (InputStream) -> InputStream = { it },
    ) : RfbListener {
        val socket = Socket("127.0.0.1", port!!)
        val events = CopyOnWriteArrayList<String>()
        val encodingsSeen = ConcurrentHashMap<Int, AtomicInteger>()
        val updates = AtomicInteger()
        val lastRect = AtomicLong(System.nanoTime())
        val client = if (encodings == null) {
            RfbClient(wrap(socket.getInputStream()), socket.getOutputStream(), this)
        } else {
            RfbClient(wrap(socket.getInputStream()), socket.getOutputStream(), this, true, encodings)
        }
        val thread = Thread({ client.run() }, "rfb-real").apply { isDaemon = true }

        init {
            client.rectObserver = { encoding, _, _, _, _ ->
                encodingsSeen.computeIfAbsent(encoding) { AtomicInteger() }.incrementAndGet()
                lastRect.set(System.nanoTime())
            }
            sessions += this
            thread.start()
            await("the handshake") { events.any { it.startsWith("connected") } }
        }

        override fun onConnected(width: Int, height: Int, name: String) {
            events += "connected ${width}x$height $name"
        }

        override fun onFramebufferUpdate(x: Int, y: Int, width: Int, height: Int) {
            updates.incrementAndGet()
        }

        override fun onResize(width: Int, height: Int) {
            events += "resize ${width}x$height"
        }

        override fun onServerClipboard(text: String) {
            events += "clipboard $text"
        }

        override fun onDisconnected(reason: String?) {
            events += "disconnected $reason"
        }

        fun pixel(x: Int, y: Int): Int = client.framebuffer.let { it.pixels[y * it.width + x] }

        /** Waits until pixels arrived and the server has been quiet for a moment. */
        fun settle() {
            await("a framebuffer update") { updates.get() > 0 }
            await("the server to go quiet") { System.nanoTime() - lastRect.get() > 500_000_000L }
        }

        fun seen(): String = encodingsSeen.toSortedMap().entries.joinToString { "${encodingName(it.key)} x${it.value}" }

        fun type(text: String) {
            text.codePoints().forEach { codePoint ->
                val keysym = Keysyms.fromChar(codePoint)
                client.sendKey(keysym, true)
                client.sendKey(keysym, false)
            }
        }

        fun click(x: Int, y: Int, mask: Int) {
            client.sendPointer(x, y, 0)
            client.sendPointer(x, y, mask)
            client.sendPointer(x, y, 0)
        }
    }

    @Before
    fun requireServer() {
        assumeTrue("set VNC_TEST_PORT to run against a real VNC server", port != null)
        outDir.mkdirs()
    }

    @After
    fun cleanUp() {
        sessions.forEach { it.client.close() }
        processes.forEach { it.destroy() }
        processes.forEach { if (!it.waitFor(3, TimeUnit.SECONDS)) it.destroyForcibly() }
    }

    private fun requireDisplay() = assumeTrue("set VNC_TEST_DISPLAY to drive the X server", display != null)

    private fun await(what: String, timeoutMillis: Long = 15_000, condition: () -> Boolean) {
        val deadline = System.nanoTime() + timeoutMillis * 1_000_000
        while (!condition()) {
            if (System.nanoTime() > deadline) throw AssertionError("timed out waiting for $what")
            Thread.sleep(20)
        }
    }

    private fun start(vararg command: String, environment: Map<String, String> = emptyMap()): Process {
        val builder = ProcessBuilder(*command).redirectErrorStream(true)
        builder.environment()["DISPLAY"] = display!!
        builder.environment().putAll(environment)
        return builder.start().also { processes += it }
    }

    /** Runs an X client to completion and returns its output. */
    private fun x(vararg command: String): String {
        val process = start(*command)
        val output = process.inputStream.bufferedReader().readText()
        assertTrue("${command.joinToString(" ")} timed out", process.waitFor(10, TimeUnit.SECONDS))
        return output.trim()
    }

    private fun log(line: String) {
        println("[RealServerTest] $line")
        File(outDir, "report.txt").appendText(line + "\n")
    }

    private fun dump(fb: RfbFramebuffer, name: String): File {
        val image = BufferedImage(fb.width, fb.height, BufferedImage.TYPE_INT_RGB)
        image.setRGB(0, 0, fb.width, fb.height, fb.pixels, 0, fb.width)
        return File(outDir, name).also { ImageIO.write(image, "png", it) }
    }

    private fun encodingName(encoding: Int): String = when (encoding) {
        0 -> "Raw"
        1 -> "CopyRect"
        5 -> "Hextile"
        16 -> "ZRLE"
        -223 -> "DesktopSize"
        -224 -> "LastRect"
        -308 -> "ExtendedDesktopSize"
        else -> "encoding $encoding"
    }

    private fun mouseLocation(): String = x("xdotool", "getmouselocation").substringBefore(" screen")

    /** An xterm at (100,100), dark with green text, that waits for one line and saves it. */
    private fun startXterm(lineFile: File): Process {
        lineFile.delete()
        val script = "IFS= read -r line; printf '%s' \"\$line\" > '${lineFile.absolutePath}'; sleep 600"
        return start(
            "xterm", "-u8", "-geometry", "60x10+100+100", "-bg", "#101010", "-fg", "#00ff00",
            "-e", "sh", "-c", script,
            environment = mapOf("LC_ALL" to "C.UTF-8"),
        )
    }

    private fun resetScreen(session: Session) {
        if (session.client.framebuffer.width == 800 && session.client.framebuffer.height == 600) return
        session.client.requestDesktopSize(800, 600)
        await("the desktop to return to 800x600") { session.client.framebuffer.width == 800 }
    }

    @Test
    fun `connects, receives the real screen with ZRLE, and decodes it like Raw and Hextile`() {
        requireDisplay()
        x("xsetroot", "-solid", "#336699")
        x("xdotool", "mousemove", "700", "500")
        val lineFile = File(outDir, "typed-unused.txt")
        startXterm(lineFile)

        val zrle = Session()
        resetScreen(zrle)
        assertTrue(zrle.events.first().startsWith("connected 800x600"))
        // The xterm's dark background shows up inside the window, the root colour around it.
        await("the xterm to appear") { zrle.pixel(110, 110) == opaque(0x101010) }
        zrle.settle()
        assertEquals(opaque(0x336699), zrle.pixel(10, 10))
        assertEquals(opaque(0x336699), zrle.pixel(790, 590))
        assertEquals(opaque(0x336699), zrle.pixel(10, 590))
        val root = zrle.client.framebuffer.pixels.count { it == opaque(0x336699) }
        assertTrue("most of the screen is the root colour, got $root pixels", root > 800 * 600 / 2)
        assertTrue("every pixel is opaque", zrle.client.framebuffer.pixels.all { it ushr 24 == 0xFF })
        log("default encodings, server used: ${zrle.seen()}")
        assertTrue("the server used ZRLE", zrle.encodingsSeen.containsKey(16))
        assertFalse("the server used Raw", zrle.encodingsSeen.containsKey(0))
        assertFalse("the server used Hextile", zrle.encodingsSeen.containsKey(5))
        assertTrue("the server announced ExtendedDesktopSize", zrle.encodingsSeen.containsKey(-308))
        dump(zrle.client.framebuffer, "screen-zrle.png")

        // The same static screen through the other decoders, and through a stream that hands
        // out a few bytes at a time, must be identical pixel for pixel.
        val raw = Session(encodings = intArrayOf(0))
        raw.settle()
        log("Raw only, server used: ${raw.seen()}")
        assertEquals(setOf(0), raw.encodingsSeen.keys)
        val hextile = Session(encodings = intArrayOf(5, 0))
        hextile.settle()
        log("Hextile first, server used: ${hextile.seen()}")
        assertTrue(hextile.encodingsSeen.containsKey(5))
        var reads = 0
        val trickle = Session(
            wrap = { source ->
                object : FilterInputStream(source) {
                    override fun read(b: ByteArray, off: Int, len: Int): Int = super.read(b, off, minOf(len, 1 + reads++ % 7))
                }
            },
        )
        trickle.settle()
        zrle.settle()
        assertArrayEquals("ZRLE and Raw decode the same screen", raw.client.framebuffer.pixels, zrle.client.framebuffer.pixels)
        assertArrayEquals("Hextile and Raw decode the same screen", raw.client.framebuffer.pixels, hextile.client.framebuffer.pixels)
        assertArrayEquals("chunked ZRLE decodes the same screen", raw.client.framebuffer.pixels, trickle.client.framebuffer.pixels)
        val text = zrle.client.framebuffer.pixels.count { it == opaque(0x00FF00) }
        log("xterm visible: ${zrle.client.framebuffer.pixels.count { it == opaque(0x101010) }} background pixels, $text pure green pixels")
    }

    @Test
    fun `incremental updates and window moves keep the framebuffer equal to a fresh one`() {
        requireDisplay()
        x("xsetroot", "-solid", "#336699")
        startXterm(File(outDir, "typed-unused.txt"))
        val session = Session()
        resetScreen(session)
        await("the xterm to appear") { session.pixel(110, 110) == opaque(0x101010) }
        session.settle()
        val window = x("xdotool", "search", "--maxdepth", "1", "--class", "xterm").lines().last()

        // Typing and moving the window makes the server send small rectangles and CopyRect.
        session.client.sendPointer(300, 150, 0)
        session.type("incremental updates 0123456789")
        for ((wx, wy) in listOf(140 to 130, 200 to 260, 90 to 60, 260 to 200)) {
            x("xdotool", "windowmove", window, "$wx", "$wy")
            Thread.sleep(150)
        }
        session.settle()
        log("after typing and window moves, server used: ${session.seen()}")
        assertEquals("the window is at its last place", opaque(0x101010), session.pixel(460, 300))
        assertEquals("the window's old place shows the root again", opaque(0x336699), session.pixel(110, 110))

        val fresh = Session(encodings = intArrayOf(0))
        fresh.settle()
        session.settle()
        dump(session.client.framebuffer, "screen-after-moves.png")
        assertArrayEquals(
            "the incrementally updated framebuffer equals a fresh raw one",
            fresh.client.framebuffer.pixels,
            session.client.framebuffer.pixels,
        )
    }

    @Test
    fun `keys typed by the client reach an X application`() {
        requireDisplay()
        x("xsetroot", "-solid", "#336699")
        val lineFile = File(outDir, "typed.txt")
        startXterm(lineFile)
        val session = Session()
        resetScreen(session)
        await("the xterm to appear") { session.pixel(110, 110) == opaque(0x101010) }
        session.settle()
        val greenBefore = session.client.framebuffer.pixels.count { it and 0x00FF00 > 0x8000 && it and 0xFF00FF == 0 }

        // Without a window manager the window under the pointer has the keyboard focus.
        session.client.sendPointer(300, 150, 0)
        val text = "Hello, VNC_42! (café €) ~|{}"
        session.type(text)
        session.settle()
        val greenAfter = session.client.framebuffer.pixels.count { it and 0x00FF00 > 0x8000 && it and 0xFF00FF == 0 }
        dump(session.client.framebuffer, "screen-typed.png")
        assertTrue("typing drew green text: $greenBefore -> $greenAfter pixels", greenAfter > greenBefore + 200)

        session.client.sendKey(Keysyms.Return, true)
        session.client.sendKey(Keysyms.Return, false)
        await("the xterm's shell to save the line") { lineFile.exists() && lineFile.length() > 0 }
        assertEquals(text, lineFile.readText(Charsets.UTF_8))
        log("typed into xterm and read back: $text (green pixels $greenBefore -> $greenAfter)")
    }

    @Test
    fun `pointer moves, buttons and wheel reach X`() {
        requireDisplay()
        val session = Session()
        resetScreen(session)
        session.client.sendPointer(321, 123, 0)
        await("the pointer to move") { mouseLocation() == "x:321 y:123" }
        session.client.sendPointer(799, 599, 0)
        await("the pointer to move") { mouseLocation() == "x:799 y:599" }

        // xev on the root window prints every button press it gets.
        val xev = start("stdbuf", "-oL", "xev", "-root", "-event", "button")
        val presses = CopyOnWriteArrayList<String>()
        Thread {
            xev.inputStream.bufferedReader().useLines { lines ->
                var position: String? = null
                for (line in lines) {
                    if (line.startsWith("ButtonPress")) position = ""
                    if (line.startsWith("ButtonRelease")) position = null
                    if (position == null) continue
                    Regex("""\((\d+),(\d+)\), root:""").find(line)?.let { position = "${it.groupValues[1]},${it.groupValues[2]}" }
                    Regex("""button (\d+),""").find(line)?.let { presses += "button ${it.groupValues[1]} at $position" }
                }
            }
        }.apply { isDaemon = true }.start()
        Thread.sleep(700)
        session.click(50, 500, 1)
        session.click(60, 510, 2)
        session.click(70, 520, 4)
        session.click(80, 530, 8)
        session.click(80, 530, 16)
        session.click(80, 530, 32)
        session.click(80, 530, 64)
        await("xev to see seven presses, saw $presses") { presses.size >= 7 }
        assertEquals(
            listOf(
                "button 1 at 50,500", "button 2 at 60,510", "button 3 at 70,520",
                "button 4 at 80,530", "button 5 at 80,530", "button 6 at 80,530", "button 7 at 80,530",
            ),
            presses.toList(),
        )
        log("pointer: xdotool saw the moves, xev saw $presses")
    }

    @Test
    fun `requestDesktopSize resizes the real desktop, also when view only`() {
        requireDisplay()
        x("xsetroot", "-solid", "#336699")
        val session = Session()
        resetScreen(session)
        val observer = Session()
        session.settle()
        val before = session.client.framebuffer
        session.client.sendPointer(400, 300, 0)
        await("the pointer to move") { mouseLocation() == "x:400 y:300" }

        session.client.viewOnly = true
        session.client.sendPointer(10, 10, 0)
        session.click(20, 20, 1)
        assertTrue(session.client.requestDesktopSize(1024, 700))
        await("the resize") { session.events.contains("resize 1024x700") }
        val after = session.client.framebuffer
        assertEquals(1024, after.width)
        assertEquals(700, after.height)
        assertTrue(before !== after)
        assertEquals("1024 700", x("xdotool", "getdisplaygeometry"))
        assertEquals("view only: the pointer did not move", "x:400 y:300", mouseLocation())
        // The whole new framebuffer is sent again.
        await("the new area to be painted") { session.pixel(1020, 695) == opaque(0x336699) && session.pixel(5, 5) == opaque(0x336699) }
        session.settle()
        dump(session.client.framebuffer, "screen-1024x700.png")
        await("the other client to see the resize") { observer.events.contains("resize 1024x700") }
        log("resize to 1024x700: client events ${session.events}, X reports ${x("xdotool", "getdisplaygeometry")}, server used ${session.seen()}")

        assertTrue(session.client.requestDesktopSize(800, 600))
        await("the resize back") { session.events.contains("resize 800x600") }
        assertEquals("800 600", x("xdotool", "getdisplaygeometry"))
        await("the screen to be painted") { session.pixel(795, 595) == opaque(0x336699) }
        assertNull(session.events.firstOrNull { it.startsWith("disconnected") })
    }

    @Test
    fun `a request made right after connecting is sent once the server announces the extension`() {
        requireDisplay()
        val session = Session()
        resetScreen(session)
        val fresh = Session()
        // Nothing has been read yet, so this is queued or sent depending on timing; either way
        // the desktop must end up resized.
        fresh.client.requestDesktopSize(900, 650)
        await("the resize") { fresh.events.contains("resize 900x650") }
        assertEquals("900 650", x("xdotool", "getdisplaygeometry"))
        fresh.client.requestDesktopSize(800, 600)
        await("the resize back") { fresh.events.contains("resize 800x600") }
    }

    @Test
    fun `close disconnects cleanly`() {
        val session = Session()
        session.settle()
        session.client.close()
        await("the disconnect") { session.events.any { it.startsWith("disconnected") } }
        assertEquals("disconnected null", session.events.last())
        session.thread.join(5000)
        assertFalse(session.thread.isAlive)
        assertTrue(session.socket.isClosed)
    }
}
