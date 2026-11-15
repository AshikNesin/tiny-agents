package groot.mobile.feature.terminal

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import groot.mobile.AppContainer
import groot.mobile.data.api.ApiException
import groot.mobile.data.api.TerminalTab
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import tinyagents.terminal.TerminalEmulator
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** The attach to the open tab. */
enum class TerminalLink { Idle, Connecting, Live, Reconnecting, Ended }

data class TerminalState(
    /** "ready", "unconfigured", "unreachable" or "tmux-missing"; null until the first list arrives. */
    val status: String? = null,
    val message: String? = null,
    val installCommand: String? = null,
    val tabs: List<TerminalTab> = emptyList(),
    /** The open tab's name. */
    val active: String? = null,
    val link: TerminalLink = TerminalLink.Idle,
    val loadError: String? = null,
    /** Bumped after each batch of output, so the view redraws. */
    val version: Long = 0,
    /** A tab the server refused to close because something runs in it; closing again forces it. */
    val busyTab: String? = null,
    val busyProcess: String? = null,
)

/**
 * The Terminal screen: tmux tabs on the sandbox, one attached at a time. The server relays
 * raw pty bytes over a ticketed WebSocket (binary frames) with JSON control frames beside
 * them (resize, pause and resume, ping); the `:terminal` module turns the bytes into a screen.
 *
 * Close codes are the server's contract: 1000 the session ended or this client was detached
 * (stop, offer Reconnect), 4000 idle (reattach), anything else a drop (retry with backoff).
 */
class TerminalViewModel(private val container: AppContainer) : ViewModel() {
    private val api = container.api

    private val _state = MutableStateFlow(TerminalState())
    val state: StateFlow<TerminalState> = _state.asStateFlow()

    /** The open tab's screen. Fed and read on the main thread only. */
    var emulator: TerminalEmulator = TerminalEmulator(DEFAULT_COLS, DEFAULT_ROWS, reply = ::send)
        private set

    private var cols = DEFAULT_COLS
    private var rows = DEFAULT_ROWS
    private var attach: Job? = null
    private var socket: WebSocket? = null
    private var visible = false

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            try {
                val list = api.terminalTabs()
                _state.update { state ->
                    state.copy(
                        status = list.status,
                        message = list.message,
                        installCommand = list.installCommand,
                        tabs = list.tabs,
                        loadError = null,
                        active = state.active?.takeIf { name -> list.tabs.any { it.name == name } } ?: list.tabs.firstOrNull()?.name,
                    )
                }
                ensureAttached()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (_state.value.status == null) _state.update { it.copy(loadError = e.message ?: "Could not load.") }
            }
        }
    }

    /** The screen is visible: attach the open tab. */
    fun show() {
        visible = true
        ensureAttached()
    }

    /** Off screen: detach, so the server's idle timer can free the tab's attach. */
    fun hide() {
        visible = false
        detach()
    }

    override fun onCleared() = detach()

    fun select(name: String) {
        if (_state.value.active == name) return
        detach()
        _state.update { it.copy(active = name) }
        ensureAttached()
    }

    fun newTab() {
        viewModelScope.launch {
            try {
                val tab = api.createTerminalTab(cols, rows)
                detach()
                _state.update { it.copy(tabs = it.tabs + tab, active = tab.name) }
                ensureAttached()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                container.notices.showError(e, "Could not open a tab.")
                refresh()
            }
        }
    }

    /** Close a tab. The server refuses while something runs in it; the screen then asks before forcing. */
    fun closeTab(name: String, force: Boolean = false) {
        viewModelScope.launch {
            try {
                api.closeTerminalTab(name, force)
                _state.update { it.copy(busyTab = null, busyProcess = null) }
                if (_state.value.active == name) detach()
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (e.status == 409 && !force) {
                    _state.update { it.copy(busyTab = name, busyProcess = e.details?.optString("process")?.takeIf { p -> p.isNotBlank() }) }
                } else {
                    container.notices.showError(e, "Could not close the tab.")
                    refresh()
                }
            } catch (e: Exception) {
                container.notices.showError(e, "Could not close the tab.")
            }
        }
    }

    fun dismissBusy() = _state.update { it.copy(busyTab = null, busyProcess = null) }

    /** Reattach after the session ended or this client was detached. */
    fun reconnect() {
        detach()
        ensureAttached()
    }

    /** Keystrokes, as pty bytes. Dropped while the socket is not open. */
    fun send(bytes: ByteArray) {
        if (bytes.isNotEmpty()) socket?.send(bytes.toByteString())
    }

    /** The view's grid changed: resize the screen and tell tmux. */
    fun resize(newCols: Int, newRows: Int) {
        if (newCols == cols && newRows == rows) return
        cols = newCols
        rows = newRows
        emulator.resize(cols, rows)
        socket?.send(JSONObject().put("t", "resize").put("cols", cols).put("rows", rows).toString())
        _state.update { it.copy(version = emulator.version) }
    }

    private fun detach() {
        attach?.cancel()
        attach = null
        socket?.close(NORMAL_CLOSE, null)
        socket = null
        if (_state.value.link != TerminalLink.Idle) _state.update { it.copy(link = TerminalLink.Idle) }
    }

    private fun ensureAttached() {
        val name = _state.value.active ?: return
        if (!visible || attach != null || _state.value.status != "ready") return
        emulator = TerminalEmulator(cols, rows, reply = ::send)
        _state.update { it.copy(version = emulator.version, link = TerminalLink.Connecting) }
        attach = viewModelScope.launch { attachLoop(name) }
    }

    private suspend fun attachLoop(name: String) {
        var retryMs = FIRST_RETRY_MS
        while (viewModelScope.isActive) {
            val code = try {
                val path = api.terminalTicket(name)
                streamOnce("$path&cols=$cols&rows=$rows") { retryMs = FIRST_RETRY_MS }
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                // The tab is gone (404/409): stop for good; anything else is retried.
                if (e.status == 404 || e.status == 409) NORMAL_CLOSE else DROPPED
            } catch (_: Exception) {
                DROPPED
            }
            if (code == NORMAL_CLOSE) {
                _state.update { it.copy(link = TerminalLink.Ended) }
                attach = null
                refresh()
                return
            }
            _state.update { it.copy(link = TerminalLink.Reconnecting) }
            if (code != IDLE_CLOSE) {
                delay(retryMs)
                retryMs = (retryMs * 2).coerceAtMost(MAX_RETRY_MS)
            }
        }
    }

    /** One attach, until the socket closes; returns its close code ([DROPPED] for a failure). */
    private suspend fun streamOnce(path: String, onOpen: () -> Unit): Int {
        val frames = Channel<ByteArray>(Channel.UNLIMITED)
        val queued = AtomicLong(0)
        val closed = CompletableDeferred<Int>()
        // Written on OkHttp's reader thread, read on main.
        val lastPong = AtomicLong(System.nanoTime())
        val paused = AtomicBoolean(false)
        val webSocket = api.socket(
            path,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    onOpen()
                    _state.update { it.copy(link = TerminalLink.Live) }
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    // The renderer is behind: ask the server to stop reading the pty until it catches up.
                    if (queued.addAndGet(bytes.size.toLong()) > HIGH_WATERMARK && paused.compareAndSet(false, true)) {
                        webSocket.send("""{"t":"pause"}""")
                    }
                    frames.trySend(bytes.toByteArray())
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (text.contains("pong")) lastPong.set(System.nanoTime())
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(NORMAL_CLOSE, null)
                    closed.complete(code)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    closed.complete(code)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    closed.complete(DROPPED)
                }
            },
        )
        socket = webSocket
        // Output is parsed here, on the main thread, where the view also reads the screen.
        val pump = viewModelScope.launch {
            for (first in frames) {
                var frame: ByteArray? = first
                var budget = FEED_BATCH_BYTES
                while (frame != null) {
                    emulator.feed(frame)
                    budget -= frame.size
                    if (queued.addAndGet(-frame.size.toLong()) < LOW_WATERMARK && paused.compareAndSet(true, false)) {
                        webSocket.send("""{"t":"resume"}""")
                    }
                    frame = if (budget > 0) frames.tryReceive().getOrNull() else null
                }
                _state.update { it.copy(version = emulator.version) }
            }
        }
        // A ping keeps the server's idle timer off a tab someone is looking at, and its pong shows the socket is alive.
        val heartbeat = viewModelScope.launch {
            while (true) {
                delay(PING_INTERVAL_MS)
                val sentAt = System.nanoTime()
                webSocket.send("""{"t":"ping"}""")
                delay(PONG_TIMEOUT_MS)
                if (lastPong.get() < sentAt) {
                    webSocket.cancel()
                    closed.complete(DROPPED)
                }
            }
        }
        try {
            return closed.await()
        } finally {
            heartbeat.cancel()
            pump.cancel()
            frames.close()
            if (socket === webSocket) socket = null
            webSocket.cancel()
        }
    }

    private companion object {
        const val DEFAULT_COLS = 80
        const val DEFAULT_ROWS = 24
        const val NORMAL_CLOSE = 1000
        const val IDLE_CLOSE = 4000
        const val DROPPED = -1
        const val FIRST_RETRY_MS = 1_000L
        const val MAX_RETRY_MS = 10_000L
        const val HIGH_WATERMARK = 512L * 1024
        const val LOW_WATERMARK = 64L * 1024
        const val FEED_BATCH_BYTES = 64 * 1024
        const val PING_INTERVAL_MS = 20_000L
        const val PONG_TIMEOUT_MS = 8_000L
    }
}
