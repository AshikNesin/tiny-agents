package groot.mobile.feature.live

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.PipCorner
import groot.mobile.data.PipTarget
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.StatusDot
import kotlinx.coroutines.launch
import tinyagents.vnc.VncView
import kotlin.math.min
import kotlin.math.roundToInt

private const val DEFAULT_ASPECT = 1.6f
private const val MIN_ASPECT = 0.5f
private const val MAX_ASPECT = 16f / 9f

internal fun pipAspect(width: Int, height: Int): Float =
    if (width <= 0 || height <= 0) DEFAULT_ASPECT else (width.toFloat() / height).coerceIn(MIN_ASPECT, MAX_ASPECT)

internal fun pipWidth(maxWidth: Float, maxStreamHeight: Float, available: Float, aspect: Float): Float =
    min(min(maxWidth, available), maxStreamHeight * aspect)

internal fun nearestCorner(centerX: Float, centerY: Float, areaWidth: Float, areaHeight: Float): PipCorner {
    val top = centerY < areaHeight / 2
    val start = centerX < areaWidth / 2
    return PipCorner.entries.first { it.top == top && it.start == start }
}

@Composable
fun LivePipWindow(
    container: AppContainer,
    target: PipTarget,
    onExpand: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: LiveViewModel = viewModel(
        key = "live-pip:${target.surface}:${target.botId}",
        factory = viewModelFactory { initializer { LiveViewModel(container, LiveTarget(target.surface, botId = target.botId)) } },
    )
    LifecycleStartEffect(viewModel) {
        viewModel.show()
        onStopOrDispose { viewModel.hide() }
    }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val saved by container.appPreferences.pipCorner.collectAsStateWithLifecycle(PipCorner.TopEnd)
    var dropped by remember { mutableStateOf<PipCorner?>(null) }
    val corner = dropped ?: saved
    var drag by remember { mutableStateOf(Offset.Zero) }
    var heightPx by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val remote = viewModel.vnc.remoteSize
    val aspect = pipAspect(remote.width, remote.height)
    val title = if (target.surface == "browser") "Browser" else "Computer"

    BoxWithConstraints(modifier.fillMaxSize()) {
        val areaWidth = constraints.maxWidth.toFloat()
        val areaHeight = constraints.maxHeight.toFloat()
        val widthPx = with(density) { pipWidth(Dims.pipMaxWidth.toPx(), Dims.pipMaxStreamHeight.toPx(), areaWidth, aspect) }
        val baseX = if (corner.start) 0f else areaWidth - widthPx
        val baseY = if (corner.top) 0f else areaHeight - heightPx

        Column(
            Modifier
                .offset { IntOffset((baseX + drag.x).roundToInt(), (baseY + drag.y).roundToInt()) }
                .width(with(density) { widthPx.toDp() })
                .onSizeChanged { heightPx = it.height }
                .shadow(Dims.pipElevation, MaterialTheme.shapes.medium)
                .clip(MaterialTheme.shapes.medium)
                .background(MaterialTheme.colorScheme.surfaceContainer),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .pointerInput(baseX, baseY, widthPx, heightPx, areaWidth, areaHeight) {
                        detectDragGestures(
                            onDragEnd = {
                                val next = nearestCorner(baseX + drag.x + widthPx / 2, baseY + drag.y + heightPx / 2f, areaWidth, areaHeight)
                                dropped = next
                                drag = Offset.Zero
                                container.scope.launch { container.appPreferences.setPipCorner(next) }
                            },
                            onDragCancel = { drag = Offset.Zero },
                        ) { change, amount ->
                            change.consume()
                            drag += amount
                        }
                    }
                    .padding(start = S.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                StatusDot(if (state.link == LiveLink.Live) Accents.success else Accents.warning)
                Text(
                    title,
                    style = MaterialTheme.typography.labelMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(start = S.sm),
                )
                IconBtn(AppIcons.Maximize, "Expand the $title", onClick = onExpand, iconSize = Dims.iconSmall)
                IconBtn(AppIcons.Close, "Close the picture in picture", onClick = onClose, iconSize = Dims.iconSmall)
            }
            Box(Modifier.fillMaxWidth().aspectRatio(aspect).background(MaterialTheme.colorScheme.surfaceContainerLowest)) {
                if (state.status?.viewable == true) {
                    VncView(state = viewModel.vnc, interactive = false, modifier = Modifier.fillMaxSize())
                }
                if (state.link != LiveLink.Live) {
                    Text(
                        linkLabel(state.status, state.link),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.align(Alignment.Center),
                    )
                }
                Box(Modifier.matchParentSize().clickable(role = Role.Button, onClickLabel = "Expand the $title", onClick = onExpand))
            }
        }
    }
}
