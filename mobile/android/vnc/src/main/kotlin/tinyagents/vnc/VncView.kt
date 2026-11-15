package tinyagents.vnc

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculateCentroidSize
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.pointer.AwaitPointerEventScope
import androidx.compose.ui.input.pointer.PointerEvent
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.IntOffset
import kotlinx.coroutines.delay
import kotlin.math.abs

/**
 * Shows the remote screen of [state], scaled to fit and centred, and turns touches into remote
 * pointer events:
 *
 * - tap: left click; two quick taps on one spot: double click at the first tap's position
 * - long press: right click
 * - one-finger drag: drag with the left button held
 * - two-finger drag: mouse wheel, in the direction touch scrolling moves content
 * - pinch: local zoom, 1x to 4x; while zoomed, a two-finger drag pans the view instead
 *
 * With [interactive] false nothing is sent to the remote side: pinch still zooms, and dragging
 * with one or two fingers pans. [interactive] only covers this view's own touches and keys; set
 * [RfbClient.viewOnly] as well to stop everything else.
 *
 * Hardware keys are forwarded while the view has focus. It is focusable but never takes focus by
 * itself, so that tapping the remote screen does not close a soft keyboard the app opened; pass
 * a `focusRequester` in [modifier] to focus it.
 *
 * [onViewSize] reports the view's size in pixels 150 ms after it last changed, and again when
 * [state] gets a new client. A browser view passes it on to [RfbClient.requestDesktopSize],
 * divided by its remote pixel density; a fixed-size desktop leaves it null.
 */
@Composable
public fun VncView(
    state: VncViewState,
    interactive: Boolean,
    modifier: Modifier = Modifier,
    onViewSize: ((widthPx: Int, heightPx: Int) -> Unit)? = null,
    background: Color = MaterialTheme.colorScheme.surfaceContainerLowest,
) {
    val isInteractive by rememberUpdatedState(interactive)
    val reportViewSize by rememberUpdatedState(onViewSize)
    val haptics = LocalHapticFeedback.current

    val viewSize = state.viewSize
    LaunchedEffect(viewSize, state.client, onViewSize != null) {
        if (viewSize.width > 0 && viewSize.height > 0 && reportViewSize != null) {
            delay(VIEW_SIZE_DEBOUNCE_MILLIS)
            reportViewSize?.invoke(viewSize.width, viewSize.height)
        }
    }

    Canvas(
        modifier = modifier
            .clipToBounds()
            .background(background)
            .onSizeChanged(state::onViewSizeChanged)
            .onKeyEvent { isInteractive && state.onKeyEvent(it) }
            .focusable()
            .pointerInput(state) {
                detectVncGestures(
                    state = state,
                    interactive = { isInteractive },
                    onLongPress = { haptics.performHapticFeedback(HapticFeedbackType.LongPress) },
                )
            },
    ) {
        // Reading the frame counter redraws on every framebuffer change.
        state.frame
        val image = state.image ?: return@Canvas
        val factor = state.scale()
        if (factor <= 0f) return@Canvas
        val origin = state.imageOrigin()
        translate(origin.x, origin.y) {
            scale(factor, factor, pivot = Offset.Zero) {
                drawImage(image, filterQuality = FilterQuality.Medium)
            }
        }
    }
}

private const val VIEW_SIZE_DEBOUNCE_MILLIS = 150L

/** RFB pointer button bits. */
private const val BUTTON_LEFT = 1
private const val BUTTON_RIGHT = 4
private const val WHEEL_UP = 8
private const val WHEEL_DOWN = 16
private const val WHEEL_LEFT = 32
private const val WHEEL_RIGHT = 64

/** Finger travel per wheel step, in touch slops (a slop is about 8dp). */
private const val WHEEL_STEP_SLOPS = 2f

private enum class Phase { Tap, LongPress, Drag, Multi, Done }

private enum class MultiMode { Undecided, Zoom, Pan, Scroll }

private suspend fun PointerInputScope.detectVncGestures(
    state: VncViewState,
    interactive: () -> Boolean,
    onLongPress: () -> Unit,
) {
    val slop = viewConfiguration.touchSlop
    val doubleTapRadius = viewConfiguration.minimumTouchTargetSize.toSize().minDimension
    var lastTapTime: Long? = null
    var lastTapPosition = Offset.Zero
    var lastTapRemote = IntOffset.Zero

    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        down.consume()
        val canSend = interactive()
        val start = down.position
        val startRemote = if (canSend) state.toRemote(start) else null

        // What the first finger does: a long press only exists where it would click.
        var current = start
        var phase = if (startRemote != null) {
            withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                awaitFirstMove(down.id, start, slop) { current = it }
            } ?: Phase.LongPress
        } else {
            awaitFirstMove(down.id, start, slop) { current = it }
        }

        when (phase) {
            Phase.Tap -> if (startRemote != null) {
                val time = down.uptimeMillis
                val repeats = lastTapTime?.let { time - it <= viewConfiguration.doubleTapTimeoutMillis } == true &&
                    (start - lastTapPosition).getDistance() <= doubleTapRadius
                // A double tap never lands twice on one pixel; the remote double click has to.
                val target = if (repeats) lastTapRemote else startRemote
                state.click(target, BUTTON_LEFT)
                lastTapTime = time
                lastTapPosition = start
                lastTapRemote = target
            }
            Phase.LongPress -> if (startRemote != null) {
                onLongPress()
                state.click(startRemote, BUTTON_RIGHT)
            }
            else -> Unit
        }

        if (phase == Phase.Drag) {
            phase = if (canSend) remoteDrag(state, down.id, startRemote, current) else localPan(state, down.id)
        }
        if (phase == Phase.Multi) twoFingers(state, canSend, slop)
        awaitAllUp()
    }
}

/** Waits until the finger [id] lifts, moves beyond [slop], or a second finger lands. */
private suspend fun AwaitPointerEventScope.awaitFirstMove(
    id: PointerId,
    start: Offset,
    slop: Float,
    onPosition: (Offset) -> Unit,
): Phase {
    while (true) {
        val event = awaitConsumed()
        if (event.pressedCount() >= 2) return Phase.Multi
        val change = event.changes.firstOrNull { it.id == id } ?: return Phase.Done
        onPosition(change.position)
        if (!change.pressed) return Phase.Tap
        if ((change.position - start).getDistance() > slop) return Phase.Drag
    }
}

/**
 * A one-finger drag as a left-button drag: pressed where the finger landed, released where it
 * lifts, or where it is when a second finger turns the gesture into a two-finger one.
 */
private suspend fun AwaitPointerEventScope.remoteDrag(
    state: VncViewState,
    id: PointerId,
    startRemote: IntOffset?,
    current: Offset,
): Phase {
    // A drag that started outside the remote screen sends nothing.
    var last = startRemote ?: return awaitLiftOrSecondFinger(id)
    state.pointer(last, 0)
    state.pointer(last, BUTTON_LEFT)
    try {
        state.toRemoteClamped(current)?.let { last = it }
        state.pointer(last, BUTTON_LEFT)
        while (true) {
            val event = awaitConsumed()
            if (event.pressedCount() >= 2) return Phase.Multi
            val change = event.changes.firstOrNull { it.id == id } ?: return Phase.Done
            state.toRemoteClamped(change.position)?.let { last = it }
            if (!change.pressed) return Phase.Done
            state.pointer(last, BUTTON_LEFT)
        }
    } finally {
        // Also runs when the gesture is cancelled, so the remote button never stays down.
        state.pointer(last, 0)
    }
}

private suspend fun AwaitPointerEventScope.awaitLiftOrSecondFinger(id: PointerId): Phase {
    while (true) {
        val event = awaitConsumed()
        if (event.pressedCount() >= 2) return Phase.Multi
        if (event.changes.none { it.id == id && it.pressed }) return Phase.Done
    }
}

/** View only: one finger pans the zoomed view. */
private suspend fun AwaitPointerEventScope.localPan(state: VncViewState, id: PointerId): Phase {
    while (true) {
        val event = awaitConsumed()
        if (event.pressedCount() >= 2) return Phase.Multi
        val change = event.changes.firstOrNull { it.id == id } ?: return Phase.Done
        if (!change.pressed) return Phase.Done
        state.transformBy(change.position, change.position - change.previousPosition, 1f)
    }
}

/**
 * Two fingers, until they lift. Spreading them zooms. Moving them together scrolls the remote
 * side, or pans the view when it is zoomed in or nothing may be sent.
 */
private suspend fun AwaitPointerEventScope.twoFingers(state: VncViewState, canSend: Boolean, slop: Float) {
    var mode = MultiMode.Undecided
    var zoomSoFar = 1f
    var panSoFar = Offset.Zero
    var wheelAt: IntOffset? = null
    var wheelVertical = true
    var wheelTravel = 0f
    val wheelStep = slop * WHEEL_STEP_SLOPS

    while (true) {
        val event = awaitConsumed()
        val pressed = event.pressedCount()
        if (pressed == 0) return
        if (pressed < 2) continue
        val centroid = event.calculateCentroid(useCurrent = true)
        if (!centroid.isSpecified) continue
        val pan = event.calculatePan()
        val zoom = event.calculateZoom()
        zoomSoFar *= zoom
        panSoFar += pan
        val spread = abs(1 - zoomSoFar) * event.calculateCentroidSize(useCurrent = false)

        if (mode == MultiMode.Undecided) {
            if (spread > slop) {
                mode = MultiMode.Zoom
            } else if (panSoFar.getDistance() > slop) {
                if (!canSend || state.zoom > VncViewState.MIN_ZOOM) {
                    mode = MultiMode.Pan
                } else {
                    mode = MultiMode.Scroll
                    wheelAt = state.toRemote(centroid - panSoFar)
                    wheelVertical = abs(panSoFar.y) >= abs(panSoFar.x)
                    // The travel that decided the mode counts, the step it just received does not twice.
                    wheelTravel = (if (wheelVertical) panSoFar.y - pan.y else panSoFar.x - pan.x)
                }
            }
        } else if (mode == MultiMode.Pan && spread > slop) {
            mode = MultiMode.Zoom
        }

        when (mode) {
            MultiMode.Undecided -> Unit
            MultiMode.Zoom -> state.transformBy(centroid, pan, zoom)
            MultiMode.Pan -> state.transformBy(centroid, pan, 1f)
            MultiMode.Scroll -> {
                val at = wheelAt ?: continue
                wheelTravel += if (wheelVertical) pan.y else pan.x
                while (abs(wheelTravel) >= wheelStep) {
                    // Content follows the fingers: moving them down or right scrolls up or left.
                    val forward = wheelTravel > 0
                    val button = if (wheelVertical) {
                        if (forward) WHEEL_UP else WHEEL_DOWN
                    } else {
                        if (forward) WHEEL_LEFT else WHEEL_RIGHT
                    }
                    state.pointer(at, button)
                    state.pointer(at, 0)
                    wheelTravel -= if (forward) wheelStep else -wheelStep
                }
            }
        }
    }
}

private suspend fun AwaitPointerEventScope.awaitAllUp() {
    while (currentEvent.changes.any { it.pressed }) awaitConsumed()
}

private suspend fun AwaitPointerEventScope.awaitConsumed(): PointerEvent {
    val event = awaitPointerEvent()
    event.changes.forEach { it.consume() }
    return event
}

private fun PointerEvent.pressedCount(): Int = changes.count { it.pressed }
