package groot.mobile.feature.live

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import groot.mobile.AppContainer
import groot.mobile.data.api.ApiException
import groot.mobile.data.api.DesktopApp
import groot.mobile.data.api.LiveStatus
import groot.mobile.data.api.VncTicket
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import tinyagents.vnc.ByteQueueInputStream
import tinyagents.vnc.RfbListener
import tinyagents.vnc.VncViewState
import java.io.OutputStream
import kotlin.concurrent.thread
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

/** Which browser or desktop a live view shows: a bot's, or a profile's from the Browser or Computer page. */
data class LiveTarget(
    /** "browser" or "computer". */
    val surface: String,
    val botId: String? = null,
    val profile: String? = null,
) {
    val isBrowser: Boolean get() = surface == "browser"
}

/** The viewer's connection to the remote screen. */
enum class LiveLink { Idle, Connecting, Live, Reconnecting }

data class LiveState(
    /** Null until the first poll answers. */
    val status: LiveStatus? = null,
    val link: LiveLink = LiveLink.Idle,
    /** The first poll failed: nothing to show yet. */
    val loadError: String? = null,
    /** A guest watches only: no taking control, no starting, no reset. */
    val guest: Boolean = false,
    val apps: List<DesktopApp>? = null,
) {
    val driving: Boolean get() = status?.driver == "human"
}

/** Chrome will not draw a window narrower than this many CSS pixels; a phone gets one this wide, scaled down. */
private const val MIN_REMOTE_WIDTH = 500.0

/** The remote window for a viewer box, in CSS pixels (the web client's lib/remote-window.ts). */
internal fun remoteWindowSize(width: Double, height: Double): Pair<Double, Double> =
    if (!(width > 0 && height > 0) || width >= MIN_REMOTE_WIDTH) width to height else MIN_REMOTE_WIDTH to height * (MIN_REMOTE_WIDTH / width)

/**
 * One live view: polls the browser's or desktop's status, keeps a viewer connected while
 * there is a picture to stream, and carries the owner's actions (open, take control, hand
 * back, reset). The server relays raw RFB over a ticketed WebSocket; the `:vnc` module
 * speaks it.
 */
class LiveViewModel(private val container: AppContainer, val target: LiveTarget) : ViewModel() {
    private val api = container.api
    val vnc = VncViewState()

    private val _state = MutableStateFlow(LiveState(guest = container.bots.state.value.guest))
    val state: StateFlow<LiveState> = _state.asStateFlow()

    private var watching: Job? = null
    private var socket: WebSocket? = null
    private var pendingResize: Job? = null

    /** The screen is visible: poll, and stream while there is something to stream. */
    fun show() {
        if (watching != null) return
        watching = viewModelScope.launch {
            launch { poll() }
            connectLoop()
        }
    }

    /** Off screen: stop polling and drop the viewer (the server caps viewers, and idles a desktop nobody watches). */
    fun hide() {
        watching?.cancel()
        watching = null
        closeSocket()
        _state.update { it.copy(link = LiveLink.Idle) }
    }

    override fun onCleared() = hide()

    private suspend fun fetchStatus(): LiveStatus = when {
        target.botId != null -> api.botLiveStatus(target.botId, target.surface)
        else -> {
            val list = api.liveProfiles(target.surface)
            val row = list.profiles.firstOrNull { it.profile == target.profile }
            (row?.status ?: LiveStatus.from(org.json.JSONObject())).copy(
                configured = list.available,
                setupHint = list.setupHint,
                width = list.width,
                height = list.height,
            )
        }
    }

    private suspend fun poll() {
        while (true) {
            try {
                val status = fetchStatus()
                _state.update { it.copy(status = status, loadError = null) }
                vnc.client?.viewOnly = status.driver != "human" || _state.value.guest
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (_state.value.status == null) _state.update { it.copy(loadError = e.message ?: "Could not load.") }
            }
            delay(if (_state.value.status?.starting == true) POLL_STARTING_MS else POLL_MS)
        }
    }

    private suspend fun ticket(): VncTicket =
        if (target.botId != null) api.botLiveTicket(target.botId, target.surface) else api.profileTicket(target.surface, target.profile.orEmpty())

    private suspend fun connectLoop() {
        var retryMs = FIRST_RETRY_MS
        var connectedOnce = false
        while (viewModelScope.isActive) {
            // Wait until there is a picture: the session is up and not headless.
            state.first { it.status?.viewable == true }
            _state.update { it.copy(link = if (connectedOnce) LiveLink.Reconnecting else LiveLink.Connecting) }
            try {
                val ticket = ticket()
                val live = stream(ticket)
                if (live) {
                    connectedOnce = true
                    retryMs = FIRST_RETRY_MS
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                // 404 or 409: it closed, or is headless; the poll says which, and the wait above holds until it is back.
                if (e.status == 404 || e.status == 409) _state.update { it.copy(status = it.status?.copy(active = false)) }
            } catch (_: Exception) {
                // Unreachable for now: retry below.
            }
            _state.update { it.copy(link = LiveLink.Reconnecting) }
            delay(retryMs)
            retryMs = (retryMs * 2).coerceAtMost(MAX_RETRY_MS)
        }
    }

    /** Run one viewer connection until it ends; true when it got as far as a picture. */
    private suspend fun stream(ticket: VncTicket): Boolean {
        val input = ByteQueueInputStream()
        val ended = CompletableDeferred<Unit>()
        var wentLive = false
        val webSocket = api.socket(
            ticket.path,
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, bytes: ByteString) = input.offer(bytes.toByteArray())
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(NORMAL_CLOSE, null)
                    input.endOfStream()
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = input.endOfStream()
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = input.endOfStream()
            },
        )
        socket = webSocket
        // Before the client exists: the view reports its size for the new client before the handshake ends.
        scale = ticket.scale
        // The client writes one whole RFB message per call; each becomes one binary frame. send() only enqueues.
        val output = object : OutputStream() {
            override fun write(b: Int) {
                webSocket.send(byteArrayOf(b.toByte()).toByteString())
            }

            override fun write(b: ByteArray, off: Int, len: Int) {
                webSocket.send(b.toByteString(off, len))
            }
        }
        val client = vnc.createClient(
            input,
            output,
            object : RfbListener {
                override fun onConnected(width: Int, height: Int, name: String) {
                    wentLive = true
                    _state.update { it.copy(link = LiveLink.Live) }
                }

                override fun onFramebufferUpdate(x: Int, y: Int, width: Int, height: Int) = Unit
                override fun onResize(width: Int, height: Int) = Unit
                override fun onDisconnected(reason: String?) {
                    ended.complete(Unit)
                }
            },
        )
        client.viewOnly = !_state.value.driving || _state.value.guest
        thread(name = "vnc-${target.surface}", isDaemon = true) { client.run() }
        try {
            ended.await()
        } finally {
            client.close()
            input.close()
            webSocket.cancel()
            if (socket === webSocket) socket = null
        }
        return wentLive
    }

    private fun closeSocket() {
        vnc.client?.close()
        socket?.cancel()
        socket = null
    }

    /** The remote pixel density the last ticket reported. */
    private var scale = 1.0

    /**
     * The viewer's box changed (browser only): fit the remote display and the Chrome window in
     * it to the box. The display is asked over RFB; the window, in CSS pixels, over the API.
     */
    fun onViewSize(widthPx: Int, heightPx: Int, density: Float) {
        if (!target.isBrowser || widthPx <= 0 || heightPx <= 0 || _state.value.guest) return
        val (width, height) = remoteWindowSize(widthPx / density.toDouble(), heightPx / density.toDouble())
        vnc.client?.requestDesktopSize(floor(width * scale).toInt(), floor(height * scale).toInt())
        pendingResize?.cancel()
        pendingResize = viewModelScope.launch {
            val w = max(MIN_WINDOW_WIDTH, width.roundToInt())
            val h = max(MIN_WINDOW_HEIGHT, height.roundToInt())
            try {
                if (target.botId != null) api.botLiveResize(target.botId, w, h) else api.profileResize(target.profile.orEmpty(), w, h)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // The picture still scales to fit; the next size change tries again.
            }
        }
    }

    fun start() = act("Could not open it.") {
        _state.update { it.copy(status = it.status?.copy(starting = true, error = null)) }
        if (target.botId != null) api.botLiveStart(target.botId, target.surface) else api.profileStart(target.surface, target.profile.orEmpty())
    }

    /** Take control (the bots on it pause) or hand it back (which also answers a bot's takeover request). */
    fun setDriver(human: Boolean) = act(if (human) "Could not take control." else "Could not hand it back.") {
        if (target.botId != null) api.botLiveDriver(target.botId, target.surface, human) else api.profileDriver(target.surface, target.profile.orEmpty(), human)
        _state.update { it.copy(status = it.status?.copy(driver = if (human) "human" else "agent", takeover = if (human) it.status.takeover else null)) }
        vnc.client?.viewOnly = !human
    }

    fun reset() = act("Could not reset it.") {
        if (target.botId != null) api.botLiveReset(target.botId, target.surface) else api.profileReset(target.surface, target.profile.orEmpty())
        _state.update { it.copy(status = it.status?.copy(active = false, driver = null)) }
        container.notices.show(if (target.isBrowser) "The browser was reset" else "The computer was reset")
    }

    /** The desktop profile behind this view, for the apps routes (which are by profile only). */
    private suspend fun desktopProfile(): String =
        target.profile ?: if (api.bot(target.botId.orEmpty()).browserProfile == "own") "bot-${target.botId}" else "shared"

    fun loadApps() = act("Could not list the apps.") {
        val apps = api.desktopApps(desktopProfile())
        _state.update { it.copy(apps = apps) }
    }

    fun openApp(app: DesktopApp) = act("Could not open ${app.name}.") { api.openDesktopApp(desktopProfile(), app.id) }

    private fun act(failure: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                container.notices.showError(e, failure)
            }
        }
    }

    private companion object {
        const val POLL_STARTING_MS = 1_500L
        const val POLL_MS = 3_000L
        const val FIRST_RETRY_MS = 1_000L
        const val MAX_RETRY_MS = 10_000L
        const val NORMAL_CLOSE = 1000
        const val MIN_WINDOW_WIDTH = 320
        const val MIN_WINDOW_HEIGHT = 240
    }
}
