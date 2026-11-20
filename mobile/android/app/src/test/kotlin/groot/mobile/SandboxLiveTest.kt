package groot.mobile

import android.graphics.Bitmap
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.api.BotDraft
import groot.mobile.feature.live.LiveLink
import groot.mobile.feature.live.LiveState
import groot.mobile.feature.live.LiveTarget
import groot.mobile.feature.live.LiveViewModel
import groot.mobile.feature.terminal.TerminalLink
import groot.mobile.feature.terminal.TerminalState
import groot.mobile.feature.terminal.TerminalViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.newSingleThreadContext
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.GraphicsMode
import tinyagents.vnc.Keysyms
import java.io.File
import java.io.FileOutputStream

@OptIn(ExperimentalCoroutinesApi::class, kotlinx.coroutines.DelicateCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36])
class SandboxLiveTest {
    private val url: String? = System.getenv("TINY_AGENTS_URL")
    private val sandbox = System.getenv("TINY_AGENTS_SANDBOX") == "1"
    private val main = newSingleThreadContext("test-main")
    private lateinit var container: AppContainer
    private val stamp = System.nanoTime().toString(36)
    private val bots = mutableListOf<String>()

    @Before
    fun signIn() {
        assumeTrue("TINY_AGENTS_URL and TINY_AGENTS_SANDBOX=1 are not set", url != null && sandbox)
        Dispatchers.setMain(main)
        container = ApplicationProvider.getApplicationContext<GrootMobileApp>().container
        runBlocking {
            container.session.setServer(url!!)
            val signIn = container.api.login("demo@example.com", "demo@example.com")
            container.session.signedIn(signIn.token, signIn.user)
        }
    }

    @After
    fun cleanUp() {
        if (url == null || !sandbox) return
        runBlocking { for (id in bots) runCatching { container.api.deleteBot(id) } }
        Dispatchers.resetMain()
        main.close()
    }

    private suspend fun newBot(): String {
        val models = container.api.models()
        val bot = container.api.createBot(BotDraft(name = "Live $stamp", modelId = models.defaultModelId ?: models.models.first().id, browserProfile = "own"))
        bots.add(bot.id)
        return bot.id
    }

    private suspend fun TerminalViewModel.await(timeoutMs: Long = 60_000, until: (TerminalState) -> Boolean): TerminalState =
        withTimeout(timeoutMs) { state.first(until) }

    private suspend fun LiveViewModel.await(timeoutMs: Long, until: (LiveState) -> Boolean): LiveState =
        withTimeout(timeoutMs) { state.first(until) }

    private suspend fun TerminalViewModel.screen(): List<String> = withContext(main) {
        (0 until emulator.rows).map { emulator.line(it).text().trimEnd() }
    }

    private suspend fun TerminalViewModel.awaitScreen(timeoutMs: Long = 30_000, until: (List<String>) -> Boolean): List<String> {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (true) {
            val lines = screen()
            if (until(lines)) return lines
            if (System.currentTimeMillis() > deadline) throw AssertionError("The screen never matched. It shows:\n" + lines.joinToString("\n") { "|$it" })
            delay(200)
        }
    }

    private suspend fun awaitVnc(timeoutMs: Long, done: () -> Boolean) = withTimeout(timeoutMs) {
        while (true) {
            shadowOf(Looper.getMainLooper()).idle()
            if (done()) break
            delay(200)
        }
    }

    private suspend fun settle(ms: Long) {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            shadowOf(Looper.getMainLooper()).idle()
            delay(200)
        }
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun save(bitmap: Bitmap, name: String) {
        val dir = File("build/outputs/sandbox-live").apply { mkdirs() }
        FileOutputStream(File(dir, "$name.png")).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test
    fun `a terminal tab is opened, typed into, resized and closed`() = runBlocking {
        val terminal = withContext(main) { TerminalViewModel(container) }
        withContext(main) { terminal.show() }
        assertEquals("ready", terminal.await { it.status != null }.status)

        val before = terminal.state.value.tabs.map { it.name }.toSet()
        withContext(main) { terminal.newTab() }
        val tab = terminal.await { it.link == TerminalLink.Live && it.active != null && it.active !in before }.active!!

        terminal.awaitScreen { screen -> screen.any { it.endsWith("$") } }
        withContext(main) { terminal.send("echo sum-\$((40+2))-$stamp\r".toByteArray()) }
        val lines = terminal.awaitScreen { screen -> screen.any { it == "sum-42-$stamp" } }
        assertTrue("the prompt came back after the command", lines.last { it.isNotBlank() }.contains("$"))

        withContext(main) { terminal.resize(100, 30) }
        withContext(main) { terminal.send("clear; tput cols; tput lines\r".toByteArray()) }
        terminal.awaitScreen { screen -> screen.contains("100") && screen.contains("30") }

        withContext(main) { terminal.send("sleep 300\r".toByteArray()) }
        delay(1_000)
        withContext(main) { terminal.closeTab(tab) }
        assertEquals(tab, terminal.await { it.busyTab != null }.busyTab)
        withContext(main) { terminal.closeTab(tab, force = true) }
        terminal.await { state -> state.tabs.none { it.name == tab } }
        withContext(main) { terminal.hide() }
    }

    @Test
    fun `a bot's browser is opened, streamed, fitted to the phone and driven by touch and keys`() = runBlocking {
        val botId = newBot()
        val live = withContext(main) { LiveViewModel(container, LiveTarget("browser", botId = botId)) }
        withContext(main) { live.show() }
        live.await(30_000) { it.status != null }
        withContext(main) { live.start() }
        val opened = live.await(900_000) { it.status?.active == true && it.link == LiveLink.Live }
        assertEquals("vnc", opened.status?.mode)

        withContext(main) { live.onViewSize(1236, 2000, 3f) }
        val scale = opened.status?.scale ?: 1.0
        val wantWidth = (500 * scale).toInt()
        awaitVnc(30_000) { live.vnc.remoteSize.width == wantWidth }
        assertEquals((500.0 / 412 * (2000 / 3.0) * scale).toInt(), live.vnc.remoteSize.height)

        withContext(main) { live.setDriver(true) }
        live.await(10_000) { it.driving }
        live.vnc.sendChord(Keysyms.Control_L, 'l'.code)
        delay(500)
        live.vnc.sendText("example.com/?phone=$stamp\n")
        withTimeout(60_000) {
            while (container.api.botLiveStatus(botId, "browser").url?.contains("phone=$stamp") != true) delay(500)
        }
        settle(2_000)
        save(live.vnc.bitmap!!, "browser")
        val pixels = IntArray(live.vnc.remoteSize.width * live.vnc.remoteSize.height)
        live.vnc.bitmap!!.getPixels(pixels, 0, live.vnc.remoteSize.width, 0, 0, live.vnc.remoteSize.width, live.vnc.remoteSize.height)
        assertTrue("the picture is a real screen, not one flat colour", pixels.toSet().size > 16)

        withContext(main) { live.setDriver(false) }
        live.await(10_000) { !it.driving }
        withContext(main) { live.reset() }
        live.await(60_000) { it.status?.active == false }
        withContext(main) { live.hide() }
    }

    @Test
    fun `a bot's computer is opened and streamed`() = runBlocking {
        val botId = newBot()
        val live = withContext(main) { LiveViewModel(container, LiveTarget("computer", botId = botId)) }
        withContext(main) { live.show() }
        val first = live.await(30_000) { it.status != null }
        assertTrue(first.status!!.configured)
        withContext(main) { live.start() }
        val opened = live.await(1_500_000) { (it.status?.active == true && it.link == LiveLink.Live) || (it.status?.starting == false && it.status.error != null) }
        assertEquals("the desktop opened: ${opened.status?.error}", true, opened.status?.active)
        awaitVnc(30_000) { live.vnc.remoteSize.width != 0 }
        assertEquals(opened.status?.width, live.vnc.remoteSize.width)
        settle(5_000)
        save(live.vnc.bitmap!!, "computer")
        withContext(main) { live.setDriver(true) }
        live.await(10_000) { it.driving }
        withContext(main) { live.loadApps() }
        assertTrue(live.await(30_000) { it.apps != null }.apps!!.isNotEmpty())
        withContext(main) { live.setDriver(false) }
        withContext(main) { live.hide() }
    }
}
