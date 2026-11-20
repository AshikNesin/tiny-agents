package groot.mobile.feature.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import groot.kit.theme.S
import groot.mobile.data.api.RoutineRunCard
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.Markdown
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val ROUTINE_ZONE: ZoneId = ZoneId.of("Asia/Kolkata")
private val TIME_OF_DAY: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

internal fun runStatusWord(status: String): String = when (status) {
    "succeeded" -> "done"
    "blocked" -> "needs attention"
    "missed" -> "missed"
    "cancelled" -> "cancelled"
    else -> "failed"
}

private fun blocked(run: RoutineRunCard) = run.status == "blocked"
private fun failed(run: RoutineRunCard) = run.status != "succeeded" && !blocked(run)

internal fun runTime(run: RoutineRunCard): String = TIME_OF_DAY.format(Instant.ofEpochMilli(run.finishedAt).atZone(ROUTINE_ZONE))

internal data class RunsSummary(
    val title: String,
    val outcome: String,
    val failed: Int,
    val blocked: Int,
    val time: String,
) {
    val text: String
        get() = listOfNotNull(title, outcome, time, failedText, blockedText).joinToString(" \u00b7 ")

    val failedText: String? get() = if (failed > 0) "$failed failed" else null
    val blockedText: String? get() = if (blocked > 0) "$blocked need${if (blocked == 1) "s" else ""} attention" else null
}

internal fun runsSummary(runs: List<RoutineRunCard>): RunsSummary {
    val latest = runs.maxBy { it.finishedAt }
    val names = runs.map { it.routineName }.toSet()
    val single = runs.size == 1
    return RunsSummary(
        title = if (names.size == 1) latest.routineName else "${names.size} routines",
        outcome = if (single) runStatusWord(latest.status) else "ran ${runs.size}×",
        failed = if (single) 0 else runs.count(::failed),
        blocked = if (single) 0 else runs.count(::blocked),
        time = (if (single) "" else "last ") + runTime(latest),
    )
}

@Composable
fun RoutineRunsLine(runs: List<RoutineRunCard>, modifier: Modifier = Modifier) {
    if (runs.isEmpty()) return
    val summary = runsSummary(runs)
    val latest = runs.maxBy { it.finishedAt }
    var open by rememberSaveable(runs.first().id) { mutableStateOf(false) }
    var showAll by rememberSaveable(runs.first().id) { mutableStateOf(false) }
    val chevron by animateFloatAsState(if (open) HALF_TURN else 0f, label = "routine-runs-chevron")
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val singleColor = statusColor(latest).takeIf { runs.size == 1 }

    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(S.xs)) {
        Column(
            Modifier
                .clip(RoundedCornerShape(Dims.fieldRadius))
                .clickable(role = Role.Button, onClickLabel = if (open) "Hide routine runs" else "Show routine runs") { open = !open }
                .semantics(mergeDescendants = true) { contentDescription = summary.text }
                .padding(horizontal = S.md, vertical = S.xs),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(S.xxs),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(S.xs), verticalAlignment = Alignment.CenterVertically) {
                AppIcon(AppIcons.Clock, null, tint = muted, size = Dims.iconSmall)
                Text(
                    summary.title,
                    style = MaterialTheme.typography.labelMedium,
                    color = muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Dot()
                Text(summary.outcome, style = MaterialTheme.typography.labelMedium, color = singleColor ?: muted, maxLines = 1)
                Dot()
                Text(summary.time, style = MaterialTheme.typography.labelMedium, color = muted, maxLines = 1)
                AppIcon(AppIcons.ChevronDown, null, tint = muted, size = Dims.iconSmall, modifier = Modifier.rotate(chevron))
            }
            if (summary.failedText != null || summary.blockedText != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(S.xs), verticalAlignment = Alignment.CenterVertically) {
                    summary.failedText?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error, maxLines = 1) }
                    if (summary.failedText != null && summary.blockedText != null) Dot()
                    summary.blockedText?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = Accents.warning, maxLines = 1) }
                }
            }
        }
        AnimatedVisibility(open) {
            val newestFirst = runs.sortedByDescending { it.finishedAt }
            val shown = if (showAll) newestFirst else firstShown(newestFirst)
            val showName = runs.map { it.routineName }.toSet().size > 1
            Column(
                Modifier
                    .widthIn(max = Dims.bubbleMaxWidth)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Dims.cardRadius))
                    .background(MaterialTheme.colorScheme.surfaceContainerLow)
                    .padding(horizontal = S.lg, vertical = S.md),
                verticalArrangement = Arrangement.spacedBy(S.md),
            ) {
                for (run in shown) RunDetail(run, showName)
                val hidden = newestFirst.size - shown.size
                if (hidden > 0) {
                    Text(
                        "Show $hidden earlier",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(Dims.fieldRadius))
                            .clickable(role = Role.Button) { showAll = true }
                            .padding(vertical = S.xs),
                    )
                }
            }
        }
    }
}

@Composable
private fun RunDetail(run: RoutineRunCard, showName: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(S.xs)) {
        Row(horizontalArrangement = Arrangement.spacedBy(S.xs), verticalAlignment = Alignment.CenterVertically) {
            val muted = MaterialTheme.colorScheme.onSurfaceVariant
            val head = buildList {
                add(runTime(run))
                if (showName) add(run.routineName)
            }.joinToString(" · ")
            Text("$head ·", style = MaterialTheme.typography.labelSmall, color = muted)
            Text(runStatusWord(run.status), style = MaterialTheme.typography.labelSmall, color = statusColor(run) ?: muted)
            if (run.trigger == "manual") Text("· run now", style = MaterialTheme.typography.labelSmall, color = muted)
        }
        run.output?.takeIf { it.isNotBlank() }?.let { Markdown(it) }
        run.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = if (blocked(run)) Accents.warning else MaterialTheme.colorScheme.error) }
    }
}

internal fun firstShown(newestFirst: List<RoutineRunCard>): List<RoutineRunCard> =
    newestFirst.filterIndexed { index, run -> index < FIRST_SHOWN || run.status != "succeeded" }

@Composable
private fun statusColor(run: RoutineRunCard): Color? = when {
    blocked(run) -> Accents.warning
    failed(run) -> MaterialTheme.colorScheme.error
    else -> null
}

@Composable
private fun Dot() {
    Text("·", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

private const val HALF_TURN = 180f

private const val FIRST_SHOWN = 5
